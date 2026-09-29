import { readCache, writeCache } from "./cache.js";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const OVERPASS_HOST = "overpass-api.de";
/**
 * Overpass answers 406 to a request that does not say who is asking, and
 * Node's fetch sends no User-Agent of its own. Without this every query
 * failed six times over and the ETL could only run from an old cache.
 */
export const USER_AGENT = "sperrmuell-bonn/1.0 (+https://linu.li/tools/sperrmuell/)";

export class NetworkBlockedError extends Error {
  constructor(host: string, cause: unknown) {
    super(
      `Could not reach ${host}. If this environment has restricted network access, ` +
        `please allowlist ${host} (used to fetch OpenStreetMap data via the Overpass API), ` +
        `or re-run with cached data already present in .cache/.`,
    );
    this.name = "NetworkBlockedError";
    this.cause = cause;
  }
}

interface FetchOverpassOptions {
  /** Cache file path. If it exists, it is used and no request is made. */
  cachePath: string;
  /** Human-readable label for log messages. */
  label: string;
}

const MAX_ATTEMPTS = 6;

/**
 * Run an Overpass QL query, with on-disk caching and retries.
 *
 * The Overpass API (overpass-api.de) is a shared public service that
 * frequently returns transient 429/5xx errors under load; we retry with
 * exponential backoff before giving up. A genuine network failure (DNS/
 * connection refused, e.g. due to an egress firewall) is reported as a
 * {@link NetworkBlockedError} naming the host to allowlist.
 */
export async function fetchOverpass(query: string, options: FetchOverpassOptions): Promise<string> {
  const cached = readCache(options.cachePath);
  if (cached !== null) {
    console.log(`[overpass] ${options.label}: using cached ${options.cachePath}`);
    return cached;
  }

  console.log(`[overpass] ${options.label}: fetching from ${OVERPASS_URL}...`);

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let response: Response;
    try {
      response = await fetch(OVERPASS_URL, {
        method: "POST",
        body: query,
        headers: { "Content-Type": "text/plain", "User-Agent": USER_AGENT },
      });
    } catch (err) {
      throw new NetworkBlockedError(OVERPASS_HOST, err);
    }

    if (response.ok) {
      const text = await response.text();
      // Overpass occasionally returns an HTML error page with HTTP 200.
      if (text.trimStart().startsWith("<")) {
        lastError = new Error(`Overpass returned an HTML error page (attempt ${attempt})`);
      } else {
        writeCache(options.cachePath, text);
        console.log(`[overpass] ${options.label}: cached to ${options.cachePath} (${text.length} bytes)`);
        return text;
      }
    } else {
      lastError = new Error(`Overpass HTTP ${response.status} (attempt ${attempt})`);
    }

    if (attempt < MAX_ATTEMPTS) {
      const delayMs = attempt * 3000;
      console.log(`[overpass] ${options.label}: ${(lastError as Error).message}, retrying in ${delayMs}ms...`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  throw new Error(
    `[overpass] ${options.label}: giving up after ${MAX_ATTEMPTS} attempts: ${(lastError as Error)?.message}`,
  );
}
