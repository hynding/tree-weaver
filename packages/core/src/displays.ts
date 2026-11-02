import type { DisplayId, DisplayStyles, StyleMap } from './model';

export interface DisplayDef {
  id: DisplayId;
  label: string;
  /** Short label for compact toolbars. */
  short: string;
  /** Preview viewport size in CSS pixels. */
  width: number;
  height: number;
  /**
   * Screen width in CSS pixels where the display's styles start to apply: a `min-width` for
   * Desktop XL, a `max-width` for the others. `null` for the base display.
   */
  breakpoint: number | null;
  /** Media query the display's styles are emitted under. `null` for the base display. */
  media: string | null;
  /** Displays whose styles cascade into this one, in order (first is lowest priority). */
  inherits: DisplayId[];
}

/** The display values that can be changed, in the app or by the deployment. */
export interface DisplaySize {
  width: number;
  height: number;
  /** Not used by the base display. */
  breakpoint: number;
}

/** Changes to the default display values, per display. Missing values keep their default. */
export type DisplaySettings = Partial<Record<DisplayId, Partial<DisplaySize>>>;

export type DisplayField = keyof DisplaySize;
export const DISPLAY_FIELDS: readonly DisplayField[] = ['width', 'height', 'breakpoint'];

/** Smallest and largest pixel value a display setting accepts. */
export const DISPLAY_MIN_PX = 100;
export const DISPLAY_MAX_PX = 10000;

interface DisplayBase extends Omit<DisplayDef, 'media'> {
  /** Builds the media query from the breakpoint. */
  query: ((px: number) => string) | null;
}

const BASES: readonly DisplayBase[] = [
  { id: 'lg', label: 'Desktop large', short: 'LG', width: 1280, height: 800, breakpoint: null, query: null, inherits: [] },
  {
    id: 'xl',
    label: 'Desktop XL',
    short: 'XL',
    width: 1920,
    height: 1080,
    breakpoint: 1440,
    query: (px) => `(min-width: ${px}px)`,
    inherits: ['lg'],
  },
  {
    id: 'tablet',
    label: 'Tablet',
    short: 'Tab',
    width: 820,
    height: 1180,
    breakpoint: 1024,
    query: (px) => `(max-width: ${px}px)`,
    inherits: ['lg'],
  },
  {
    id: 'mobile-landscape',
    label: 'Mobile landscape',
    short: 'ML',
    width: 844,
    height: 390,
    breakpoint: 932,
    query: (px) => `(max-width: ${px}px) and (orientation: landscape)`,
    inherits: ['lg', 'tablet'],
  },
  {
    id: 'mobile-portrait',
    label: 'Mobile portrait',
    short: 'MP',
    width: 390,
    height: 844,
    breakpoint: 600,
    query: (px) => `(max-width: ${px}px) and (orientation: portrait)`,
    inherits: ['lg', 'tablet'],
  },
];

function build(base: DisplayBase, settings: Partial<DisplaySize> = {}): DisplayDef {
  const { query, ...rest } = base;
  const width = settings.width ?? base.width;
  const height = settings.height ?? base.height;
  const breakpoint = query ? (settings.breakpoint ?? base.breakpoint) : null;
  return { ...rest, inherits: [...base.inherits], width, height, breakpoint, media: query && breakpoint ? query(breakpoint) : null };
}

/** The display types as they ship, before any settings. */
export const DEFAULT_DISPLAYS: readonly DisplayDef[] = BASES.map((b) => build(b));

/**
 * Display types, in the order their CSS is emitted. `lg` (desktop large) is the base:
 * its styles apply everywhere unless a more specific display overrides them.
 *
 * Mobile displays inherit tablet styles, so a tablet override also reaches phones
 * unless a mobile display overrides it again.
 *
 * The entries reflect the current settings (see `applyDisplaySettings`); the array itself
 * never changes identity, so modules may keep a reference to it.
 */
export const DISPLAYS: readonly DisplayDef[] = BASES.map((b) => build(b));

export const BASE_DISPLAY: DisplayId = 'lg';

export const DISPLAY_IDS: readonly DisplayId[] = BASES.map((d) => d.id);

export function getDisplay(id: DisplayId): DisplayDef {
  const def = DISPLAYS.find((d) => d.id === id);
  if (!def) throw new Error(`Unknown display "${id}"`);
  return def;
}

