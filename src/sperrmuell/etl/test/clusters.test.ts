import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildClusters, validateClusters } from "../src/clusters.js";
import { parseCsv } from "../src/csv.js";
import { parseSperrmuellSegments } from "../src/parseSegments.js";

const fixturePath = new URL("./fixtures/sample-sperrmuell.csv", import.meta.url);
const { rows } = parseCsv(readFileSync(fixturePath, "utf-8"));
const segments = parseSperrmuellSegments(rows);

describe("buildClusters", () => {
  it("groups all 20 fixture segments into the shared 2026-06-15 route cluster", () => {
    const clusters = buildClusters(segments);
    const june = clusters.find((c) => c.date === "2026-06-15");
    expect(june).toBeDefined();
    expect(june?.segmentIds.sort()).toEqual(segments.map((s) => s.id).sort());
  });

  it("produces exactly the 3 dates shared by every fixture segment", () => {
    const clusters = buildClusters(segments);
    expect(clusters.map((c) => c.date)).toEqual([
      "2026-02-26",
      "2026-06-15",
      "2026-11-03",
    ]);
    for (const cluster of clusters) {
      expect(cluster.segmentIds).toHaveLength(20);
    }
  });
});

describe("validateClusters", () => {
  it("passes for well-formed segments (3 distinct dates each)", () => {
    const clusters = buildClusters(segments);
    const validation = validateClusters(segments, clusters);
    expect(validation.pass).toBe(true);
    expect(validation.uniqueDates).toBe(3);
    expect(validation.totalDateAssignments).toBe(60);
    expect(validation.expectedDateAssignments).toBe(60);
  });

  it("fails if a date assignment is missing from the clusters", () => {
    const clusters = buildClusters(segments);
    const broken = clusters.map((c, i) =>
      i === 0 ? { ...c, segmentIds: c.segmentIds.slice(1) } : c,
    );
    const validation = validateClusters(segments, broken);
    expect(validation.pass).toBe(false);
    expect(validation.totalDateAssignments).toBe(59);
    expect(validation.details).toContain("FAILED");
  });
});
