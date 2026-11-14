import {
  getDisplay,
  isBranch,
  isSafeAttr,
  isSvgRoot,
  parseAutoColumns,
  parseRulesCss,
  parseTracks,
  resolveStyles,
  type Branch,
  type DesignKit,
  type DisplayId,
  type DisplayStyles,
  type StyleMap,
  type Tree,
  type TreeNode,
} from '@tree-weaver/core';

/**
 * Native exports: a tree as a SwiftUI view or a Flutter widget, for iOS, macOS, Android and
 * other platforms that don't render HTML.
 *
 * The tree is read into a small set of native building blocks: vertical and horizontal stacks,
 * grids, text with heading levels, images, links, buttons, text fields, dividers, lists and
 * tables. The styles that carry over (padding, background, colour, font size and weight, text
 * alignment, corner radius, border, width, height, gap, opacity) come from the branch and from
 * design kit rules on single classes (`.card { ... }`), with `var(--token)` values resolved.
 *
 * Displays become screen widths: SwiftUI uses the desktop styles for regular width (iPad, Mac)
 * and the mobile portrait styles for compact width (iPhone); Flutter switches at the tablet and
 * mobile portrait breakpoints. Layout changes between them (3 columns to 1, a row that stacks,
 * a branch hidden on phones) carry over too.
 */

export type NativeFramework = 'swiftui' | 'flutter';

export interface NativeOptions {
  kits?: DesignKit[];
  /** Type name (PascalCase). */
  name: string;
}

/* ------------------------------------------------------------- tiers */

/** The widths a native layout switches between: desktop, tablet, phone. */
type Tier = 'lg' | 'tablet' | 'phone';
const TIERS: readonly Tier[] = ['lg', 'tablet', 'phone'];
const TIER_DISPLAY: Record<Tier, DisplayId> = { lg: 'lg', tablet: 'tablet', phone: 'mobile-portrait' };
type Tiered<T> = Record<Tier, T>;

const tiered = <T>(fn: (t: Tier) => T): Tiered<T> => ({ lg: fn('lg'), tablet: fn('tablet'), phone: fn('phone') });
const same = <T>(v: Tiered<T>): boolean => JSON.stringify(v.lg) === JSON.stringify(v.tablet) && JSON.stringify(v.lg) === JSON.stringify(v.phone);

/* ------------------------------------------------------------- values */

/** A CSS length in points (1px = 1pt, 1rem = 16). Undefined for percentages, `auto` and the like. */
export function cssLength(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const v = value.trim();
  if (v === '0') return 0;
  const m = /^(-?\d*\.?\d+)(px|rem|em|pt)?$/.exec(v);
  if (!m) return undefined;
  const n = Number(m[1]);
  return m[2] === 'rem' || m[2] === 'em' ? n * 16 : n;
}

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const NAMED: Record<string, string> = {
  white: '#ffffff',
  black: '#000000',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  gray: '#808080',
  grey: '#808080',
  silver: '#c0c0c0',
  orange: '#ffa500',
  yellow: '#ffff00',
  purple: '#800080',
  navy: '#000080',
  teal: '#008080',
};

/** A CSS colour as RGBA (0–255, alpha 0–1). Undefined for colours it can't read (gradients, `currentColor`). */
export function cssColor(value: string | undefined): Rgba | undefined {
  if (!value) return undefined;
  let v = value.trim().toLowerCase();
  if (v === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  v = NAMED[v] ?? v;
  let m = /^#([0-9a-f]{3,8})$/.exec(v);
  if (m) {
    let hex = m[1];
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join('');
    if (hex.length !== 6 && hex.length !== 8) return undefined;
    const n = (i: number) => parseInt(hex.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: hex.length === 8 ? Math.round((n(6) / 255) * 100) / 100 : 1 };
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(v);
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? Number(m[4].slice(0, -1)) / 100 : Number(m[4]);
    return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a };
  }
  return undefined;
}

/** Replace `var(--name, fallback)` with the token's value, a few levels deep. */
function resolveVars(value: string, tokens: Map<string, string>, depth = 0): string {
  if (depth > 5 || !value.includes('var(')) return value;
  const out = value.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\))?[^()]*))?\)/g, (_m, name: string, fallback?: string) => tokens.get(name) ?? fallback?.trim() ?? '');
  return resolveVars(out, tokens, depth + 1);
}

interface Edges {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

function edges(styles: StyleMap, prop: 'padding' | 'margin'): Edges & { autoX: boolean } {
  const out = { top: 0, right: 0, bottom: 0, left: 0, autoX: false };
  const short = styles[prop]?.trim().split(/\s+/) ?? [];
  if (short.length) {
    const [t, r = t, b = t, l = r] = short;
    out.top = cssLength(t) ?? 0;
    out.right = cssLength(r) ?? 0;
    out.bottom = cssLength(b) ?? 0;
    out.left = cssLength(l) ?? 0;
    out.autoX = r === 'auto' && l === 'auto';
  }
  const inline = styles[`${prop}-inline`]?.trim().split(/\s+/);
  if (inline) {
    out.left = cssLength(inline[0]) ?? out.left;
    out.right = cssLength(inline[1] ?? inline[0]) ?? out.right;
    if (inline[0] === 'auto') out.autoX = true;
  }
  const block = styles[`${prop}-block`]?.trim().split(/\s+/);
  if (block) {
    out.top = cssLength(block[0]) ?? out.top;
    out.bottom = cssLength(block[1] ?? block[0]) ?? out.bottom;
  }
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const v = styles[`${prop}-${side}`];
    if (v !== undefined) out[side] = cssLength(v) ?? out[side];
  }
  return out;
}

/* ------------------------------------------------------------ the model */

type TextRole = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'body' | 'small' | 'code';

/** Styles a native view understands, for one tier. */
interface Look {
  padding: Edges;
  background?: Rgba;
  color?: Rgba;
  fontSize?: number;
  bold?: number;
  italic: boolean;
  align?: 'leading' | 'center' | 'trailing';
  radius?: number;
  border?: { width: number; color: Rgba };
  width?: number;
  maxWidth?: number;
  height?: number;
  opacity?: number;
  /** `margin: 0 auto`: centred in its parent. */
  centered: boolean;
  hidden: boolean;
}