export function getDefaultDisplay(id: DisplayId): DisplayDef {
  const def = DEFAULT_DISPLAYS.find((d) => d.id === id);
  if (!def) throw new Error(`Unknown display "${id}"`);
  return def;
}

export function isDisplayId(value: unknown): value is DisplayId {
  return typeof value === 'string' && (DISPLAY_IDS as readonly string[]).includes(value);
}

/**
 * Change the display values everything uses: preview sizes, media queries in rendered CSS,
 * and which media queries map back to a display on import. Values not in `settings` go back
 * to their default. Invalid values are ignored.
 */
export function applyDisplaySettings(settings: DisplaySettings): void {
  const clean = cleanDisplaySettings(settings);
  BASES.forEach((base, i) => Object.assign(DISPLAYS[i], build(base, clean[base.id])));
}

const normalizeMedia = (m: string): string => m.replace(/\s+/g, '').toLowerCase();

/**
 * The display whose styles a media query holds, or `undefined`. Matches the current media
 * queries first, then the default ones, so CSS written before a breakpoint changed still reads back.
 */
export function displayForMedia(media: string): DisplayId | undefined {
  const m = normalizeMedia(media);
  return (
    DISPLAYS.find((d) => d.media && normalizeMedia(d.media) === m)?.id ??
    DEFAULT_DISPLAYS.find((d) => d.media && normalizeMedia(d.media) === m)?.id
  );
}

/* -------------------------------------------------------------- settings */

const pxValue = (value: unknown): number | undefined => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim().replace(/px$/i, '')) : NaN;
  return Number.isInteger(n) && n >= DISPLAY_MIN_PX && n <= DISPLAY_MAX_PX ? n : undefined;
};

/** Settings with unknown displays, unknown fields and out-of-range values removed. */
export function cleanDisplaySettings(value: unknown): DisplaySettings {
  const out: DisplaySettings = {};
  if (!value || typeof value !== 'object') return out;
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!isDisplayId(id) || !raw || typeof raw !== 'object') continue;
    const entry: Partial<DisplaySize> = {};
    for (const field of DISPLAY_FIELDS) {
      if (field === 'breakpoint' && id === BASE_DISPLAY) continue;
      const px = pxValue((raw as Record<string, unknown>)[field]);
      if (px !== undefined) entry[field] = px;
    }
    if (Object.keys(entry).length) out[id] = entry;
  }
  return out;
}

/** Combine settings; later ones win, field by field. */
export function mergeDisplaySettings(...list: DisplaySettings[]): DisplaySettings {
  const out: DisplaySettings = {};
  for (const settings of list)
    for (const id of DISPLAY_IDS) if (settings[id]) out[id] = { ...out[id], ...settings[id] };
  return out;
}

/** Only the values that differ from the defaults. */
export function changedDisplaySettings(settings: DisplaySettings): DisplaySettings {
  const out: DisplaySettings = {};
  for (const [id, entry] of Object.entries(cleanDisplaySettings(settings)) as [DisplayId, Partial<DisplaySize>][]) {
    const def = getDefaultDisplay(id);
    const changed: Partial<DisplaySize> = {};
    for (const field of DISPLAY_FIELDS) if (entry[field] !== undefined && entry[field] !== def[field]) changed[field] = entry[field];
    if (Object.keys(changed).length) out[id] = changed;
  }
  return out;
}

export interface ParsedDisplaySettings {
  settings: DisplaySettings;
  /** Parts of the text that were not understood, with the reason. */
  errors: string[];
}

const FIELD_ALIASES: Record<string, DisplayField | 'size'> = {
  width: 'width',
  w: 'width',
  height: 'height',
  h: 'height',
  breakpoint: 'breakpoint',
  bp: 'breakpoint',
  size: 'size',
};

/**
 * Read display settings written as text, as in the `TW_DISPLAYS` environment variable.
 *
 * Either JSON (`{"tablet":{"width":768,"breakpoint":1024}}`) or `display.field=value` pairs
 * separated by commas, semicolons or new lines:
 *
 *     xl.breakpoint=1600, tablet.size=768x1024, mobile-portrait.width=375
 *
 * Fields are `width`, `height`, `breakpoint` and `size` (`WIDTHxHEIGHT`). Values are CSS pixels.
 */
