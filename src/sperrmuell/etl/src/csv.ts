/**
 * Minimal CSV parser tailored to the bonnorange "Abfuhrtermine" export:
 * UTF-8 with BOM, `;`-separated, `\r\n` line endings, no quoting/escaping.
 */

const BOM = "﻿";

export interface ParsedCsv {
  header: string[];
  /** Each row as a map from column name to raw string value (may be ""). */
  rows: Record<string, string>[];
}

/** Parse raw CSV text into a header row + array of column->value maps. */
export function parseCsv(text: string): ParsedCsv {
  let content = text;
  if (content.startsWith(BOM)) {
    content = content.slice(BOM.length);
  }

  // Normalize line endings, then drop trailing empty lines (trailing CRLF).
  const lines = content.split(/\r\n|\n/);
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
    lines.pop();
  }
  if (lines.length === 0) {
    return { header: [], rows: [] };
  }

  const header = lines[0].split(";");
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === "") continue;
    const cells = line.split(";");
    const row: Record<string, string> = {};
    for (let c = 0; c < header.length; c++) {
      row[header[c]] = (cells[c] ?? "").trim();
    }
    rows.push(row);
  }

  return { header, rows };
}