interface Layout {
  kind: 'stack' | 'grid';
  /** Stacks: vertical (block, column) or horizontal (flex row). */
  axis: 'v' | 'h';
  wrap: boolean;
  /** Grids: a column count, or a minimum column width for auto-fit grids. */
  columns: number;
  minColumn?: number;
  gap: number;
  /** Cross-axis alignment of children. */
  align: 'start' | 'center' | 'end' | 'stretch';
  /** Main-axis distribution in a horizontal stack. */
  justify: 'start' | 'center' | 'end' | 'between';
}

type NView =
  | { kind: 'text'; text: string; role: TextRole; look: Tiered<Look>; link?: string; button?: boolean }
  | { kind: 'image'; src: string; alt: string; look: Tiered<Look> }
  | { kind: 'divider' }
  | { kind: 'field'; placeholder: string; multiline: boolean; look: Tiered<Look> }
  | { kind: 'box'; layout: Tiered<Layout>; children: NView[]; look: Tiered<Look>; note?: string }
  | { kind: 'list'; ordered: boolean; items: NView[]; look: Tiered<Look> }
  | { kind: 'table'; rows: { header: boolean; cells: NView[] }[]; look: Tiered<Look> }
  | { kind: 'placeholder'; note: string };

const HEADING: Record<string, TextRole> = { h1: 'h1', h2: 'h2', h3: 'h3', h4: 'h4', h5: 'h5', h6: 'h6', small: 'small', code: 'code', pre: 'code', figcaption: 'small' };
/** Tags whose content reads as one run of text when it holds only text and inline tags. */
const TEXT_BLOCKS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'label', 'li', 'a', 'button', 'small', 'strong', 'em', 'b', 'i', 'figcaption', 'blockquote', 'code', 'pre', 'td', 'th', 'caption', 'dt', 'dd', 'cite', 'q', 'mark', 'time', 'abbr', 'legend', 'summary']);
const INLINE = new Set(['span', 'a', 'strong', 'em', 'b', 'i', 'small', 'code', 'mark', 'abbr', 'cite', 'q', 'time', 'sub', 'sup', 'u', 's', 'br', 'kbd', 'var', 'samp']);

interface Ctx {
  /** Styles of single-class kit rules, by class name. */
  classStyles: Map<string, DisplayStyles>;
  tokens: Map<string, string>;
}

function buildCtx(kits: DesignKit[]): Ctx {
  const classStyles = new Map<string, DisplayStyles>();
  const tokens = new Map<string, string>();
  for (const kit of kits) {
    if (!kit.enabled || !kit.css.trim()) continue;
    const rules = kit.rules ?? parseRulesCss(kit.css).rules;
    for (const rule of rules) {
      const sel = rule.selector.trim();
      if (sel === ':root' || sel === 'html' || sel === 'body') {
        for (const [k, v] of Object.entries(rule.styles.lg ?? {})) if (k.startsWith('--')) tokens.set(k, v);
        continue;
      }
      const m = /^\.([\w-]+)$/.exec(sel);
      if (!m) continue;
      const prev = classStyles.get(m[1]) ?? {};
      const merged: DisplayStyles = { ...prev };
      for (const [d, map] of Object.entries(rule.styles) as [DisplayId, StyleMap][]) merged[d] = { ...prev[d], ...map };
      classStyles.set(m[1], merged);
    }
  }
  return { classStyles, tokens };
}

/** A branch's styles per tier: its kit classes' rules, then its own styles, cascaded. */
function stylesOf(branch: Branch, ctx: Ctx): Tiered<StyleMap> {
  const merged: DisplayStyles = {};
  for (const c of branch.classes) {
    const s = ctx.classStyles.get(c);
    if (!s) continue;
    for (const [d, map] of Object.entries(s) as [DisplayId, StyleMap][]) merged[d] = { ...merged[d], ...map };
  }
  for (const [d, map] of Object.entries(branch.styles) as [DisplayId, StyleMap][]) merged[d] = { ...merged[d], ...map };
  return tiered((t) => {
    const raw = resolveStyles(merged, TIER_DISPLAY[t]);
    const out: StyleMap = {};
    for (const [k, v] of Object.entries(raw)) if (!k.startsWith('--')) out[k] = resolveVars(v, ctx.tokens);
    return out;
  });
}

function lookOf(s: StyleMap): Look {
  const padding = edges(s, 'padding');
  const margin = edges(s, 'margin');
  const weight = s['font-weight'];
  const bold = weight === 'bold' || weight === 'bolder' ? 700 : weight && /^\d+$/.test(weight) ? Number(weight) : undefined;
  const ta = s['text-align'];
  const borderParts = s.border?.split(/\s+/) ?? [];
  const borderWidth = borderParts.map(cssLength).find((n) => n !== undefined);
  const borderColor = borderParts.map(cssColor).find(Boolean);
  const bg = cssColor(s['background-color'] ?? s.background);
  const opacity = s.opacity !== undefined ? Number(s.opacity) : undefined;
  return {
    padding: { top: padding.top, right: padding.right, bottom: padding.bottom, left: padding.left },
    background: bg && bg.a > 0 ? bg : undefined,
    color: cssColor(s.color),
    fontSize: cssLength(s['font-size']),
    bold,
    italic: s['font-style'] === 'italic',
    align: ta === 'center' ? 'center' : ta === 'right' || ta === 'end' ? 'trailing' : ta === 'left' || ta === 'start' ? 'leading' : undefined,
    radius: cssLength(s['border-radius']?.split(/\s+/)[0]),
    border: borderWidth && borderColor ? { width: borderWidth, color: borderColor } : undefined,
    width: cssLength(s.width),
    maxWidth: cssLength(s['max-width']),
    height: cssLength(s.height) ?? cssLength(s['min-height']),
    opacity: opacity !== undefined && Number.isFinite(opacity) && opacity < 1 ? opacity : undefined,
    centered: margin.autoX,
    hidden: s.display === 'none',
  };
}

