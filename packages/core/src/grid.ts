/*
 * Plain-language grid editing: column lists instead of `grid-template-columns`
 * strings, and spans instead of `grid-column` lines.
 */

/** How one column is sized, in words a non-developer can pick from. */
export type GridTrack =
  /** A share of the free space (`fr`). `value` is the number of shares. */
  | { kind: 'share'; value: number }
  /** A fixed CSS length such as `240px` or `12rem`. */
  | { kind: 'fixed'; value: string }
  /** As wide as its content needs (`auto`). */
  | { kind: 'fit' }
  /** Anything else, kept verbatim (`minmax(200px, 2fr)`, `max-content`, ...). */
  | { kind: 'custom'; value: string };

/** Columns that wrap: as many as fit, each at least `minWidth` wide. */
export interface AutoColumns {
  minWidth: string;
}

const SHARE = /^(?:minmax\(\s*0(?:px)?\s*,\s*([\d.]+)fr\s*\)|([\d.]+)fr)$/;
const LENGTH = /^-?[\d.]+(?:px|rem|em|%|vw|vh|ch|ex|vmin|vmax|cm|mm|in|pt|pc)$/;
const AUTO_FIT = /^repeat\(\s*auto-(?:fit|fill)\s*,\s*minmax\(\s*([^,()]+?)\s*,\s*1fr\s*\)\s*\)$/;

/** Split on top-level whitespace, keeping parenthesised groups together. */
function splitTopLevel(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of value.trim()) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (/\s/.test(ch) && depth === 0) {
      if (current) out.push(current);
      current = '';
    } else current += ch;
  }
  if (current) out.push(current);
  return out;
}

export function parseTrack(token: string): GridTrack {
  const t = token.trim();
  const share = SHARE.exec(t);
  if (share) return { kind: 'share', value: Number(share[1] ?? share[2]) };
  if (t === 'auto') return { kind: 'fit' };
  if (LENGTH.test(t)) return { kind: 'fixed', value: t };
  return { kind: 'custom', value: t };
}

export function formatTrack(track: GridTrack): string {
  switch (track.kind) {
    case 'share':
      return `minmax(0, ${trimNumber(track.value)}fr)`;
    case 'fixed':
      return track.value;
    case 'fit':
      return 'auto';
    case 'custom':
      return track.value;
  }
}

/**
 * The columns of a `grid-template-columns` value, with `repeat(n, ...)` expanded.
 * Returns `null` for values that are not a fixed list of columns (auto-fit, subgrid,
 * named lines), which the editor leaves to the raw CSS field.
 */
export function parseTracks(template: string | undefined): GridTrack[] | null {
  if (!template || template.trim() === 'none') return [];
  const tracks: GridTrack[] = [];
  for (const token of splitTopLevel(template)) {
    if (token.startsWith('[')) return null;
    const repeat = /^repeat\(\s*(\d+)\s*,(.*)\)$/.exec(token);
    if (repeat) {
      const inner = splitTopLevel(repeat[2]);
      if (inner.some((t) => t.startsWith('['))) return null;
      for (let i = 0; i < Number(repeat[1]); i++) tracks.push(...inner.map(parseTrack));
    } else if (token.startsWith('repeat(') || token === 'subgrid' || token === 'masonry') return null;
    else tracks.push(parseTrack(token));
  }
  return tracks;
}

/** Write columns back as CSS, collapsing identical columns into `repeat()`. */
export function formatTracks(tracks: GridTrack[]): string {
  if (tracks.length === 0) return 'none';
  const parts = tracks.map(formatTrack);
  if (parts.length > 1 && parts.every((p) => p === parts[0])) return `repeat(${parts.length}, ${parts[0]})`;
  return parts.join(' ');
}

export function parseAutoColumns(template: string | undefined): AutoColumns | null {
  const match = template ? AUTO_FIT.exec(template.trim()) : null;
  return match ? { minWidth: match[1] } : null;
}

