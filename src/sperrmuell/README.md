# Sperrmüll Bonn

A self-hosted, mobile-first map of Bonn's bulky-waste ("Sperrmüll")
collection: the exact streets and collection-zone polygons scheduled for
each date, built from bonnorange's official open data and OpenStreetMap
geometry.

## Quick start

```sh
npm install
npm run data    # ETL: builds ../../tools/sperrmuell/data/
npm run dev     # starts the app (prints a Network URL — open that on your phone)
```

`npm run data` builds from the schedules in `etl/termine/` (see below) and
downloads Bonn's street/
address/Ortsteil geometry from OpenStreetMap (via Overpass) and caches
everything under `.cache/`. Subsequent runs reuse the cache and finish in a
few seconds.

For a production build:

```sh
npm run build
npm run preview
```

## Publishing

This folder is part of the [linu-li](https://github.com/immineal/linu-li)
repository, and the app is served from `linu.li/tools/sperrmuell/`. Nobody
publishes by hand: the deploy workflow runs `npm ci`, `npm run build` and
`npm run publish:site` before it uploads the site, and CI does the same
before the tests. Only the data in `tools/sperrmuell/data/` is committed; the
rest of `tools/sperrmuell/` is ignored by git. To try it locally:

```sh
npm run build
npm run publish:site -- --dry   # what would change
npm run publish:site            # mirror dist/ into tools/sperrmuell/
```

`dist/` is a complete picture of the directory it feeds, so the copy is a
plain mirror with `--delete`; the build carries a copy of `data/`, so that
comes through unchanged. Two consequences worth
knowing:

- `base` lives in `app/vite.config.ts`, not on the command line. Build with
  the wrong one and every asset request goes to the domain root and 404s.
- The files that decide how the build is *served* live in `app/serve/` and are
  emitted into `dist/` by `servePlugin`: the two `.htaccess` rules (a year of
  cache for the content-hashed bundles, revalidation for the collection
  dates), and `abgemeldet-sw.js`.

That last one is the app's own history. Until September 2026 it answered at
`linu.li/sperrmuell/`, and everyone who opened it then still carries a service
worker registered from that address, which answers every request in the old
scope out of its cache. A worker script is never fetched through a redirect —
the browser reads that as a failed update and keeps what it has — so the old
address cannot simply 301 to the new one. It serves `abgemeldet-sw.js`
instead, whose only job is to take that registration apart.

Change the app here, never its built copy. Before the build moved into the
deploy, a fix to the service worker was made in the built copy and never in
the source, so the next build would have shipped the bug straight back out.
`test/serve.test.ts` still guards that one.

## What you'll see

- A map of Bonn with streets scheduled for the current date highlighted,
  color-coded per collection date.
- **Solid** lines = geometry matched exactly to OSM address data for that
  house-number range. **Dashed** lines = approximate (full street shown,
  reason given).
- A date scrubber (defaults to today/the next collection date) to step
  through the year's collection dates.
- Address search ("Straße Hausnummer") — jumps to the matching segment and
  shows its three collection dates for the year.
- Toggleable layers for collection-zone polygons and Ortsteil (district)
  boundaries.
- A "Datenqualität" panel (bottom sheet) with match-rate stats, the cluster
  validation badge, and source attribution.

## How it works

```
etl/          Node/TypeScript pipeline -> data/
app/          Vite + MapLibre GL frontend, reads data/
app/serve/    files that shape how the build is served, emitted into dist/
app/scripts/  publish.mjs — mirrors dist/ into the website's repository
../../tools/sperrmuell/data/   the ETL's output, committed (the app reads it from there)
```

The ETL pipeline (`npm run data`). It asks Overpass with a User-Agent naming
the map; without one Overpass answers 406. Paths below called `data/` mean
`tools/sperrmuell/data/` at the root of linu-li.

1. Reads this year's and, once it is out, next year's schedule from
   `etl/termine/`, and builds one segment per row: street, Ortsteil, PLZ,
   a house-number predicate (even/odd ranges + `HNR_NEG` toggles), and its
   three collection dates.
2. Fetches Bonn's administrative boundary, `highway=*` ways, address
   nodes/ways, and Ortsteil (admin_level=10) polygons from OpenStreetMap via
   Overpass.
3. Matches each segment's street name to OSM ways (disambiguating by
   Ortsteil where the name occurs more than once in Bonn), then clips the
   way geometry to the segment's house-number range using the real
   `addr:housenumber` points.
4. Groups segments that share a date into per-date collection-zone polygons
   and validates that every segment contributes to exactly 3 zones (one per
   collection date).
5. Writes `data/segments.geojson`, `data/routes.geojson`,
   `data/ortsteile.geojson`, and `data/index.json` (build stats + validation
   report).

## Data quality

Every segment in `data/segments.geojson` has a `geometryConfidence`:

| Value         | Meaning                                                                                                  |
| ------------- | -------------------------------------------------------------------------------------------------------- |
| `exact`       | Clipped to real OSM `addr:housenumber` points within the segment's range. |
| `approximate` | Full street geometry shown because no usable address data was found, or the street name is ambiguous across Bonn. The reason is in `confidenceNote`. |
| `unmatched`   | No OSM way found for this street name. `geometry` is `null`; listed in `data/index.json` under `unmatchedSegments` and not drawn on the map. |

`npm run data` exits non-zero if the overall match rate drops below 95%, the
exact-match rate drops below 75%, or the per-date route-cluster validation
fails (every segment must contribute to exactly 3 date clusters). The
current build matches ~99% of segments (~95% exact, ~4% approximate, <1%
unmatched) — see `data/index.json` for the latest numbers.

## Schedules, and the yearly update

bonnorange publishes the collection schedule once a year as a new 25 MB CSV
(`ABFUHRTERMINE2027OpenData.csv` and so on), usually in December. Only its
Sperrmüll rows matter here, and `npm run schedules` keeps those, trimmed to
the columns the build reads, as `etl/termine/sperrmuell-<year>.csv`, with the
source addresses in `etl/termine/quellen.json`. Those files are committed:
they are what the data is built from, and they stay if the city takes a file
down.

`npm run schedules` fetches this year and next. If a file is not under its
usual name, it looks at the links on the year's dataset page. Every request
gives up after a minute and is tried four times, so a stalled download fails
instead of hanging.

`npm run data` reads the same two years. A stretch of street that is in both
gets both years' dates, so the map simply continues into January; one whose
house numbers changed between the years stays two segments. The "three dates
per segment" check runs per year.

`.github/workflows/sperrmuell-termine.yml` does all of this every Monday. If
a schedule is new or revised, it rebuilds the data, commits it to `main` with
a `-` in the site's update note (so visitors get no prompt), and starts the
tests; the deploy follows them. Nothing needs doing by hand.

To build from a file you have lying around instead:

```sh
npm run data:from-file -- /path/to/ABFUHRTERMINE2027OpenData.csv
```

Overpass responses are cached under `.cache/osm/`, so later `npm run data`
runs don't need to ask Overpass again.

## Testing

```sh
npm test
```

Runs the etl and app unit test suites (Vitest), covering CSV parsing (BOM,
German number/date formats, `HNR_NEG`, house-number ranges), street-name
normalization, predicate/containment logic, date filtering, address search,
and a matching/clipping test against a synthetic street — plus a real-data
check against the 15.06.2026 Röttgen/Ippendorf/Lengsdorf collection.

## License & attribution

- Code: [MIT](LICENSE)
- Data in `data/`: derived from bonnorange AöR (CC BY 4.0) and OpenStreetMap
  (ODbL) — see [ATTRIBUTION.md](ATTRIBUTION.md)