function layoutOf(s: StyleMap): Layout {
  const gap = cssLength(s.gap?.split(/\s+/)[0] ?? s['column-gap'] ?? s['row-gap']) ?? 0;
  const ai = s['align-items'];
  const align: Layout['align'] = ai === 'center' ? 'center' : ai === 'flex-end' || ai === 'end' ? 'end' : ai === 'stretch' ? 'stretch' : 'start';
  const jc = s['justify-content'];
  const justify: Layout['justify'] = jc === 'center' ? 'center' : jc === 'flex-end' || jc === 'end' ? 'end' : jc === 'space-between' || jc === 'space-around' || jc === 'space-evenly' ? 'between' : 'start';
  const display = s.display ?? 'block';
  if (display === 'grid' || display === 'inline-grid') {
    const template = s['grid-template-columns'];
    const auto = parseAutoColumns(template);
    if (auto) return { kind: 'grid', axis: 'v', wrap: false, columns: 1, minColumn: cssLength(auto.minWidth) ?? 200, gap, align, justify };
    const tracks = parseTracks(template);
    return { kind: 'grid', axis: 'v', wrap: false, columns: Math.max(1, tracks?.length ?? 1), gap, align, justify };
  }
  if (display === 'flex' || display === 'inline-flex') {
    const dir = s['flex-direction'] ?? 'row';
    return { kind: 'stack', axis: dir.startsWith('column') ? 'v' : 'h', wrap: s['flex-wrap'] === 'wrap', columns: 1, gap, align, justify };
  }
  return { kind: 'stack', axis: 'v', wrap: false, columns: 1, gap, align: 'stretch', justify: 'start' };
}

/** Text of a branch made only of text and inline tags, or null when it holds blocks or media. */
function inlineText(branch: Branch): string | null {
  let out = '';
  for (const c of branch.children) {
    if (isBranch(c)) {
      if (c.tag === 'br') {
        out += '\n';
        continue;
      }
      if (!INLINE.has(c.tag)) return null;
      const inner = inlineText(c);
      if (inner === null) return null;
      out += inner;
    } else if (c.type === 'text') out += c.value;
    else return null;
  }
  return out;
}

const tidy = (text: string) => text.replace(/[ \t\r\f]+/g, ' ').replace(/ ?\n ?/g, '\n').trim();

function safeUrl(value: string | undefined): string {
  const v = (value ?? '').trim();
  return isSafeAttr('href', v) && !/^\s*(javascript|data|vbscript):/i.test(v) ? v : '';
}

function toView(node: TreeNode, ctx: Ctx): NView | null {
  if (!isBranch(node)) {
    if (node.type === 'text') {
      const text = tidy(node.value);
      return text ? { kind: 'text', text, role: 'body', look: tiered(() => lookOf({})) } : null;
    }
    if (node.type === 'image') return { kind: 'image', src: safeUrl(node.value), alt: node.attrs?.alt ?? '', look: tiered(() => lookOf({})) };
    return null;
  }
  const b = node;
  const styles = stylesOf(b, ctx);
  const look = tiered((t) => lookOf(styles[t]));
  if (isSvgRoot(b) || b.tag === 'svg') return { kind: 'placeholder', note: `SVG drawing${b.name ? ` "${b.name}"` : ''}: export the tree as .svg and add it as an image asset` };
  switch (b.tag) {
    case 'hr':
      return { kind: 'divider' };
    case 'img':
      return { kind: 'image', src: safeUrl(b.attrs.src), alt: b.attrs.alt ?? '', look };
    case 'input':
    case 'textarea':
      return { kind: 'field', placeholder: b.attrs.placeholder ?? b.attrs['aria-label'] ?? b.attrs.name ?? '', multiline: b.tag === 'textarea', look };
    case 'script':
    case 'style':
    case 'template':
      return null;
    case 'ul':
    case 'ol': {
      const items = b.children.map((c) => toView(c, ctx)).filter((v): v is NView => !!v);
      return { kind: 'list', ordered: b.tag === 'ol', items, look };
    }
    case 'table': {
      const rows: { header: boolean; cells: NView[] }[] = [];
      const visit = (n: TreeNode, header: boolean) => {
        if (!isBranch(n)) return;
        if (n.tag === 'tr') {
          const cells = n.children.filter(isBranch).map((c) => toView(c, ctx) ?? ({ kind: 'text', text: '', role: 'body', look: tiered(() => lookOf({})) } as NView));
          rows.push({ header: header || n.children.every((c) => isBranch(c) && c.tag === 'th'), cells });
        } else n.children.forEach((c) => visit(c, header || n.tag === 'thead'));
      };
      b.children.forEach((c) => visit(c, false));
      return { kind: 'table', rows, look };
    }
  }
  const text = TEXT_BLOCKS.has(b.tag) || !b.children.some(isBranch) ? inlineText(b) : null;
  if (text !== null && (b.children.length > 0 || b.tag === 'button' || b.tag === 'a')) {
    const role: TextRole = HEADING[b.tag] ?? 'body';
    const label = tidy(text) || b.attrs['aria-label'] || '';
    if (!label && b.tag !== 'button' && b.tag !== 'a') return null;
    if (b.tag === 'a') return { kind: 'text', text: label, role, look, link: safeUrl(b.attrs.href) };
    if (b.tag === 'button') return { kind: 'text', text: label, role, look, button: true };
    return { kind: 'text', text: label, role, look };
  }
  const children = b.children.map((c) => toView(c, ctx)).filter((v): v is NView => !!v);
  const layout = tiered((t) => layoutOf(styles[t]));
  // A grid on one display and a stack on another: a one-column grid on the others.
  if (TIERS.some((t) => layout[t].kind === 'grid')) {
    for (const t of TIERS) if (layout[t].kind !== 'grid') layout[t] = { ...layout[t], kind: 'grid', columns: 1, minColumn: undefined };
  }
  const note = b.tag === 'a' && b.attrs.href ? `link to ${safeUrl(b.attrs.href)}` : undefined;
  return { kind: 'box', layout, children, look, ...(note ? { note } : {}) };
}

/* -------------------------------------------------------------- writer */

