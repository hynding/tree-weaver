import { DISPLAYS, resolveStyles } from './displays';
import { isBranch, type Branch, type DesignKit, type DisplayId, type Leaf, type StyleMap, type Tree, type TreeNode } from './model';
import { VOID_TAGS } from './ops';
import { renderDocument } from './render';
import { canonicalTag, childrenInSvg, isSvgRoot } from './svg';

/**
 * Layout checks: problems a person would notice only by looking at a tree on every display.
 *
 * - `checkTree` reads the tree itself (no browser): missing alt text, heading order, links and
 *   buttons without a name, form fields without a label, duplicate ids, empty branches, fixed
 *   widths wider than a display, and low contrast between colors set in the tree.
 * - `checkRendered` also renders the page in a browser you pass in (Playwright's `Browser` fits)
 *   at each display's size, and adds what only layout shows: what overflows sideways, contrast with
 *   the design kits applied, and images that do not load.
 *
 * Every issue names a rule, the node (id and path, such as `/1/0`), the displays it shows on and a fix.
 */

export type CheckSeverity = 'error' | 'warning' | 'info';

export type CheckRule =
  | 'image-alt'
  | 'heading-order'
  | 'single-h1'
  | 'link-name'
  | 'link-href'
  | 'form-label'
  | 'duplicate-id'
  | 'empty-branch'
  | 'fixed-width'
  | 'contrast'
  | 'overflow'
  | 'image-broken';

export interface CheckIssue {
  rule: CheckRule;
  severity: CheckSeverity;
  message: string;
  fix: string;
  /** The branch or leaf's id. */
  id: string;
  /** Its child-index path, `/` for the root. */
  path: string;
  /** The displays the issue shows on; absent when it doesn't depend on the display. */
  displays?: DisplayId[];
}

export interface RenderedDisplay {
  display: DisplayId;
  width: number;
  height: number;
  pageWidth: number;
  pageHeight: number;
}

export interface CheckReport {
  tree: { id: string; name: string };
  /** No errors (warnings and notes are allowed). */
  ok: boolean;
  counts: { errors: number; warnings: number; info: number };
  issues: CheckIssue[];
  /** Page sizes per display, from `checkRendered`. */
  rendered?: RenderedDisplay[];
}

/* ------------------------------------------------------------------ colors */

export type Rgba = [number, number, number, number];

const NAMED: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  lime: '#00ff00',
  blue: '#0000ff',
  navy: '#000080',
  yellow: '#ffff00',
  orange: '#ffa500',
  purple: '#800080',
  gray: '#808080',
  grey: '#808080',
  silver: '#c0c0c0',
  lightgray: '#d3d3d3',
  lightgrey: '#d3d3d3',
  darkgray: '#a9a9a9',
  darkgrey: '#a9a9a9',
  maroon: '#800000',
  teal: '#008080',
  aqua: '#00ffff',
  cyan: '#00ffff',
  fuchsia: '#ff00ff',
  magenta: '#ff00ff',
  olive: '#808000',
  pink: '#ffc0cb',
  brown: '#a52a2a',
  whitesmoke: '#f5f5f5',
  gainsboro: '#dcdcdc',
};

/** A CSS color as [r, g, b, alpha], or null for anything this can't read (variables, `currentColor`, gradients, …). */
export function parseColor(value: string): Rgba | null {
  const v = value.trim().toLowerCase();
  if (v === 'transparent') return [0, 0, 0, 0];
  const named = NAMED[v];
  if (named) return parseColor(named);
  let m = /^#([0-9a-f]{3,8})$/.exec(v);
  if (m) {
    const h = m[1];
    if (h.length === 3 || h.length === 4) {
      const [r, g, b, a = 'f'] = h.split('');
      return [parseInt(r + r, 16), parseInt(g + g, 16), parseInt(b + b, 16), parseInt(a + a, 16) / 255];
    }
    if (h.length === 6 || h.length === 8) {
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
    }
    return null;
  }
  m = /^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/.exec(v);
  if (m) {
    const ch = (s: string) => (s.endsWith('%') ? (parseFloat(s) * 255) / 100 : parseFloat(s));
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return [ch(m[1]), ch(m[2]), ch(m[3]), a];
  }
  return null;
}

