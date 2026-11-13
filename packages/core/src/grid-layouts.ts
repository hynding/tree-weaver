/*
 * Grid helpers that go past single columns: named areas, ready-made layouts, what a
 * grid does on smaller screens, and gap sizes in words.
 */
import { createBranch } from './create';
import { DISPLAYS, getDisplay, inheritedStyles, resolveStyles } from './displays';
import { countTracks, equalColumns } from './layout';
import { formatSpan, parseSpan, parseTracks } from './grid';
import type { Branch, DisplayId, StyleMap } from './model';
import { isBranch } from './model';
import { findNode, setStyle, updateNode } from './ops';

/* ------------------------------------------------------------ named areas */

/** A grid's named areas, one array of names per row. `.` marks an empty cell. */
export type GridAreas = string[][];

export const EMPTY_AREA = '.';

const AREA_NAME = /^[A-Za-z_][\w-]*$/;

/** Whether `name` can name a grid area (a CSS identifier). */
export const isAreaName = (name: string): boolean => AREA_NAME.test(name) && !/^(auto|span|inherit|initial|unset|none|revert|default)$/i.test(name);

/**
 * Read a `grid-template-areas` value. `none` or nothing gives `[]`; a value whose rows
 * differ in length, or that is not a list of quoted strings, gives `null`.
 */