class Out {
  lines: string[] = [];
  line(depth: number, text: string): void {
    this.lines.push(`${'    '.repeat(depth)}${text}`.replace(/\s+$/, ''));
  }
}

const num = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
const dbl = (n: number) => (Number.isInteger(n) ? `${n}` : num(n));
const comment = (text: string) => text.replace(/\*\/|\n/g, ' ');

/* --------------------------------------------------------------- swift */

const swiftString = (s: string) => JSON.stringify(s).replace(/\\u([0-9a-fA-F]{4})/g, '\\u{$1}');
const swiftColor = (c: Rgba) => {
  const ch = (v: number) => num(v / 255);
  return `Color(red: ${ch(c.r)}, green: ${ch(c.g)}, blue: ${ch(c.b)}${c.a < 1 ? `, opacity: ${num(c.a)}` : ''})`;
};
const SWIFT_FONT: Record<TextRole, string> = { h1: '.largeTitle', h2: '.title', h3: '.title2', h4: '.title3', h5: '.headline', h6: '.subheadline', body: '.body', small: '.footnote', code: '.body.monospaced()' };
const SWIFT_WEIGHT = (w: number) => (w >= 800 ? '.heavy' : w >= 700 ? '.bold' : w >= 600 ? '.semibold' : w >= 500 ? '.medium' : w <= 300 ? '.light' : '.regular');

/** SwiftUI has two widths: regular (desktop styles) and compact (phone styles). */
function swiftPick<T>(v: Tiered<T>, fmt: (x: T) => string): string {
  const a = fmt(v.lg);
  const c = fmt(v.phone);
  return a === c ? a : `(compact ? ${c} : ${a})`;
}

function swiftModifiers(look: Tiered<Look>, opts: { text?: TextRole; fill?: boolean }): string[] {
  const m: string[] = [];
  const has = <K extends keyof Look>(k: K) => look.lg[k] !== undefined || look.phone[k] !== undefined;
  if (opts.text) {
    const role = opts.text;
    if (has('fontSize')) m.push(`.font(.system(size: ${swiftPick(look, (l) => dbl(l.fontSize ?? DEFAULT_SIZE[role]))}${role === 'code' ? ', design: .monospaced' : ''}))`);
    else m.push(`.font(${SWIFT_FONT[role]})`);
    if (has('bold')) m.push(`.fontWeight(${swiftPick(look, (l) => SWIFT_WEIGHT(l.bold ?? 400))})`);
    if (look.lg.italic) m.push('.italic()');
    if (has('align')) m.push(`.multilineTextAlignment(${swiftPick(look, (l) => `.${l.align ?? 'leading'}`)})`);
  }
  if (has('color')) m.push(`.foregroundStyle(${swiftPick(look, (l) => (l.color ? swiftColor(l.color) : 'Color.primary'))})`);
  if (has('width') || has('height')) {
    const parts = [];
    if (has('width')) parts.push(`width: ${swiftPick(look, (l) => (l.width !== undefined ? dbl(l.width) : 'nil'))}`);
    if (has('height')) parts.push(`height: ${swiftPick(look, (l) => (l.height !== undefined ? dbl(l.height) : 'nil'))}`);
    m.push(`.frame(${parts.join(', ')})`);
  }
  const pad = (l: Look) => l.padding;
  const p = tiered((t) => pad(look[t]));
  if (Object.values(p.lg).some(Boolean) || Object.values(p.phone).some(Boolean)) {
    const sides = ['top', 'leading', 'bottom', 'trailing'] as const;
    const key = { top: 'top', leading: 'left', bottom: 'bottom', trailing: 'right' } as const;
    const uniform = (e: Edges) => e.top === e.right && e.top === e.bottom && e.top === e.left;
    if (uniform(p.lg) && uniform(p.phone)) m.push(`.padding(${swiftPick(p, (e) => dbl(e.top))})`);
    else m.push(`.padding(EdgeInsets(${sides.map((s) => `${s}: ${swiftPick(p, (e) => dbl(e[key[s]]))}`).join(', ')}))`);
  }
  if (has('maxWidth')) m.push(`.frame(maxWidth: ${swiftPick(look, (l) => (l.maxWidth !== undefined ? dbl(l.maxWidth) : '.infinity'))})`);
  const align = opts.text && look.lg.align === 'center' ? '.center' : opts.text && look.lg.align === 'trailing' ? '.trailing' : '.leading';
  if (opts.fill) m.push(`.frame(maxWidth: .infinity, alignment: ${look.lg.centered ? '.center' : align})`);
  if (has('background')) m.push(`.background(${swiftPick(look, (l) => (l.background ? swiftColor(l.background) : 'Color.clear'))})`);
  if (has('radius')) m.push(`.clipShape(RoundedRectangle(cornerRadius: ${swiftPick(look, (l) => dbl(l.radius ?? 0))}))`);
  if (look.lg.border) m.push(`.overlay(RoundedRectangle(cornerRadius: ${dbl(look.lg.radius ?? 0)}).stroke(${swiftColor(look.lg.border.color)}, lineWidth: ${dbl(look.lg.border.width)}))`);
  if (has('opacity')) m.push(`.opacity(${swiftPick(look, (l) => num(l.opacity ?? 1))})`);
  return m;
}

const DEFAULT_SIZE: Record<TextRole, number> = { h1: 34, h2: 28, h3: 22, h4: 20, h5: 17, h6: 15, body: 17, small: 13, code: 15 };

function swiftView(v: NView, o: Out, d: number, fill: boolean): void {
  const look = 'look' in v ? v.look : undefined;
  // Hidden on some widths.
  if (look && (look.lg.hidden || look.phone.hidden)) {
    if (look.lg.hidden && look.phone.hidden) return;
    o.line(d, `if ${look.phone.hidden ? '!compact' : 'compact'} {`);
    swiftBody(v, o, d + 1, fill);
    o.line(d, '}');
    return;
  }
  swiftBody(v, o, d, fill);
}