const luminance = ([r, g, b]: Rgba): number => {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

/** WCAG contrast ratio between two opaque colors, from 1 to 21. */
export function contrastRatio(a: Rgba, b: Rgba): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** WCAG AA: 4.5:1 for body text, 3:1 for large text (24px, or 18.66px bold). */
export const minContrast = (large: boolean): number => (large ? 3 : 4.5);

const hex = ([r, g, b]: Rgba): string => `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;

/* ------------------------------------------------------------- tree checks */

const HEADING = /^h([1-6])$/;
/** Elements that do something with no children. */
const SELF_CONTENT = new Set(['iframe', 'textarea', 'canvas', 'video', 'audio', 'select', 'object', 'td', 'th', 'progress', 'meter', 'slot', 'template']);
const UNLABELLED_INPUTS = new Set(['hidden', 'submit', 'button', 'reset', 'image']);

interface Visit {
  node: TreeNode;
  path: string;
  ancestors: Branch[];
  inSvg: boolean;
}

function visitAll(root: Branch): Visit[] {
  const out: Visit[] = [];
  const step = (node: TreeNode, path: string, ancestors: Branch[], inSvg: boolean) => {
    out.push({ node, path, ancestors, inSvg });
    if (!isBranch(node)) return;
    const childSvg = childrenInSvg(node, inSvg);
    node.children.forEach((child, i) => step(child, `${path === '/' ? '' : path}/${i}`, [...ancestors, node], childSvg));
  };
  step(root, '/', [], false);
  return out;
}

/** The text a node reads out: its text leaves, and image alt text. */
function textOf(node: TreeNode): string {
  if (!isBranch(node)) {
    if (node.type === 'text') return node.value;
    if (node.type === 'image') return node.attrs?.alt ?? '';
    return '';
  }
  return node.children.map(textOf).join(' ');
}

const hasStyles = (b: Branch): boolean => Object.values(b.styles).some((m) => m && Object.keys(m).length > 0);
const label = (b: Branch): string => (b.name ? `"${b.name}" (<${b.tag}>)` : `<${b.tag}>`);
const px = (value: string | undefined): number | null => {
  const m = /^\s*(-?[\d.]+)px\s*$/.exec(value ?? '');
  return m ? parseFloat(m[1]) : null;
};

/** Group per-display findings with the same key, so one problem inherited by every display is one issue. */
function grouped<T>(perDisplay: [DisplayId, T | null][], key: (t: T) => string): { value: T; displays: DisplayId[] }[] {
  const groups = new Map<string, { value: T; displays: DisplayId[] }>();
  for (const [display, value] of perDisplay) {
    if (value === null) continue;
    const k = key(value);
    const g = groups.get(k);
    if (g) g.displays.push(display);
    else groups.set(k, { value, displays: [display] });
  }
  return [...groups.values()];
}

/** The nearest explicit value of `props` on the branch or its ancestors, on a display. */
function inheritedValue(chain: Branch[], display: DisplayId, props: string[]): string | undefined {
  for (let i = chain.length - 1; i >= 0; i--) {
    const styles: StyleMap = resolveStyles(chain[i].styles, display);
    for (const p of props) if (styles[p] !== undefined) return styles[p];
  }
  return undefined;
}

/** The background color set on the branch or its ancestors, or null when it can't be told (an image, a gradient, a variable). */
function backgroundOf(chain: Branch[], display: DisplayId): Rgba | null | undefined {
  for (let i = chain.length - 1; i >= 0; i--) {
    const styles = resolveStyles(chain[i].styles, display);
    const value = styles['background-color'] ?? styles.background;
    if (value === undefined) continue;
    const color = parseColor(value);
    if (!color) return null;
    if (color[3] === 0) continue;
    return color[3] < 1 ? null : color;
  }
  return undefined;
}

function isLarge(chain: Branch[], display: DisplayId): boolean {
  const size = px(inheritedValue(chain, display, ['font-size']));
  const weight = inheritedValue(chain, display, ['font-weight']);
  const bold = weight === 'bold' || weight === 'bolder' || (weight !== undefined && parseInt(weight, 10) >= 700);
  if (size !== null) return size >= 24 || (bold && size >= 18.66);
  // Browser defaults: h1 is 32px and h2 24px.
  return chain.some((b) => /^h[12]$/.test(b.tag.toLowerCase()));
}

/** Check a tree without rendering it. */
export function checkTree(tree: Tree): CheckReport {
  const issues: CheckIssue[] = [];
  const visits = visitAll(tree.root);
  const svgTree = isSvgRoot(tree.root);
  const add = (issue: CheckIssue) => issues.push(issue);

  // Ids and labels across the tree.
  const ids = new Map<string, Visit[]>();
  const labelled = new Set<string>();
  for (const v of visits) {
    if (!isBranch(v.node)) continue;
    const id = v.node.attrs.id;
    if (id) ids.set(id, [...(ids.get(id) ?? []), v]);
    if (v.node.tag.toLowerCase() === 'label' && v.node.attrs.for) labelled.add(v.node.attrs.for);
  }
  for (const [id, list] of ids) {
    for (const v of list.slice(1)) {
      add({ rule: 'duplicate-id', severity: 'error', id: v.node.id, path: v.path, message: `id="${id}" is used ${list.length} times`, fix: 'Give each element its own id; links, labels and scripts find only the first one' });
    }
  }

  let lastLevel = 0;
  const h1s: Visit[] = [];
  for (const v of visits) {
    const { node, path, ancestors, inSvg } = v;
    if (!isBranch(node)) {
      if (node.type === 'image' && !inSvg && node.attrs?.alt === undefined) {
        add({ rule: 'image-alt', severity: 'error', id: node.id, path, message: `Image ${node.value ? `"${node.value.slice(0, 60)}" ` : ''}has no alt text`, fix: 'Set attrs.alt to what the image shows, or to "" when it is only decoration' });
      }
      continue;
    }
    if (inSvg || canonicalTag(node.tag) === 'svg') continue;
    const tag = node.tag.toLowerCase();
    const attrs = node.attrs;
    const named = !!(attrs['aria-label'] || attrs['aria-labelledby'] || attrs.title);

    const heading = HEADING.exec(tag);
    if (heading) {
      const level = Number(heading[1]);
      if (level === 1) h1s.push(v);
      if (lastLevel && level > lastLevel + 1) {
        add({ rule: 'heading-order', severity: 'warning', id: node.id, path, message: `<h${level}> follows <h${lastLevel}>, skipping a level`, fix: `Use <h${lastLevel + 1}>, and size it with styles if it should look smaller` });
      } else if (!lastLevel && level > 2 && !svgTree) {
        add({ rule: 'heading-order', severity: 'info', id: node.id, path, message: `The first heading is <h${level}>`, fix: 'Start the page with an <h1> (or <h2> in a section that sits under one)' });
      }
      lastLevel = level;
    }

    if ((tag === 'a' || tag === 'button') && !named && !textOf(node).trim()) {
      add({ rule: 'link-name', severity: 'error', id: node.id, path, message: `${label(node)} has no text or label, so screen readers announce nothing`, fix: 'Add text, an image with alt text, or attrs["aria-label"]' });
    }
    if (tag === 'a' && attrs.href === undefined) {
      add({ rule: 'link-href', severity: 'warning', id: node.id, path, message: `${label(node)} has no href, so it can't be followed or focused`, fix: 'Set attrs.href, or use a <button> (or a <span>) when it is not a link' });
    }
    if ((tag === 'input' && !UNLABELLED_INPUTS.has((attrs.type ?? 'text').toLowerCase())) || tag === 'select' || tag === 'textarea') {
      const inLabel = ancestors.some((a) => a.tag.toLowerCase() === 'label');
      if (!named && !inLabel && !(attrs.id && labelled.has(attrs.id))) {
        add({ rule: 'form-label', severity: 'warning', id: node.id, path, message: `${label(node)} has no label`, fix: 'Add a <label> with for= its id, wrap it in a <label>, or set attrs["aria-label"]' });
      }
    }
    if (path !== '/' && !node.children.length && !VOID_TAGS.has(tag) && !SELF_CONTENT.has(tag) && !hasStyles(node) && !node.classes.length && !Object.keys(attrs).some((a) => a !== 'id')) {
      add({ rule: 'empty-branch', severity: 'warning', id: node.id, path, message: `${label(node)} is empty and has no styles, so it renders nothing`, fix: 'Add content or styles, or remove it' });
    }

    // Per display: fixed widths wider than the screen, and contrast between colors set in the tree.
    const widths = grouped(
      DISPLAYS.map((d): [DisplayId, { prop: string; px: number; screen: number } | null] => {
        const styles = resolveStyles(node.styles, d.id);
        for (const prop of ['min-width', 'width']) {
          const w = px(styles[prop]);
          if (w !== null && w > d.width && (styles['max-width'] === undefined || styles['max-width'] === 'none')) return [d.id, { prop, px: w, screen: d.width }];
        }
        return [d.id, null];
      }),
      (w) => `${w.prop}:${w.px}`,
    );
    for (const { value, displays } of widths) {
      add({
        rule: 'fixed-width',
        severity: 'warning',
        id: node.id,
        path,
        displays,
        message: `${label(node)} has ${value.prop}: ${value.px}px, wider than ${displays.join(', ')} (${value.screen}px), so the page scrolls sideways`,
        fix: `Use max-width: ${value.px}px with width: 100%, or override ${value.prop} on the smaller displays`,
      });
    }

    const ownText = node.children.some((c) => !isBranch(c) && (c as Leaf).type === 'text' && (c as Leaf).value.trim());
    if (ownText && !svgTree) {
      const chain = [...ancestors, node];
      const contrast = grouped(
        DISPLAYS.map((d): [DisplayId, { fg: Rgba; bg: Rgba; ratio: number; min: number } | null] => {
          const colorValue = inheritedValue(chain, d.id, ['color']);
          const fg = colorValue === undefined ? null : parseColor(colorValue);
          const bg = backgroundOf(chain, d.id);
          if (!fg || fg[3] < 1 || !bg) return [d.id, null];
          const ratio = contrastRatio(fg, bg);
          const min = minContrast(isLarge(chain, d.id));
          return [d.id, ratio < min ? { fg, bg, ratio, min } : null];
        }),
        (c) => `${hex(c.fg)}/${hex(c.bg)}/${c.min}`,
      );
      for (const { value, displays } of contrast) {
        add({
          rule: 'contrast',
          severity: 'warning',
          id: node.id,
          path,
          displays,
          message: `Text in ${label(node)} is ${hex(value.fg)} on ${hex(value.bg)}: contrast ${value.ratio.toFixed(2)}:1, below ${value.min}:1`,
          fix: 'Darken the text or lighten the background (or the reverse) until the ratio passes',
        });
      }
    }
  }
  if (h1s.length > 1) {
    for (const v of h1s.slice(1)) {
      add({ rule: 'single-h1', severity: 'warning', id: v.node.id, path: v.path, message: `One of ${h1s.length} <h1> headings; a page usually has one`, fix: 'Keep one <h1> for the page title and make the others <h2>' });
    }
  }
  return report(tree, issues);
}