export const formatAutoColumns = ({ minWidth }: AutoColumns): string => `repeat(auto-fit, minmax(${minWidth}, 1fr))`;

/** A short label for a column, e.g. "1 share", "240px", "Fit". */
export function trackLabel(track: GridTrack): string {
  switch (track.kind) {
    case 'share':
      return `${trimNumber(track.value)} ${track.value === 1 ? 'share' : 'shares'}`;
    case 'fixed':
      return track.value;
    case 'fit':
      return 'Fit';
    case 'custom':
      return track.value;
  }
}

const trimNumber = (n: number): string => String(Math.round(n * 100) / 100);

/**
 * Move the line between column `index` and `index + 1` by `delta` pixels.
 * `widths` are the columns' rendered widths. Shares are rebalanced between the two
 * columns so their total stays the same; fixed columns change length; anything
 * else touching the line becomes a fixed pixel width.
 */
export function resizeTracks(tracks: GridTrack[], widths: number[], index: number, delta: number): GridTrack[] {
  const a = tracks[index];
  const b = tracks[index + 1];
  if (!a || !b || widths.length !== tracks.length) return tracks;
  const min = 24;
  const wa = widths[index];
  const wb = widths[index + 1];
  const d = Math.max(min - wa, Math.min(wb - min, delta));
  const next = [...tracks];
  if (a.kind === 'share' && b.kind === 'share') {
    const total = a.value + b.value;
    const pair = wa + wb;
    // Snap to quarter shares so the numbers stay readable.
    const shareA = Math.min(total - 0.25, Math.max(0.25, round(((wa + d) / pair) * total, 0.25)));
    next[index] = { kind: 'share', value: shareA };
    next[index + 1] = { kind: 'share', value: total - shareA };
    return next;
  }
  // Columns that are not shares take their new width; shares absorb the rest.
  if (a.kind !== 'share') next[index] = { kind: 'fixed', value: `${Math.round(wa + d)}px` };
  if (b.kind !== 'share') next[index + 1] = { kind: 'fixed', value: `${Math.round(wb - d)}px` };
  return next;
}

const round = (n: number, step: number): number => Math.round(n / step) * step;

/* ------------------------------------------------------------- placement */

/** Where a grid child sits, in columns (1-based). `start: null` means it flows. */
export interface GridSpan {
  start: number | null;
  span: number;
  /** Stretches across every column (`1 / -1`). */
  full: boolean;
}

/** Read a `grid-column` / `grid-row` value. Unrecognised values give `null`. */
export function parseSpan(value: string | undefined): GridSpan | null {
  const v = (value ?? '').trim();
  if (!v || v === 'auto') return { start: null, span: 1, full: false };
  if (/^1\s*\/\s*-1$/.test(v)) return { start: 1, span: 1, full: true };
  let m = /^span\s+(\d+)$/.exec(v);
  if (m) return { start: null, span: Number(m[1]), full: false };
  m = /^(\d+)$/.exec(v);
  if (m) return { start: Number(m[1]), span: 1, full: false };
  m = /^(\d+)\s*\/\s*span\s+(\d+)$/.exec(v);
  if (m) return { start: Number(m[1]), span: Number(m[2]), full: false };
  m = /^(\d+)\s*\/\s*(\d+)$/.exec(v);
  if (m && Number(m[2]) > Number(m[1])) return { start: Number(m[1]), span: Number(m[2]) - Number(m[1]), full: false };
  m = /^auto\s*\/\s*span\s+(\d+)$/.exec(v);
  if (m) return { start: null, span: Number(m[1]), full: false };
  return null;
}

/** Write a span back as CSS. Returns `null` for the default (one column, flowing). */
export function formatSpan({ start, span, full }: GridSpan): string | null {
  if (full) return '1 / -1';
  const n = Math.max(1, Math.floor(span));
  if (start === null) return n === 1 ? null : `span ${n}`;
  return n === 1 ? String(start) : `${start} / span ${n}`;
}