function swiftBody(v: NView, o: Out, d: number, fill: boolean): void {
  const mods = (look: Tiered<Look>, opts: { text?: TextRole; fill?: boolean }) => swiftModifiers(look, opts).forEach((m) => o.line(d + 1, m));
  switch (v.kind) {
    case 'text': {
      if (v.link !== undefined) {
        if (/^(https?:|mailto:|tel:)/i.test(v.link)) o.line(d, `Link(${swiftString(v.text)}, destination: URL(string: ${swiftString(v.link)})!)`);
        else o.line(d, `Button(${swiftString(v.text)}) { /* go to ${comment(v.link || 'a page')} */ }`);
      } else if (v.button) o.line(d, `Button(${swiftString(v.text)}) { }`);
      else o.line(d, `Text(${swiftString(v.text)})`);
      mods(v.look, { text: v.role, fill: fill && !v.button && v.link === undefined });
      return;
    }
    case 'image':
      if (/^https?:/i.test(v.src)) {
        o.line(d, `AsyncImage(url: URL(string: ${swiftString(v.src)})) { image in`);
        o.line(d + 1, 'image.resizable().scaledToFit()');
        o.line(d, '} placeholder: {');
        o.line(d + 1, 'Color.secondary.opacity(0.1)');
        o.line(d, '}');
      } else {
        o.line(d, `Image(${swiftString(v.src.replace(/^.*\//, '').replace(/\.\w+$/, '') || 'image')}) // add ${comment(v.src || 'the image')} to the asset catalog`);
        o.line(d + 1, '.resizable().scaledToFit()');
      }
      if (v.alt) o.line(d + 1, `.accessibilityLabel(${swiftString(v.alt)})`);
      else o.line(d + 1, '.accessibilityHidden(true)');
      mods(v.look, {});
      return;
    case 'divider':
      o.line(d, 'Divider()');
      return;
    case 'field':
      o.line(d, v.multiline ? `TextField(${swiftString(v.placeholder)}, text: .constant(""), axis: .vertical)` : `TextField(${swiftString(v.placeholder)}, text: .constant(""))`);
      o.line(d + 1, '.textFieldStyle(.roundedBorder)');
      mods(v.look, {});
      return;
    case 'placeholder':
      o.line(d, `// ${comment(v.note)}`);
      o.line(d, 'EmptyView()');
      return;
    case 'list':
      o.line(d, 'VStack(alignment: .leading, spacing: 4) {');
      v.items.forEach((item, i) => {
        o.line(d + 1, 'HStack(alignment: .firstTextBaseline, spacing: 8) {');
        o.line(d + 2, `Text(${swiftString(v.ordered ? `${i + 1}.` : '•')})`);
        swiftView(item, o, d + 2, false);
        o.line(d + 1, '}');
      });
      o.line(d, '}');
      mods(v.look, { fill });
      return;
    case 'table':
      o.line(d, 'Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 8) {');
      v.rows.forEach((row, i) => {
        o.line(d + 1, 'GridRow {');
        row.cells.forEach((c) => {
          swiftView(c, o, d + 2, false);
          if (row.header) o.line(d + 3, '.fontWeight(.semibold)');
        });
        o.line(d + 1, '}');
        if (row.header && i < v.rows.length - 1) o.line(d + 1, 'Divider()');
      });
      o.line(d, '}');
      mods(v.look, { fill });
      return;
    case 'box': {
      if (v.note) o.line(d, `// ${comment(v.note)}`);
      const L = v.layout;
      const spacing = swiftPick(L, (l) => dbl(l.gap));
      const crossV = (l: Layout) => (l.align === 'center' ? '.center' : l.align === 'end' ? '.trailing' : '.leading');
      const crossH = (l: Layout) => (l.align === 'center' ? '.center' : l.align === 'end' ? '.bottom' : '.top');
      let childFill = false;
      if (L.lg.kind === 'grid') {
        const columns = (l: Layout) =>
          l.minColumn !== undefined ? `[GridItem(.adaptive(minimum: ${dbl(l.minColumn)}), spacing: ${dbl(l.gap)}, alignment: .top)]` : `Array(repeating: GridItem(.flexible(), spacing: ${dbl(l.gap)}, alignment: .top), count: ${l.columns})`;
        o.line(d, `LazyVGrid(columns: ${swiftPick(L, columns)}, alignment: .leading, spacing: ${spacing}) {`);
        childFill = true;
      } else if (same(tiered((t) => L[t].axis)) || L.lg.axis === L.phone.axis) {
        const l = L.lg;
        if (l.axis === 'v') {
          o.line(d, `VStack(alignment: ${crossV(l)}, spacing: ${spacing}) {`);
          childFill = l.align === 'stretch' || l.align === 'start';
        } else o.line(d, `HStack(alignment: ${crossH(l)}, spacing: ${spacing}) {`);
      } else {
        const layout = (l: Layout) => (l.axis === 'v' ? `AnyLayout(VStackLayout(alignment: .leading, spacing: ${dbl(l.gap)}))` : `AnyLayout(HStackLayout(alignment: ${crossH(l)}, spacing: ${dbl(l.gap)}))`);
        o.line(d, `${swiftPick(L, layout)} {`);
      }
      const between = L.lg.kind === 'stack' && L.lg.axis === 'h' && L.lg.justify === 'between';
      v.children.forEach((c, i) => {
        if (between && i > 0) o.line(d + 1, 'Spacer()');
        swiftView(c, o, d + 1, childFill);
      });
      o.line(d, '}');
      mods(v.look, { fill });
      if (v.look.lg.centered) o.line(d + 1, '.frame(maxWidth: .infinity)');
      return;
    }
  }
}