function report(tree: Tree, issues: CheckIssue[], rendered?: RenderedDisplay[]): CheckReport {
  const order: Record<CheckSeverity, number> = { error: 0, warning: 1, info: 2 };
  const steps = (p: string) => p.split('/').filter(Boolean).map(Number);
  const byPath = (a: string, b: string) => {
    const [x, y] = [steps(a), steps(b)];
    for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
    return x.length - y.length;
  };
  issues.sort((a, b) => order[a.severity] - order[b.severity] || byPath(a.path, b.path));
  const count = (s: CheckSeverity) => issues.filter((i) => i.severity === s).length;
  const counts = { errors: count('error'), warnings: count('warning'), info: count('info') };
  return { tree: { id: tree.id, name: tree.name }, ok: counts.errors === 0, counts, issues, ...(rendered ? { rendered } : {}) };
}

/** The report as lines of text: one per issue, with its path, displays and fix. */
export function formatCheckReport(r: CheckReport): string {
  const head = `${r.ok ? 'ok' : 'FAILED'} "${r.tree.name}": ${r.counts.errors} error${r.counts.errors === 1 ? '' : 's'}, ${r.counts.warnings} warning${r.counts.warnings === 1 ? '' : 's'}, ${r.counts.info} note${r.counts.info === 1 ? '' : 's'}`;
  const sizes = (r.rendered ?? []).map((d) => `  ${d.display}: ${d.width}×${d.height}, page ${d.pageWidth}×${d.pageHeight}${d.pageWidth > d.width ? ' (scrolls sideways)' : ''}`);
  const lines = r.issues.map((i) => `  ${i.severity} ${i.rule} at ${i.path}${i.displays ? ` [${i.displays.join(', ')}]` : ''}: ${i.message}\n    Fix: ${i.fix}`);
  return [head, ...sizes, ...lines].join('\n');
}

