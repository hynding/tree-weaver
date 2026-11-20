import { createId } from './create';
import type { ChangeSource } from './history';

/**
 * Saved versions of a document file, for the CLI and the MCP server. Each version holds the
 * whole document as it was (in the file's own format), so restoring one writes it back
 * exactly. The log lives next to the document, in `.tree-weaver/<file>.versions.json`.
 *
 * Named versions are kept until removed. Automatic ones (taken before an agent's patch, or
 * before a restore) are capped, oldest dropped first.
 */

export interface DocumentVersion {
  id: string;
  name: string;
  /** ISO time the version was saved. */
  createdAt: string;
  source?: ChangeSource;
  /** Saved automatically before a change, rather than named by someone. */
  auto?: boolean;
  /** The document text, in `format`. */
  document: string;
  format: string;
}

export interface VersionLog {
  version: 1;
  versions: DocumentVersion[];
}

/** Automatic versions kept per document. */
export const AUTO_VERSION_LIMIT = 30;

export const emptyVersionLog = (): VersionLog => ({ version: 1, versions: [] });

/** A version log that exists but can't be read. Writing over it would lose every version, so callers stop. */
export class VersionLogError extends Error {}

/**
 * Read a version log. A missing log is empty. A damaged one is empty too, unless `strict`,
 * when it throws a `VersionLogError` so that nothing writes over the versions it still holds.
 */
export function parseVersionLog(text: string | null | undefined, strict = false): VersionLog {
  if (!text) return emptyVersionLog();
  const damaged = (why: string) => {
    if (strict) throw new VersionLogError(`The version log is damaged (${why}); fix or move it before saving versions`);
    return emptyVersionLog();
  };
  try {
    const raw = JSON.parse(text) as Partial<VersionLog>;
    if (!raw || !Array.isArray(raw.versions)) return damaged('no "versions" list');
    const versions = raw.versions.filter(
      (v): v is DocumentVersion => !!v && typeof v.id === 'string' && typeof v.document === 'string' && typeof v.createdAt === 'string',
    );
    if (strict && versions.length !== raw.versions.length) damaged(`${raw.versions.length - versions.length} damaged version${raw.versions.length - versions.length > 1 ? 's' : ''}`);
    return { version: 1, versions: versions.map((v) => ({ ...v, name: typeof v.name === 'string' ? v.name : v.id, format: v.format || 'json' })) };
  } catch (err) {
    if (err instanceof VersionLogError) throw err;
    return damaged('not valid JSON');
  }
}

export const stringifyVersionLog = (log: VersionLog): string => `${JSON.stringify(log, null, 2)}\n`;

/** Add a version, newest last, dropping the oldest automatic versions past the limit. */
export function addVersion(
  log: VersionLog,
  init: { name?: string; document: string; format: string; source?: ChangeSource; auto?: boolean },
  limit = AUTO_VERSION_LIMIT,
): { log: VersionLog; version: DocumentVersion } {
  const version: DocumentVersion = {
    id: createId('v'),
    name: init.name?.trim() || (init.auto ? 'Automatic' : `Version ${log.versions.filter((v) => !v.auto).length + 1}`),
    createdAt: new Date().toISOString(),
    ...(init.source ? { source: init.source } : {}),
    ...(init.auto ? { auto: true } : {}),
    document: init.document,
    format: init.format,
  };
  const versions = [...log.versions, version];
  let autos = versions.filter((v) => v.auto).length;
  const kept = versions.filter((v) => {
    if (!v.auto || autos <= limit) return true;
    autos--;
    return false;
  });
  return { log: { version: 1, versions: kept }, version };
}

/**
 * Find a version by id, by name (case-insensitive, newest match), or by position:
 * `latest`/`-1` is the newest, `-2` the one before, `1` the oldest.
 */
export function findVersion(log: VersionLog, ref: string): DocumentVersion | undefined {
  const list = log.versions;
  const r = ref.trim();
  if (r === 'latest') return list[list.length - 1];
  if (/^-?\d+$/.test(r)) {
    const n = Number(r);
    return n < 0 ? list[list.length + n] : list[n - 1];
  }
  const byId = list.find((v) => v.id === r);
  if (byId) return byId;
  const lower = r.toLowerCase();
  return [...list].reverse().find((v) => v.name.toLowerCase() === lower);
}

export function removeVersion(log: VersionLog, id: string): VersionLog {
  return { version: 1, versions: log.versions.filter((v) => v.id !== id) };
}

/** Where a document's version log lives: `<dir>/.tree-weaver/<file name>.versions.json`. Keeps the path's separators. */
export function versionLogPath(documentPath: string): string {
  const cut = Math.max(documentPath.lastIndexOf('/'), documentPath.lastIndexOf('\\'));
  const sep = cut >= 0 ? documentPath[cut] : '/';
  const dir = cut >= 0 ? documentPath.slice(0, cut + 1) : '';
  const file = documentPath.slice(cut + 1);
  return `${dir}.tree-weaver${sep}${file}.versions.json`;
}