export function exportSwiftUI(tree: Tree, opts: NativeOptions): string {
  const ctx = buildCtx(opts.kits ?? []);
  const root = toView(tree.root, ctx) ?? { kind: 'placeholder', note: 'The tree is empty' };
  const o = new Out();
  o.line(0, `// Generated by Tree Weaver from the tree "${comment(tree.name)}".`);
  o.line(0, '// Regular width (iPad, Mac) uses the desktop styles; compact width (iPhone) uses the mobile portrait styles.');
  o.line(0, '// Needs iOS 16 / macOS 13 or later.');
  o.line(0, 'import SwiftUI');
  o.line(0, '');
  o.line(0, `struct ${opts.name}: View {`);
  // Size classes exist only on iOS and iPadOS; a Mac window always gets the desktop styles.
  o.line(0, '#if os(iOS)');
  o.line(1, '@Environment(\\.horizontalSizeClass) private var sizeClass');
  o.line(1, 'private var compact: Bool { sizeClass == .compact }');
  o.line(0, '#else');
  o.line(1, 'private let compact = false');
  o.line(0, '#endif');
  o.line(0, '');
  o.line(1, 'var body: some View {');
  o.line(2, 'ScrollView {');
  swiftView(root, o, 3, true);
  o.line(2, '}');
  o.line(1, '}');
  o.line(0, '}');
  o.line(0, '');
  o.line(0, '#Preview {');
  o.line(1, `${opts.name}()`);
  o.line(0, '}');
  return `${o.lines.join('\n')}\n`;
}

/* -------------------------------------------------------------- flutter */

const dartString = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\$/g, '\\$').replace(/\n/g, '\\n').replace(/\r/g, '')}'`;
const dartColor = (c: Rgba) => {
  const hex = (n: number) => Math.round(n).toString(16).padStart(2, '0').toUpperCase();
  return `Color(0x${hex(c.a * 255)}${hex(c.r)}${hex(c.g)}${hex(c.b)})`;
};
const DART_TEXT: Record<TextRole, string> = {
  h1: 'headlineLarge',
  h2: 'headlineMedium',
  h3: 'headlineSmall',
  h4: 'titleLarge',
  h5: 'titleMedium',
  h6: 'titleSmall',
  body: 'bodyMedium',
  small: 'bodySmall',
  code: 'bodyMedium',
};
const DART_WEIGHT = (w: number) => `FontWeight.w${Math.min(900, Math.max(100, Math.round(w / 100) * 100))}`;

/** Flutter switches at the tablet and phone breakpoints: `phone` and `tablet` are booleans in `build`. */
function dartPick<T>(v: Tiered<T>, fmt: (x: T) => string): string {
  const l = fmt(v.lg);
  const t = fmt(v.tablet);
  const p = fmt(v.phone);
  if (l === t && t === p) return l;
  if (t === p) return `(tablet ? ${t} : ${l})`;
  if (l === t) return `(phone ? ${p} : ${l})`;
  return `(phone ? ${p} : tablet ? ${t} : ${l})`;
}

/** The condition under which something shown only on some tiers shows. */
function dartVisible(hidden: Tiered<boolean>): string | null {
  const shown = TIERS.filter((t) => !hidden[t]);
  if (shown.length === 3) return null;
  if (!shown.length) return 'false';
  const key = shown.join(',');
  const known: Record<string, string> = { lg: '!tablet', 'lg,tablet': '!phone', 'tablet,phone': 'tablet', phone: 'phone', tablet: '(tablet && !phone)', 'lg,phone': '(phone || !tablet)' };
  return known[key];
}

function dartTextStyle(look: Tiered<Look>, role: TextRole): string {
  const parts: string[] = [];
  const has = <K extends keyof Look>(k: K) => TIERS.some((t) => look[t][k] !== undefined);
  if (has('fontSize')) parts.push(`fontSize: ${dartPick(look, (l) => (l.fontSize !== undefined ? dbl(l.fontSize) : 'null'))}`);
  if (has('bold')) parts.push(`fontWeight: ${dartPick(look, (l) => (l.bold !== undefined ? DART_WEIGHT(l.bold) : 'null'))}`);
  if (has('color')) parts.push(`color: ${dartPick(look, (l) => (l.color ? dartColor(l.color) : 'null'))}`);
  if (look.lg.italic) parts.push('fontStyle: FontStyle.italic');
  if (role === 'code') parts.push("fontFamily: 'monospace'");
  const base = `Theme.of(context).textTheme.${DART_TEXT[role]}`;
  return parts.length ? `${base}?.copyWith(${parts.join(', ')})` : base;
}

/** Wrap a widget in the containers its look needs. Returns the opening lines' builder. */
function dartDecorate(look: Tiered<Look>, o: Out, d: number, inner: (d: number) => void): void {
  const has = <K extends keyof Look>(k: K) => TIERS.some((t) => look[t][k] !== undefined);
  const pad = tiered((t) => look[t].padding);
  const anyPad = TIERS.some((t) => Object.values(pad[t]).some(Boolean));
  const deco: string[] = [];
  if (has('background')) deco.push(`color: ${dartPick(look, (l) => (l.background ? dartColor(l.background) : 'null'))}`);
  if (has('radius')) deco.push(`borderRadius: BorderRadius.circular(${dartPick(look, (l) => dbl(l.radius ?? 0))})`);
  if (look.lg.border) deco.push(`border: Border.all(color: ${dartColor(look.lg.border.color)}, width: ${dbl(look.lg.border.width)})`);
  const needsBox = anyPad || deco.length || has('width') || has('height') || has('maxWidth');
  let depth = d;
  const closers: string[] = [];
  const open = (text: string) => {
    o.line(depth, text);
    depth++;
  };
  if (has('opacity')) {
    open(`Opacity(opacity: ${dartPick(look, (l) => num(l.opacity ?? 1))},`);
    open('child:');
    depth--;
    closers.push(')');
  }
  if (look.lg.centered) {
    open('Center(child:');
    depth--;
    closers.push(')');
  }
  if (needsBox) {
    open('Container(');
    if (anyPad) {
      const uniform = TIERS.every((t) => pad[t].top === pad[t].right && pad[t].top === pad[t].bottom && pad[t].top === pad[t].left);
      o.line(depth, uniform ? `padding: EdgeInsets.all(${dartPick(pad, (e) => dbl(e.top))}),` : `padding: EdgeInsets.fromLTRB(${(['left', 'top', 'right', 'bottom'] as const).map((s) => dartPick(pad, (e) => dbl(e[s]))).join(', ')}),`);
    }
    if (has('width')) o.line(depth, `width: ${dartPick(look, (l) => (l.width !== undefined ? dbl(l.width) : 'null'))},`);
    if (has('height')) o.line(depth, `height: ${dartPick(look, (l) => (l.height !== undefined ? dbl(l.height) : 'null'))},`);
    if (has('maxWidth')) o.line(depth, `constraints: BoxConstraints(maxWidth: ${dartPick(look, (l) => (l.maxWidth !== undefined ? dbl(l.maxWidth) : 'double.infinity'))}),`);
    if (deco.length) o.line(depth, `decoration: BoxDecoration(${deco.join(', ')}),`);
    o.line(depth, 'child:');
    closers.push(')');
  }
  inner(depth);
  for (const c of closers.reverse()) {
    depth--;
    o.line(depth, `${c},`);
  }
  // Drop the trailing comma of the outermost closer (the caller adds its own).
  if (closers.length) o.lines[o.lines.length - 1] = o.lines[o.lines.length - 1].replace(/,$/, '');
}