/* ---------------------------------------------------------- browser checks */

/** The bits of a Playwright `Browser` that `checkRendered` uses. */
export interface CheckBrowser {
  newPage(options: { viewport: { width: number; height: number }; javaScriptEnabled: boolean }): Promise<CheckPage>;
}
export interface CheckPage {
  setContent(html: string, options: { waitUntil: 'load'; timeout: number }): Promise<unknown>;
  evaluate<T>(script: string): Promise<T>;
  close(): Promise<void>;
}

interface PageFindings {
  pageWidth: number;
  pageHeight: number;
  overflow: { id: string; right: number; width: number }[];
  contrast: { id: string; fg: string; bg: string; ratio: number; min: number }[];
  broken: { id: string; src: string }[];
}

/**
 * Runs in the page. Plain ES2017 in a string, so the library needs no DOM types and the page needs
 * no scripts of its own (it runs with JavaScript off; Playwright evaluates in its own world).
 */
export const RENDER_CHECK_SCRIPT = `(() => {
  const vw = document.documentElement.clientWidth;
  const owner = (el) => el.closest('[data-tw]') || el.closest('[data-tw-leaf]');
  const idOf = (el) => { const o = owner(el); return o ? (o.getAttribute('data-tw') || o.getAttribute('data-tw-leaf')) : null; };
  const clips = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const s = getComputedStyle(p); if (/(hidden|auto|scroll|clip)/.test(s.overflowX)) return true; } return false; };
  const overflow = [];
  const marked = new Set();
  for (const el of document.body.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (!r.width || r.right <= vw + 1 || clips(el)) continue;
    const s = getComputedStyle(el);
    if (s.position === 'fixed' || s.visibility === 'hidden') continue;
    let p = el.parentElement, inside = false;
    for (; p; p = p.parentElement) if (marked.has(p)) { inside = true; break; }
    marked.add(el);
    if (inside) continue;
    // A grid or flex item that sticks out usually means its container's tracks are too wide: blame the container.
    let culprit = el;
    const parent = el.parentElement;
    if (parent && parent !== document.body && /(grid|flex)/.test(getComputedStyle(parent).display) && parent.getBoundingClientRect().right <= vw + 1) culprit = parent;
    const id = idOf(culprit);
    const box = culprit.getBoundingClientRect();
    if (id && !overflow.some((o) => o.id === id)) overflow.push({ id, right: Math.round(Math.max(r.right, box.right)), width: Math.round(culprit === el ? r.width : culprit.scrollWidth) });
  }
  const parse = (c) => { const m = /rgba?\\(([^)]+)\\)/.exec(c); if (!m) return null; const p = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const blend = (top, under) => { const a = top[3]; return [top[0] * a + under[0] * (1 - a), top[1] * a + under[1] * (1 - a), top[2] * a + under[2] * (1 - a), 1]; };
  const hex = (c) => '#' + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  const background = (el) => {
    const layers = [];
    for (let p = el; p; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.backgroundImage && s.backgroundImage !== 'none') return null;
      const c = parse(s.backgroundColor);
      if (c && c[3] > 0) { layers.push(c); if (c[3] >= 1) break; }
    }
    let bg = [255, 255, 255, 1];
    for (let i = layers.length - 1; i >= 0; i--) bg = blend(layers[i], bg);
    return bg;
  };
  const contrast = [];
  const seen = new Set();
  for (const el of document.body.querySelectorAll('*')) {
    if (el.closest('svg')) continue;
    const text = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!text || !el.getClientRects().length) continue;
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || Number(s.opacity) === 0) continue;
    const bg = background(el);
    const fg0 = parse(s.color);
    if (!bg || !fg0) continue;
    const fg = fg0[3] < 1 ? blend(fg0, bg) : fg0;
    const l1 = lum(fg), l2 = lum(bg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const size = parseFloat(s.fontSize), bold = Number(s.fontWeight) >= 700;
    const min = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
    const id = idOf(el);
    if (ratio < min && id && !seen.has(id)) { seen.add(id); contrast.push({ id, fg: hex(fg), bg: hex(bg), ratio: Math.round(ratio * 100) / 100, min }); }
  }
  const broken = [];
  for (const img of document.querySelectorAll('img')) {
    if (img.complete && img.naturalWidth === 0 && img.getAttribute('src')) { const id = idOf(img); if (id) broken.push({ id, src: img.getAttribute('src') }); }
  }
  return { pageWidth: document.documentElement.scrollWidth, pageHeight: document.documentElement.scrollHeight, overflow, contrast, broken };
})()`;

