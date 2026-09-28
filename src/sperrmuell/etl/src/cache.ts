import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Ensure the parent directory of `path` exists. */
export function ensureDirFor(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

export function readCache(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf-8") : null;
}

export function writeCache(path: string, content: string): void {
  ensureDirFor(path);
  writeFileSync(path, content, "utf-8");
}

export function readJsonCache<T>(path: string): T | null {
  const raw = readCache(path);
  return raw === null ? null : (JSON.parse(raw) as T);
}

export function writeJsonCache(path: string, value: unknown): void {
  writeCache(path, JSON.stringify(value));
}