function dartChildren(views: NView[], o: Out, d: number, wrapChild?: (d: number, inner: (d: number) => void) => void): void {
  for (const c of views) {
    const look = 'look' in c ? c.look : undefined;
    const cond = look ? dartVisible(tiered((t) => look[t].hidden)) : null;
    if (cond === 'false') continue;
    const prefix = cond ? `if (${cond}) ` : '';
    const start = o.lines.length;
    if (wrapChild) wrapChild(d, (dd) => dartView(c, o, dd));
    else dartView(c, o, d);
    if (prefix) o.lines[start] = o.lines[start].replace(/^(\s*)/, `$1${prefix}`);
    o.lines[o.lines.length - 1] += ',';
  }
}

function dartView(v: NView, o: Out, d: number): void {
  switch (v.kind) {
    case 'text': {
      const style = dartTextStyle(v.look, v.role);
      const align = v.look.lg.align ? `, textAlign: ${dartPick(v.look, (l) => `TextAlign.${l.align === 'leading' ? 'start' : l.align === 'trailing' ? 'end' : l.align ?? 'start'}`)}` : '';
      const text = `Text(${dartString(v.text)}, style: ${style}${align})`;
      dartDecorate(v.look, o, d, (dd) => {
        if (v.link !== undefined) o.line(dd, `TextButton(onPressed: () {/* open ${comment(v.link || 'the link')} */}, child: ${text})`);
        else if (v.button) o.line(dd, `FilledButton(onPressed: () {}, child: ${text})`);
        else o.line(dd, text);
      });
      return;
    }
    case 'image':
      dartDecorate(v.look, o, d, (dd) =>
        o.line(
          dd,
          /^https?:/i.test(v.src)
            ? `Image.network(${dartString(v.src)}, fit: BoxFit.contain${v.alt ? `, semanticLabel: ${dartString(v.alt)}` : ', excludeFromSemantics: true'})`
            : `Image.asset(${dartString(v.src.replace(/^\.?\//, '') || 'assets/image.png')}, fit: BoxFit.contain${v.alt ? `, semanticLabel: ${dartString(v.alt)}` : ', excludeFromSemantics: true'})`,
        ),
      );
      return;
    case 'divider':
      o.line(d, 'const Divider()');
      return;
    case 'field':
      dartDecorate(v.look, o, d, (dd) =>
        o.line(dd, `TextField(${v.multiline ? 'maxLines: null, ' : ''}decoration: InputDecoration(hintText: ${dartString(v.placeholder)}, border: const OutlineInputBorder()))`),
      );
      return;
    case 'placeholder':
      o.line(d, `const SizedBox.shrink() /* ${comment(v.note)} */`);
      return;
    case 'list':
      dartDecorate(v.look, o, d, (dd) => {
        o.line(dd, 'Column(');
        o.line(dd + 1, 'crossAxisAlignment: CrossAxisAlignment.start,');
        o.line(dd + 1, 'children: [');
        v.items.forEach((item, i) => {
          o.line(dd + 2, 'Row(crossAxisAlignment: CrossAxisAlignment.start, children: [');
          o.line(dd + 3, `Text(${dartString(v.ordered ? `${i + 1}. ` : '•  ')}),`);
          o.line(dd + 3, 'Expanded(child:');
          dartView(item, o, dd + 4);
          o.line(dd + 3, '),');
          o.line(dd + 2, ']),');
        });
        o.line(dd + 1, '],');
        o.line(dd, ')');
      });
      return;
    case 'table':
      dartDecorate(v.look, o, d, (dd) => {
        o.line(dd, 'Table(');
        o.line(dd + 1, 'border: TableBorder.all(color: Colors.black12),');
        o.line(dd + 1, 'defaultVerticalAlignment: TableCellVerticalAlignment.middle,');
        o.line(dd + 1, 'children: [');
        const width = Math.max(1, ...v.rows.map((r) => r.cells.length));
        for (const row of v.rows) {
          o.line(dd + 2, `TableRow(${row.header ? 'decoration: const BoxDecoration(color: Color(0x0A000000)), ' : ''}children: [`);
          const cells = [...row.cells];
          while (cells.length < width) cells.push({ kind: 'placeholder', note: 'empty cell' });
          for (const c of cells) {
            o.line(dd + 3, 'Padding(padding: const EdgeInsets.all(8), child:');
            dartView(c, o, dd + 4);
            o.line(dd + 3, '),');
          }
          o.line(dd + 2, ']),');
        }
        o.line(dd + 1, '],');
        o.line(dd, ')');
      });
      return;
    case 'box': {
      const L = v.layout;
      dartDecorate(v.look, o, d, (dd) => {
        if (v.note) o.line(dd, `// ${comment(v.note)}`);
        const spacing = dartPick(L, (l) => dbl(l.gap));
        if (L.lg.kind === 'grid') {
          const cols = dartPick(L, (l) => String(l.columns));
          const min = TIERS.some((t) => L[t].minColumn !== undefined) ? `, minColumnWidth: ${dartPick(L, (l) => (l.minColumn !== undefined ? dbl(l.minColumn) : 'null'))}` : '';
          o.line(dd, `_Grid(columns: ${cols}${min}, spacing: ${spacing}, children: [`);
          dartChildren(v.children, o, dd + 1);
          o.line(dd, '])');
          return;
        }
        const axisSame = TIERS.every((t) => L[t].axis === L.lg.axis);
        const cross = (l: Layout) => `CrossAxisAlignment.${l.align === 'center' ? 'center' : l.align === 'end' ? 'end' : l.align === 'stretch' && l.axis === 'v' ? 'stretch' : 'start'}`;
        const main = (l: Layout) => `MainAxisAlignment.${l.justify === 'between' ? 'spaceBetween' : l.justify === 'center' ? 'center' : l.justify === 'end' ? 'end' : 'start'}`;
        if (axisSame && L.lg.axis === 'h' && (L.lg.wrap || L.lg.justify === 'start')) {
          // Wrap rather than Row, so a row of items never overflows a narrow screen.
          o.line(dd, `Wrap(spacing: ${spacing}, runSpacing: ${spacing}, crossAxisAlignment: WrapCrossAlignment.${L.lg.align === 'center' ? 'center' : L.lg.align === 'end' ? 'end' : 'start'}, children: [`);
          dartChildren(v.children, o, dd + 1);
          o.line(dd, '])');
          return;
        }
        const dir = axisSame ? (L.lg.axis === 'v' ? 'Axis.vertical' : 'Axis.horizontal') : dartPick(L, (l) => (l.axis === 'v' ? 'Axis.vertical' : 'Axis.horizontal'));
        o.line(dd, 'Flex(');
        o.line(dd + 1, `direction: ${dir},`);
        o.line(dd + 1, `crossAxisAlignment: ${dartPick(L, cross)},`);
        o.line(dd + 1, `mainAxisAlignment: ${dartPick(L, main)},`);
        // A row takes the full width (so spaceBetween has room); a column takes only what it
        // needs, since it sits in a scroll view with no height limit.
        o.line(dd + 1, `mainAxisSize: ${dartPick(L, (l) => (l.axis === 'h' ? 'MainAxisSize.max' : 'MainAxisSize.min'))},`);
        o.line(dd + 1, `spacing: ${spacing},`);
        o.line(dd + 1, 'children: [');
        // In a horizontal row, children share the width instead of overflowing it.
        const flexible = L.lg.axis === 'h' || !axisSame;
        dartChildren(v.children, o, dd + 2, flexible ? (cd, inner) => {
          // A flex child needs a bounded main axis, so on tiers that stack vertically (inside the
          // scroll view) it gets flex 0, which lays it out at its natural size.
          o.line(cd, axisSame ? 'Flexible(child:' : `Flexible(flex: ${dartPick(L, (l) => (l.axis === 'h' ? '1' : '0'))}, child:`);
          inner(cd + 1);
          o.line(cd, ')');
        } : undefined);
        o.line(dd + 1, '],');
        o.line(dd, ')');
      });
      return;
    }
  }
}