export interface RenderCheckOptions {
  /** Design kits to render with (enabled ones load, like in the editor). */
  kits?: DesignKit[];
  /** Displays to render (default: all). */
  displays?: DisplayId[];
  /** A browser: Playwright's `chromium.launch()` result works. */
  browser: CheckBrowser;
  /** Milliseconds to wait for each page to load (default 15000). */
  timeout?: number;
}

/** `checkTree`, plus checks on the page rendered at each display's size. Contrast comes from the browser then. */
export async function checkRendered(tree: Tree, opts: RenderCheckOptions): Promise<CheckReport> {
  const base = checkTree(tree);
  const issues = base.issues.filter((i) => i.rule !== 'contrast');
  const visits = visitAll(tree.root);
  const paths = new Map(visits.map((v) => [v.node.id, v.path]));
  const nodes = new Map(visits.map((v) => [v.node.id, v.node]));
  const html = renderDocument(tree, { kits: opts.kits ?? [] });
  const wanted = opts.displays?.length ? DISPLAYS.filter((d) => opts.displays!.includes(d.id)) : DISPLAYS;
  const rendered: RenderedDisplay[] = [];
  const found = { overflow: [] as [DisplayId, PageFindings['overflow'][number]][], contrast: [] as [DisplayId, PageFindings['contrast'][number]][], broken: new Map<string, string>() };
  for (const d of wanted) {
    const page = await opts.browser.newPage({ viewport: { width: d.width, height: d.height }, javaScriptEnabled: false });
    try {
      await page.setContent(html, { waitUntil: 'load', timeout: opts.timeout ?? 15000 }).catch(() => undefined);
      const f = await page.evaluate<PageFindings>(RENDER_CHECK_SCRIPT);
      rendered.push({ display: d.id, width: d.width, height: d.height, pageWidth: f.pageWidth, pageHeight: f.pageHeight });
      for (const o of f.overflow) found.overflow.push([d.id, o]);
      for (const c of f.contrast) found.contrast.push([d.id, c]);
      for (const b of f.broken) found.broken.set(b.id, b.src);
    } finally {
      await page.close();
    }
  }
  const nodeLabel = (id: string): string => {
    const node = nodes.get(id);
    return node && isBranch(node) ? label(node) : node ? 'An image' : 'This node';
  };
  const byNode = <T>(list: [DisplayId, T & { id: string }][], key: (t: T) => string) => {
    const groups = new Map<string, { value: T & { id: string }; displays: DisplayId[] }>();
    for (const [display, value] of list) {
      const k = `${value.id}|${key(value)}`;
      const g = groups.get(k);
      if (g) g.displays.push(display);
      else groups.set(k, { value, displays: [display] });
    }
    return [...groups.values()];
  };
  for (const { value, displays } of byNode(found.overflow, () => '')) {
    const sizes = displays.map((id) => `${id} ${DISPLAYS.find((d) => d.id === id)!.width}px`).join(', ');
    issues.push({
      rule: 'overflow',
      severity: 'warning',
      id: value.id,
      path: paths.get(value.id) ?? '?',
      displays,
      message: `${nodeLabel(value.id)} reaches past the right edge of the screen (${sizes}; ${value.width}px wide), so the page scrolls sideways`,
      fix: 'Let it shrink: max-width: 100%, fewer grid columns or flex-wrap: wrap on smaller displays, or overflow-x: auto on a wrapper for wide tables',
    });
  }
  for (const { value, displays } of byNode(found.contrast, (c) => `${c.fg}/${c.bg}/${c.min}`)) {
    issues.push({
      rule: 'contrast',
      severity: 'warning',
      id: value.id,
      path: paths.get(value.id) ?? '?',
      displays,
      message: `Text in ${nodeLabel(value.id)} renders ${value.fg} on ${value.bg}: contrast ${value.ratio.toFixed(2)}:1, below ${value.min}:1`,
      fix: 'Darken the text or lighten the background (or the reverse), in the tree or the design kit',
    });
  }
  for (const [id, src] of found.broken) {
    issues.push({ rule: 'image-broken', severity: 'warning', id, path: paths.get(id) ?? '?', message: `Image "${src.slice(0, 80)}" did not load`, fix: 'Check the URL; relative URLs need the page to be served from the right folder' });
  }
  return report(tree, issues, rendered);
}