export function parseAreas(value: string | undefined): GridAreas | null {
  const v = (value ?? '').trim();
  if (!v || v === 'none') return [];
  const rows: GridAreas = [];
  const re = /\s*(["'])(.*?)\1\s*/gy;
  let m: RegExpExecArray | null;
  let at = 0;
  while ((m = re.exec(v))) {
    at = re.lastIndex;
    const cells = m[2]
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((c) => (/^\.+$/.test(c) ? EMPTY_AREA : c));
    if (!cells.length) return null;
    rows.push(cells);
  }
  if (at !== v.length || !rows.length) return null;
  return rows.every((r) => r.length === rows[0].length) ? rows : null;
}

/** Write areas back as CSS, one quoted string per row. */
export function formatAreas(areas: GridAreas): string {
  if (!areas.length || !areas[0].length) return 'none';
  return areas.map((row) => `"${row.join(' ')}"`).join(' ');
}

/** Area names in reading order (first appearance), without empty cells. */
export function areaNames(areas: GridAreas): string[] {
  const names: string[] = [];
  for (const row of areas) for (const cell of row) if (cell !== EMPTY_AREA && !names.includes(cell)) names.push(cell);
  return names;
}

/** The rows and columns an area covers (0-based, inclusive). */
export function areaBounds(areas: GridAreas, name: string): { top: number; left: number; bottom: number; right: number } | null {
  let top = Infinity;
  let left = Infinity;
  let bottom = -1;
  let right = -1;
  areas.forEach((row, r) =>
    row.forEach((cell, c) => {
      if (cell !== name) return;
      top = Math.min(top, r);
      left = Math.min(left, c);
      bottom = Math.max(bottom, r);
      right = Math.max(right, c);
    }),
  );
  return bottom < 0 ? null : { top, left, bottom, right };
}

/** Names whose cells do not fill a rectangle. Browsers ignore the whole value while any exist. */
export function brokenAreas(areas: GridAreas): string[] {
  return areaNames(areas).filter((name) => {
    const b = areaBounds(areas, name)!;
    for (let r = b.top; r <= b.bottom; r++) for (let c = b.left; c <= b.right; c++) if (areas[r][c] !== name) return true;
    return false;
  });
}

/** Paint the rectangle between two cells (any corners, 0-based) with `name`. */
export function paintAreas(areas: GridAreas, from: [number, number], to: [number, number], name: string): GridAreas {
  const top = Math.min(from[0], to[0]);
  const bottom = Math.max(from[0], to[0]);
  const left = Math.min(from[1], to[1]);
  const right = Math.max(from[1], to[1]);
  return areas.map((row, r) => row.map((cell, c) => (r >= top && r <= bottom && c >= left && c <= right ? name : cell)));
}

/**
 * Change the number of rows and columns. New columns repeat the last column, so areas
 * on the edge stretch rather than break; new rows are empty.
 */
export function resizeAreas(areas: GridAreas, rows: number, cols: number): GridAreas {
  const r = Math.max(1, Math.floor(rows));
  const c = Math.max(1, Math.floor(cols));
  const out: GridAreas = [];
  for (let i = 0; i < r; i++) {
    const src = areas[i];
    out.push(Array.from({ length: c }, (_, j) => (src ? (src[j] ?? src[src.length - 1] ?? EMPTY_AREA) : EMPTY_AREA)));
  }
  return out;
}

/** Remove column `index` (0-based) from every row. */
export const removeAreaColumn = (areas: GridAreas, index: number): GridAreas =>
  areas[0]?.length > 1 ? areas.map((row) => row.filter((_, i) => i !== index)) : areas;

/** Remove row `index` (0-based). */
export const removeAreaRow = (areas: GridAreas, index: number): GridAreas => (areas.length > 1 ? areas.filter((_, i) => i !== index) : areas);

export const renameArea = (areas: GridAreas, from: string, to: string): GridAreas => areas.map((row) => row.map((c) => (c === from ? to : c)));

/** Areas in reading order, `cols` to a row. A short last row stretches its last area. */
export function flowAreas(names: string[], cols: number): GridAreas {
  const n = Math.max(1, Math.floor(cols));
  const out: GridAreas = [];
  for (let i = 0; i < names.length; i += n) {
    const row = names.slice(i, i + n);
    while (row.length < n) row.push(row[row.length - 1]);
    out.push(row);
  }
  return out;
}

const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^(\d)/, 'area-$1');

/** How many columns a grid has on a display, for sizing its areas. */
export function gridColumnCount(styles: StyleMap): number {
  const template = styles['grid-template-columns'];
  return parseTracks(template)?.length || countTracks(template) || 1;
}

/**
 * Give a grid named areas on one display: one per child, named after it and laid out in
 * reading order across the grid's columns, with each child placed in its area.
 */
export function startAreas(root: Branch, branchId: string, display: DisplayId): Branch {
  const branch = findNode(root, branchId);
  if (!isBranch(branch)) return root;
  const cols = gridColumnCount(resolveStyles(branch.styles, display));
  const children = childBranches(branch);
  const used = new Set<string>();
  const names = children.map((child) => {
    let base = slug(child.name ?? child.type ?? child.tag);
    if (!isAreaName(base)) base = 'box';
    let name = base;
    for (let k = 2; used.has(name); k++) name = `${base}-${k}`;
    used.add(name);
    return name;
  });
  const areas = names.length ? flowAreas(names, cols) : resizeAreas([], 1, cols);
  let next = setStyle(root, branchId, display, 'grid-template-areas', formatAreas(areas));
  children.forEach((child, i) => {
    next = setStyle(next, child.id, display, 'grid-area', names[i]);
    next = setStyle(next, child.id, display, 'grid-column', null);
    next = setStyle(next, child.id, display, 'grid-row', null);
  });
  return next;
}

/** Remove a grid's named areas on one display, and take its children out of them. */
export function clearAreas(root: Branch, branchId: string, display: DisplayId): Branch {
  const branch = findNode(root, branchId);
  if (!isBranch(branch)) return root;
  const inherited = parseAreas(inheritedStyles(branch.styles, display)['grid-template-areas']);
  let next = setStyle(root, branchId, display, 'grid-template-areas', inherited?.length ? 'none' : null);
  for (const child of childBranches(branch)) {
    const from = inheritedStyles(child.styles, display)['grid-area'];
    next = setStyle(next, child.id, display, 'grid-area', from && from !== 'auto' ? 'auto' : null);
  }
  return next;
}

/* --------------------------------------------------------------- layouts */

/** A ready-made grid to start from. */
export interface GridLayout {
  id: string;
  label: string;
  /** One line on when to use it. */
  hint: string;
  /** `grid-template-columns`. */
  columns: string;
  /** Named areas, when the layout has them. Children are placed in these, in order. */
  areas?: GridAreas;
  /** Boxes to make when the branch has fewer children (layouts without areas). */
  boxes?: number;
  /** Column sizes for the picture, in shares, so fixed widths still draw at thumbnail size. */
  picture: number[];
}

export const GRID_LAYOUTS: readonly GridLayout[] = [
  { id: 'two', label: 'Two columns', hint: 'Two equal columns', columns: equalColumns(2), boxes: 2, picture: [1, 1] },
  { id: 'three', label: 'Three columns', hint: 'Three equal columns', columns: equalColumns(3), boxes: 3, picture: [1, 1, 1] },
  { id: 'four', label: 'Four columns', hint: 'Four equal columns', columns: equalColumns(4), boxes: 4, picture: [1, 1, 1, 1] },
  {
    id: 'cards',
    label: 'Cards',
    hint: 'As many cards as fit; they wrap on smaller screens',
    columns: 'repeat(auto-fit, minmax(220px, 1fr))',
    boxes: 3,
    picture: [1, 1, 1],
  },
  {
    id: 'sidebar-left',
    label: 'Sidebar left',
    hint: 'A fixed sidebar beside the main content',
    columns: '260px minmax(0, 1fr)',
    areas: [['sidebar', 'main']],
    picture: [1, 3],
  },
  {
    id: 'sidebar-right',
    label: 'Sidebar right',
    hint: 'Main content with a fixed sidebar after it',
    columns: 'minmax(0, 1fr) 260px',
    areas: [['main', 'sidebar']],
    picture: [3, 1],
  },
  {
    id: 'page',
    label: 'Header, main, footer',
    hint: 'A page in three bands',
    columns: 'minmax(0, 1fr)',
    areas: [['header'], ['main'], ['footer']],
    picture: [1],
  },
  {
    id: 'holy-grail',
    label: 'Classic page',
    hint: 'Header and footer around navigation, main content and an aside',
    columns: '200px minmax(0, 1fr) 200px',
    areas: [
      ['header', 'header', 'header'],
      ['nav', 'main', 'aside'],
      ['footer', 'footer', 'footer'],
    ],
    picture: [1, 3, 1],
  },
  {
    id: 'dashboard',
    label: 'Dashboard',
    hint: 'A full-height sidebar with a header over the content',
    columns: '220px minmax(0, 1fr)',
    areas: [
      ['sidebar', 'header'],
      ['sidebar', 'main'],
    ],
    picture: [1, 3],
  },
  {
    id: 'feature',
    label: 'Hero and three',
    hint: 'A wide hero over three equal boxes',
    columns: equalColumns(3),
    areas: [
      ['hero', 'hero', 'hero'],
      ['card-1', 'card-2', 'card-3'],
    ],
    picture: [1, 1, 1],
  },
  {
    id: 'bento',
    label: 'Bento',
    hint: 'One large box with smaller boxes around it',
    columns: equalColumns(4),
    areas: [
      ['large', 'large', 'small-1', 'small-2'],
      ['large', 'large', 'wide', 'wide'],
    ],
    picture: [1, 1, 1, 1],
  },
];

export const getGridLayout = (id: string): GridLayout | undefined => GRID_LAYOUTS.find((l) => l.id === id);

const AREA_TAGS: Record<string, string> = { header: 'header', footer: 'footer', nav: 'nav', aside: 'aside', main: 'main', sidebar: 'aside' };

const titleCase = (name: string): string => name.replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

/** The layout a grid currently matches on a display, if any. */
export function matchGridLayout(styles: StyleMap): GridLayout | undefined {
  const norm = (v: string | undefined) => (v ?? '').replace(/\s+/g, ' ').trim();
  const areas = norm(styles['grid-template-areas']);
  return GRID_LAYOUTS.find(
    (l) => norm(l.columns) === norm(styles['grid-template-columns']) && (l.areas ? norm(formatAreas(l.areas)) === areas : !areas || areas === 'none'),
  );
}

const childBranches = (branch: Branch): Branch[] => branch.children.filter(isBranch);

/**
 * Turn a branch into a layout on one display: grid on, columns and areas set, a gap if it
 * has none. With areas, the branch's children go into them in order, and boxes are added
 * for areas no child fills. Returns the new root and the ids of any boxes made.
 */
export function applyGridLayout(root: Branch, branchId: string, display: DisplayId, layout: GridLayout): { root: Branch; created: string[] } {
  const branch = findNode(root, branchId);
  if (!isBranch(branch)) return { root, created: [] };
  const inherited = inheritedStyles(branch.styles, display);
  const resolved = resolveStyles(branch.styles, display);
  let next = root;
  const set = (id: string, prop: string, value: string | null) => (next = setStyle(next, id, display, prop, value));
  if (!(resolved.display ?? '').includes('grid')) set(branchId, 'display', 'grid');
  set(branchId, 'grid-template-columns', layout.columns);
  const hadAreas = !!parseAreas(inherited['grid-template-areas'])?.length;
  set(branchId, 'grid-template-areas', layout.areas ? formatAreas(layout.areas) : hadAreas ? 'none' : null);
  set(branchId, 'grid-template-rows', null);
  if (!resolved.gap) set(branchId, 'gap', GAP_PRESETS.find((g) => g.id === 'medium')!.value);

  const children = childBranches(branch);
  const created: string[] = [];
  const names = layout.areas ? areaNames(layout.areas) : [];
  const want = layout.areas ? names.length : (layout.boxes ?? 0);
  const extra: Branch[] = [];
  for (let i = children.length; i < want; i++) {
    const name = names[i];
    const box = createBranch({ tag: name ? (AREA_TAGS[name] ?? 'div') : 'div', type: 'box', name: name ? titleCase(name) : `Box ${i + 1}` });
    extra.push(box);
    created.push(box.id);
  }
  if (extra.length) next = updateNode(next, branchId, (node) => ({ ...(node as Branch), children: [...(node as Branch).children, ...extra] }));
  [...children, ...extra].forEach((child, i) => {
    const name = names[i];
    const own = child.styles[display] ?? {};
    const inheritedArea = inheritedStyles(child.styles, display)['grid-area'];
    if (name) {
      set(child.id, 'grid-area', name);
      set(child.id, 'grid-column', null);
      set(child.id, 'grid-row', null);
    } else if (own['grid-area'] || inheritedArea) set(child.id, 'grid-area', inheritedArea ? 'auto' : null);
  });
  return { root: next, created };
}

/* ------------------------------------------------------- smaller screens */

/** What a grid does on a smaller display. */
export type SmallScreenChoice =
  /** Same as the display it inherits from. */
  | { kind: 'keep' }
  /** One column, boxes stacked in reading order. */
  | { kind: 'stack' }
  /** A number of equal columns. */
  | { kind: 'columns'; count: number }
  /** Anything else set on this display. */
  | { kind: 'custom' };

/** Displays narrower than the base, where a grid may need to change. */
export const smallerDisplays = (): DisplayId[] => DISPLAYS.filter((d) => d.media?.includes('max-width')).map((d) => d.id);

const GRID_PROPS = ['grid-template-columns', 'grid-template-areas'] as const;

/** Read what a grid branch does on `display`. */
export function readSmallScreen(branch: Branch, display: DisplayId): SmallScreenChoice {
  const own = branch.styles[display] ?? {};
  if (!GRID_PROPS.some((p) => own[p] !== undefined)) return { kind: 'keep' };
  const styles = resolveStyles(branch.styles, display);
  const tracks = parseTracks(styles['grid-template-columns']);
  if (!tracks || !tracks.length || !tracks.every((t) => t.kind === 'share' && t.value === 1)) return { kind: 'custom' };
  const areas = parseAreas(styles['grid-template-areas']);
  const expected = (count: number) => {
    const names = areaNames(parseAreas(inheritedStyles(branch.styles, display)['grid-template-areas']) ?? []);
    return names.length ? formatAreas(count === 1 ? flowAreas(names, 1) : flowAreas(names, count)) : 'none';
  };
  if (areas && areas.length && formatAreas(areas) !== expected(tracks.length)) return { kind: 'custom' };
  return tracks.length === 1 ? { kind: 'stack' } : { kind: 'columns', count: tracks.length };
}

/**
 * Set what a grid does on a smaller display. Stacking or fewer columns also re-flows
 * named areas, and pulls in children that span or start past the last column.
 */
export function applySmallScreen(root: Branch, branchId: string, display: DisplayId, choice: SmallScreenChoice): Branch {
  const branch = findNode(root, branchId);
  if (!isBranch(branch) || choice.kind === 'custom') return root;
  let next = root;
  const set = (id: string, prop: string, value: string | null) => (next = setStyle(next, id, display, prop, value));
  const children = childBranches(branch);
  if (choice.kind === 'keep') {
    for (const p of GRID_PROPS) set(branchId, p, null);
    for (const child of children) set(child.id, 'grid-column', null);
    return next;
  }
  const count = choice.kind === 'stack' ? 1 : Math.max(1, Math.floor(choice.count));
  set(branchId, 'grid-template-columns', count === 1 ? 'minmax(0, 1fr)' : equalColumns(count));
  const inherited = inheritedStyles(branch.styles, display);
  const names = areaNames(parseAreas(inherited['grid-template-areas']) ?? []);
  set(branchId, 'grid-template-areas', names.length ? formatAreas(flowAreas(names, count)) : null);
  for (const child of children) {
    const styles = inheritedStyles(child.styles, display);
    if (styles['grid-area'] && names.includes(styles['grid-area'])) continue;
    const span = parseSpan(styles['grid-column']);
    if (span?.full) {
      set(child.id, 'grid-column', null);
      continue;
    }
    if (!span) {
      set(child.id, 'grid-column', 'auto');
      continue;
    }
    const fits = span.span <= count && (span.start === null || span.start + span.span - 1 <= count);
    set(child.id, 'grid-column', fits ? null : (formatSpan({ start: null, span: Math.min(span.span, count), full: false }) ?? 'auto'));
  }
  return next;
}

/** A label for a small-screen choice, e.g. "Stack" or "2 columns". */
export function smallScreenLabel(choice: SmallScreenChoice, display: DisplayId): string {
  switch (choice.kind) {
    case 'keep': {
      const from = getDisplay(display).inherits.slice(-1)[0];
      return from ? `Same as ${getDisplay(from).label}` : 'Same';
    }
    case 'stack':
      return 'Stack';
    case 'columns':
      return `${choice.count} columns`;
    case 'custom':
      return 'Custom';
  }
}

/* ------------------------------------------------------------------- gap */

export interface GapPreset {
  id: 'none' | 'small' | 'medium' | 'large';
  label: string;
  value: string;
}

export const GAP_PRESETS: readonly GapPreset[] = [
  { id: 'none', label: 'None', value: '0' },
  { id: 'small', label: 'Small', value: '0.5rem' },
  { id: 'medium', label: 'Medium', value: '1rem' },
  { id: 'large', label: 'Large', value: '2rem' },
];

/** The preset a gap value matches. `0px` and `8px`-style equivalents count. */
export function gapPreset(value: string | undefined): GapPreset | undefined {
  const v = (value ?? '').trim();
  if (!v) return undefined;
  const px = (s: string): number | null => {
    const m = /^(-?[\d.]+)(px|rem|em)?$/.exec(s);
    if (!m) return null;
    return m[2] === 'px' || !m[2] ? Number(m[1]) : Number(m[1]) * 16;
  };
  const parts = v.split(/\s+/);
  if (parts.length > 2 || (parts.length === 2 && px(parts[0]) !== px(parts[1]))) return undefined;
  const n = px(parts[0]);
  return n === null ? undefined : GAP_PRESETS.find((g) => px(g.value) === n);
}