export function parseDisplaySettings(text: string | undefined | null): ParsedDisplaySettings {
  const source = (text ?? '').trim();
  const errors: string[] = [];
  if (!source) return { settings: {}, errors };
  let raw: Record<string, Record<string, unknown>> = {};
  if (source.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(source);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) raw = parsed as typeof raw;
      else errors.push('Expected a JSON object of displays.');
    } catch (err) {
      errors.push(`Not valid JSON: ${(err as Error).message}`);
    }
    for (const [id, entry] of Object.entries(raw)) {
      if (!isDisplayId(id)) errors.push(`Unknown display "${id}". Use ${DISPLAY_IDS.join(', ')}.`);
      else if (!entry || typeof entry !== 'object') errors.push(`"${id}" should be an object such as {"width": 768}.`);
      else
        for (const field of Object.keys(entry))
          if (!(DISPLAY_FIELDS as readonly string[]).includes(field)) errors.push(`Unknown field "${id}.${field}". Use width, height or breakpoint.`);
    }
  } else {
    for (const part of source.split(/[,;\n]+/)) {
      const item = part.trim();
      if (!item) continue;
      const m = /^([a-z-]+)\.([a-z]+)\s*[=:]\s*(.+)$/i.exec(item);
      if (!m) {
        errors.push(`"${item}" should look like tablet.width=768.`);
        continue;
      }
      const id = m[1].toLowerCase();
      const field = FIELD_ALIASES[m[2].toLowerCase()];
      const value = m[3].trim();
      if (!isDisplayId(id)) {
        errors.push(`Unknown display "${m[1]}". Use ${DISPLAY_IDS.join(', ')}.`);
        continue;
      }
      if (!field) {
        errors.push(`Unknown field "${m[2]}" in "${item}". Use width, height, breakpoint or size.`);
        continue;
      }
      const entry = (raw[id] ??= {});
      if (field === 'size') {
        const size = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(value);
        if (!size) {
          errors.push(`"${item}": size should look like 768x1024.`);
          continue;
        }
        entry.width = size[1];
        entry.height = size[2];
      } else entry[field] = value;
    }
  }
  for (const [id, entry] of Object.entries(raw)) {
    if (!isDisplayId(id) || !entry || typeof entry !== 'object') continue;
    for (const field of DISPLAY_FIELDS) {
      const value = entry[field];
      if (value === undefined) continue;
      if (field === 'breakpoint' && id === BASE_DISPLAY) errors.push(`${id} is the base display and has no breakpoint.`);
      else if (pxValue(value) === undefined)
        errors.push(`${id}.${field} should be a whole number of pixels from ${DISPLAY_MIN_PX} to ${DISPLAY_MAX_PX}, not "${String(value)}".`);
    }
  }
  return { settings: cleanDisplaySettings(raw), errors };
}

/** Settings as `TW_DISPLAYS` text, in the pair form `parseDisplaySettings` reads. */
export function formatDisplaySettings(settings: DisplaySettings): string {
  const parts: string[] = [];
  for (const id of DISPLAY_IDS) {
    const entry = settings[id];
    if (!entry) continue;
    if (entry.width !== undefined && entry.height !== undefined) parts.push(`${id}.size=${entry.width}x${entry.height}`);
    else {
      if (entry.width !== undefined) parts.push(`${id}.width=${entry.width}`);
      if (entry.height !== undefined) parts.push(`${id}.height=${entry.height}`);
    }
    if (entry.breakpoint != null) parts.push(`${id}.breakpoint=${entry.breakpoint}`);
  }
  return parts.join(',');
}

/* --------------------------------------------------------------- cascade */

/** Styles inherited by `display` from the displays it cascades from (excluding its own). */
export function inheritedStyles(styles: DisplayStyles, display: DisplayId): StyleMap {
  const out: StyleMap = {};
  for (const parent of getDisplay(display).inherits) Object.assign(out, styles[parent]);
  return out;
}

/** The effective styles of a branch on a display: inherited styles overlaid with its own. */
export function resolveStyles(styles: DisplayStyles, display: DisplayId): StyleMap {
  return { ...inheritedStyles(styles, display), ...styles[display] };
}
