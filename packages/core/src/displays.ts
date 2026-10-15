import type { DisplayId, DisplayStyles, StyleMap } from './model';

export interface DisplayDef {
  id: DisplayId;
  label: string;
  /** Short label for compact toolbars. */
  short: string;
  /** Preview viewport size in CSS pixels. */
  width: number;
  height: number;
  /** Media query the display's styles are emitted under. `null` for the base display. */
  media: string | null;
  /** Displays whose styles cascade into this one, in order (first is lowest priority). */
  inherits: DisplayId[];
}

/**
 * Display types, in the order their CSS is emitted. `lg` (desktop large) is the base:
 * its styles apply everywhere unless a more specific display overrides them.
 *
 * Mobile displays inherit tablet styles, so a tablet override also reaches phones
 * unless a mobile display overrides it again.
 */
export const DISPLAYS: readonly DisplayDef[] = [
  { id: 'lg', label: 'Desktop large', short: 'LG', width: 1280, height: 800, media: null, inherits: [] },
  { id: 'xl', label: 'Desktop XL', short: 'XL', width: 1920, height: 1080, media: '(min-width: 1440px)', inherits: ['lg'] },
  { id: 'tablet', label: 'Tablet', short: 'Tab', width: 820, height: 1180, media: '(max-width: 1024px)', inherits: ['lg'] },
  {
    id: 'mobile-landscape',
    label: 'Mobile landscape',
    short: 'ML',
    width: 844,
    height: 390,
    media: '(max-width: 932px) and (orientation: landscape)',
    inherits: ['lg', 'tablet'],
  },
  {
    id: 'mobile-portrait',
    label: 'Mobile portrait',
    short: 'MP',
    width: 390,
    height: 844,
    media: '(max-width: 600px) and (orientation: portrait)',
    inherits: ['lg', 'tablet'],
  },
];

export const BASE_DISPLAY: DisplayId = 'lg';

export const DISPLAY_IDS: readonly DisplayId[] = DISPLAYS.map((d) => d.id);

export function getDisplay(id: DisplayId): DisplayDef {
  const def = DISPLAYS.find((d) => d.id === id);
  if (!def) throw new Error(`Unknown display "${id}"`);
  return def;
}

export function isDisplayId(value: unknown): value is DisplayId {
  return typeof value === 'string' && (DISPLAY_IDS as readonly string[]).includes(value);
}

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