const GRID_HELPER = `
/// Lays children out in rows of [columns] (or as many [minColumnWidth]-wide columns as fit).
class _Grid extends StatelessWidget {
  const _Grid({required this.columns, this.minColumnWidth, required this.spacing, required this.children});

  final int columns;
  final double? minColumnWidth;
  final double spacing;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(builder: (context, constraints) {
      var count = columns;
      final min = minColumnWidth;
      if (min != null && constraints.maxWidth.isFinite) {
        count = ((constraints.maxWidth + spacing) / (min + spacing)).floor().clamp(1, 12);
      }
      final rows = <Widget>[];
      for (var i = 0; i < children.length; i += count) {
        final cells = <Widget>[];
        for (var j = 0; j < count; j++) {
          if (j > 0) cells.add(SizedBox(width: spacing));
          cells.add(Expanded(child: i + j < children.length ? children[i + j] : const SizedBox.shrink()));
        }
        if (rows.isNotEmpty) rows.add(SizedBox(height: spacing));
        rows.add(IntrinsicHeight(child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: cells)));
      }
      return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: rows);
    });
  }
}
`;

export function exportFlutter(tree: Tree, opts: NativeOptions): string {
  const ctx = buildCtx(opts.kits ?? []);
  const root = toView(tree.root, ctx) ?? { kind: 'placeholder', note: 'The tree is empty' };
  const tablet = getDisplay('tablet').breakpoint ?? 1024;
  const phone = getDisplay('mobile-portrait').breakpoint ?? 600;
  const o = new Out();
  o.line(0, `// Generated by Tree Weaver from the tree "${comment(tree.name)}".`);
  o.line(0, `// Widths up to ${phone} use the mobile portrait styles, up to ${tablet} the tablet styles, wider the desktop styles.`);
  o.line(0, '// Needs Flutter 3.27 or later (Flex spacing).');
  o.line(0, "import 'package:flutter/material.dart';");
  o.line(0, '');
  o.line(0, `class ${opts.name} extends StatelessWidget {`);
  o.line(1, `const ${opts.name}({super.key});`);
  o.line(0, '');
  o.line(1, '@override');
  o.line(1, 'Widget build(BuildContext context) {');
  o.line(2, 'final width = MediaQuery.sizeOf(context).width;');
  o.line(2, `final tablet = width <= ${tablet};`);
  o.line(2, `final phone = width <= ${phone};`);
  o.line(2, 'return SingleChildScrollView(');
  o.line(3, 'child:');
  const start = o.lines.length;
  dartView(root, o, 4);
  o.lines[o.lines.length - 1] += ',';
  const view = o.lines.slice(start).join('\n');
  o.line(2, ');');
  o.line(1, '}');
  o.line(0, '}');
  const body = o.lines.join('\n');
  // Silence unused-variable lints when a layout doesn't switch.
  const used = (name: string) => new RegExp(`\\b${name}\\b`).test(view);
  let out = body;
  if (!used('phone')) out = out.replace(/\n\s*final phone = [^\n]+/, '');
  if (!used('tablet')) out = out.replace(/\n\s*final tablet = [^\n]+/, '');
  if (!used('phone') && !used('tablet')) out = out.replace(/\n\s*final width = [^\n]+/, '');
  return `${out}\n${body.includes('_Grid(') ? GRID_HELPER : ''}`;
}

/** File name for a Dart type: `LandingPage` → `landing_page.dart`. */
export const dartFileName = (name: string) => `${name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()}.dart`;
