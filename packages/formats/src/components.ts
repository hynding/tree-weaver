import {
  closesParagraph,
  cssCovers,
  cssOverlaps,
  type ThemeToken,
  keepsWhitespace,
  BOOLEAN_ATTRS,
  canonicalSvgAttr,
  canonicalTag,
  DISPLAYS,
  escapeAttr,
  escapeHtml,
  isBranch,
  isSafeAttr,
  isSafeCssProp,
  hasInlineDisplay,
  isSvgRoot,
  renderDisplayCss,
  safeTag,
  sanitizeCssValue,
  SVG_SHAPE_TAGS,
  childrenInSvg,
  BASE_CSS,
  VOID_TAGS,
  type Branch,
  type DesignKit,
  type DisplayDef,
  type DisplayRule,
  type Leaf,
  type StyleMap,
  type Tree,
  type TreeNode,
  type TokenKind,
  themeTokens,
  tokensToDtcg,
  componentProps,
  createTree,
  expandComponent,
  IF_ATTR,
  isPropName,
  type ComponentDef,
  type ComponentProp,
  type ComponentVariant,
  type DisplayStyles,
  resolveStyles,
  walk,
} from '@tree-weaver/core';
import { isInlineTag, PRE_TAGS } from './inline';
import { commentText, slugify } from './slug';
import { DESIGN_TOKENS_DART, DESIGN_TOKENS_SWIFT, dartFileName, exportFlutter, exportFlutterTokens, exportSwiftUI, exportSwiftUITokens, nativeTypeName } from './native';
import { tailwindPreset, tailwindThemeCss, tailwindTokenClass } from './tokens';

const SVG_SHAPES = new Set(SVG_SHAPE_TAGS);

/**
 * Framework exports: a tree as source code for a codebase, not a standalone page.
 *
 * - `react`: a function component (`.jsx`, or `.tsx` with `typescript`);
 * - `vue`: a single-file component (`.vue`);
 * - `svelte`: a component (`.svelte`);
 * - `html`: an `index.html` with its stylesheets as separate files;
 * - `swiftui`: a SwiftUI view (`.swift`), for iOS, iPadOS and macOS;
 * - `flutter`: a Flutter widget (`.dart`), for Android, iOS and other Flutter targets.
 *
 * Styles come out either as a CSS file with readable class names (`styling: 'css'`, the
 * default) or as Tailwind utility classes (`styling: 'tailwind'`), with displays mapped to
 * responsive variants. Design kits are written to `kits.css` in both cases. Nothing from
 * the editor (`data-tw` attributes, ids) is left in the output. Native exports ignore `styling`
 * and write one file with the styles in it (see `native.ts`).
 */

export type ComponentFramework = 'react' | 'vue' | 'svelte' | 'html' | 'swiftui' | 'flutter';
export type ComponentStyling = 'css' | 'tailwind';

export const COMPONENT_FRAMEWORKS: readonly { id: ComponentFramework; label: string }[] = [
  { id: 'react', label: 'React (JSX)' },
  { id: 'vue', label: 'Vue (single-file component)' },
  { id: 'svelte', label: 'Svelte' },
  { id: 'html', label: 'HTML + CSS files' },
  { id: 'swiftui', label: 'SwiftUI (iOS, macOS)' },
  { id: 'flutter', label: 'Flutter (Android, iOS)' },
];

/** Frameworks that write native code rather than HTML; they have no styling choice. */
export const isNativeFramework = (framework: ComponentFramework): boolean => framework === 'swiftui' || framework === 'flutter';

export interface ComponentOptions {
  framework: ComponentFramework;
  styling?: ComponentStyling;
  /** Design kits the tree uses. Enabled ones go to `kits.css` (linked kits as `@import`). */
  kits?: DesignKit[];
  /** Component name (PascalCase). Default: from the tree's name. */
  name?: string;
  /** React only: write `.tsx`. */
  typescript?: boolean;
}

export interface ComponentFile {
  path: string;
  contents: string;
}

export interface ComponentExport {
  /** The component's name, e.g. `HomePage`. */
  name: string;
  framework: ComponentFramework;
  /** How styles were written; left out for native frameworks, which have no choice. */
  styling?: ComponentStyling;
  /** The main file, e.g. `HomePage.jsx`. */
  entry: string;
  files: ComponentFile[];
}

/* -------------------------------------------------------------- names */

function pascalName(value: string): string {
  const words = value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  const name = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
  if (!name) return 'Layout';
  return /^[0-9]/.test(name) ? `Layout${name}` : name;
}

/** Readable, unique class names for branches that carry styles: `home__hero`, `home__feature-grid`, `home__card-2`. */
function classNamer(prefix: string) {
  const used = new Map<string, number>();
  // Every name handed out: "Card", "Card" and "Card 2" must not give two `card-2`s.
  const taken = new Set<string>();
  return (branch: Branch): string => {
    const base = slugify(branch.name || branch.type || branch.tag, branch.tag);
    const stem = `${prefix}${base}`.replace(/[^a-z0-9_-]/gi, '-').replace(/^-+|-+$/g, '') || `${prefix}node`;
    let n = used.get(stem) ?? 0;
    let name: string;
    do {
      n++;
      name = n === 1 ? stem : `${stem}-${n}`;
    } while (taken.has(name));
    used.set(stem, n);
    taken.add(name);
    return name;
  };
}

/** A slug that is also a valid CSS class name: it must not start with a digit. */
const cssIdent = (slug: string): string => (/^[a-z_]/i.test(slug) ? slug : `layout-${slug}`.replace(/-+$/, ''));

const hasStyles = (b: Branch): boolean => Object.values(b.styles).some((m) => m && Object.keys(m).length > 0);

/* ------------------------------------------------------------ tailwind */

/** The Tailwind variant prefix for a display, from its media query: `max-[1024.02px]:`, `max-[600.02px]:portrait:`. */
export function tailwindVariant(display: DisplayDef): string {
  if (!display.media) return '';
  const parts: string[] = [];
  const min = /min-width:\s*(\d+(?:\.\d+)?)px/.exec(display.media);
  const max = /max-width:\s*(\d+(?:\.\d+)?)px/.exec(display.media);
  if (min) parts.push(`min-[${min[1]}px]`);
  // Tailwind v4 writes `max-*` as `width < N`, which leaves out N itself; `max-width: N` takes
  // it in. A fiftieth of a pixel more keeps that width in both v3 (`max-width`) and v4.
  if (max) parts.push(`max-[${Number((Number(max[1]) + 0.02).toFixed(4))}px]`);
  if (/orientation:\s*landscape/.test(display.media)) parts.push('landscape');
  if (/orientation:\s*portrait/.test(display.media)) parts.push('portrait');
  return parts.map((p) => `${p}:`).join('');
}

const DISPLAY_UTILITIES: Record<string, string> = {
  block: 'block',
  'inline-block': 'inline-block',
  inline: 'inline',
  flex: 'flex',
  'inline-flex': 'inline-flex',
  grid: 'grid',
  'inline-grid': 'inline-grid',
  none: 'hidden',
  contents: 'contents',
};
const KEYWORD_UTILITIES: Record<string, Record<string, string>> = {
  display: DISPLAY_UTILITIES,
  position: { static: 'static', relative: 'relative', absolute: 'absolute', fixed: 'fixed', sticky: 'sticky' },
  'flex-direction': { row: 'flex-row', column: 'flex-col', 'row-reverse': 'flex-row-reverse', 'column-reverse': 'flex-col-reverse' },
  'flex-wrap': { wrap: 'flex-wrap', nowrap: 'flex-nowrap', 'wrap-reverse': 'flex-wrap-reverse' },
  'text-align': { left: 'text-left', center: 'text-center', right: 'text-right', justify: 'text-justify', start: 'text-start', end: 'text-end' },
  'align-items': { 'flex-start': 'items-start', 'flex-end': 'items-end', center: 'items-center', baseline: 'items-baseline', stretch: 'items-stretch' },
  // Only flex-start/flex-end: `justify-start` compiles to flex-start, which flips in a reversed
  // flex box where `start` doesn't, so `start` and `end` stay arbitrary properties.
  'justify-content': {
    'flex-start': 'justify-start',
    'flex-end': 'justify-end',
    center: 'justify-center',
    'space-between': 'justify-between',
    'space-around': 'justify-around',
    'space-evenly': 'justify-evenly',
  },
};
/** Properties with a Tailwind utility that takes an arbitrary single value. */
const VALUE_UTILITIES: Record<string, string> = {
  gap: 'gap',
  'row-gap': 'gap-y',
  'column-gap': 'gap-x',
  padding: 'p',
  'padding-top': 'pt',
  'padding-right': 'pr',
  'padding-bottom': 'pb',
  'padding-left': 'pl',
  margin: 'm',
  'margin-top': 'mt',
  'margin-right': 'mr',
  'margin-bottom': 'mb',
  'margin-left': 'ml',
  width: 'w',
  height: 'h',
  'min-width': 'min-w',
  'max-width': 'max-w',
  'min-height': 'min-h',
  'max-height': 'max-h',
  'grid-template-columns': 'grid-cols',
  'grid-template-rows': 'grid-rows',
  'grid-column': 'col',
  'grid-row': 'row',
  'border-radius': 'rounded',
  opacity: 'opacity',
  'z-index': 'z',
};

/**
 * A CSS value inside Tailwind's brackets: spaces become `_`, literal underscores are escaped.
 * Double-quoted strings become single-quoted (the same to CSS): a `"` would be escaped in the
 * markup, and Tailwind, which reads class names from the source text, would miss the class.
 */
const bracket = (value: string): string =>
  value
    .trim()
    // Strings are read in order, so a `"` inside a single-quoted string stays inside it.
    // A `"` left inside a string would be escaped in the markup too: it becomes the CSS escape
    // `\22` (its `_` turns into the space that ends the escape), written in after the spaces below.
    .replace(/'(?:[^'\\]|\\.)*'|"((?:[^"\\]|\\.)*)"/g, (whole, inner: string | undefined) =>
      (inner === undefined ? whole : `'${inner.replace(/\\"/g, '"').replace(/(^|[^\\])'/g, "$1\\'")}'`).replace(/\\?"/g, '\u0000'),
    )
    // Tailwind leaves `url(…)` as written, so spaces there are percent-encoded instead.
    .split(/(url\(\s*(?:"[^"]*"|'[^']*'|[^)]*?)\s*\))/i)
    .map((part, i) =>
      i % 2
        ? // Padding inside the parentheses means nothing to CSS; only the address's own spaces are kept.
          part
            .replace(/^(url\()\s+/i, '$1')
            .replace(/\s+\)$/, ')')
            // `<` and `>` too (inline SVG data URIs): markup would escape them, and Tailwind reads the source.
            .replace(/[\s<>]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`)
            // …and its quotes (`"` in an inline SVG), as `%22`.
            .replace(/\u0000/g, '%22')
        : part
            .replace(/_/g, '\\_')
            .replace(/\s*,\s*/g, ',')
            .replace(/\s+/g, '_'),
    )
    .join('')
    .replace(/\u0000/g, '\\22_');

/** Whether every `[` in a value is closed by a later `]`, with none nested. */
const balancedBrackets = (v: string): boolean => /^[^[\]]*(\[[^[\]]*\][^[\]]*)*$/.test(v);

/**
 * One declaration as a Tailwind class (without the display variant). With the forest's token
 * kinds, a value that is exactly `var(--token)` becomes the theme utility (`bg-brand`).
 */
export function tailwindClass(prop: string, value: string, tokenKinds?: ReadonlyMap<string, TokenKind>): string {
  // Tailwind v4 generates nothing for `!important` inside the brackets; its `!` modifier works in v3 and v4.
  const important = /\s*!\s*important\s*$/i;
  if (important.test(value)) return tailwindClass(prop, value.replace(important, ''), tokenKinds).split(' ').map((c) => `!${c}`).join(' ');
  const v = value.trim();
  const themed = tokenKinds ? tailwindTokenClass(prop, v, tokenKinds) : undefined;
  if (themed) return themed;
  const keyword = Object.hasOwn(KEYWORD_UTILITIES, prop) && Object.hasOwn(KEYWORD_UTILITIES[prop], v) ? KEYWORD_UTILITIES[prop][v] : undefined;
  if (keyword) return keyword;
  const utility = Object.hasOwn(VALUE_UTILITIES, prop) ? VALUE_UTILITIES[prop] : undefined;
  // The utility even for `0 auto` (`m-[0_auto]`): Tailwind v3 writes arbitrary properties after
  // every utility, so `[margin:0_auto]` would beat an `mt-[2rem]` meant to override it.
  // Grid line names (`[a] 1fr [b]`) go in the utility too: Tailwind v3 can't read brackets nested
  // in an arbitrary property, but takes balanced ones in a utility's value.
  const lineNames = /^grid-template-(columns|rows)$/.test(prop) && balancedBrackets(v);
  if (utility && (!/[[\]]/.test(v) || lineNames)) return `${utility}-[${bracket(v)}]`;
  return `[${prop}:${bracket(v)}]`;
}


function tailwindClasses(branch: Branch, tokenKinds: ReadonlyMap<string, TokenKind>): string[] {
  const decls: { prop: string; cls: string; variant: string; tier: number }[] = [];
  for (const display of DISPLAYS) {
    const styles: StyleMap | undefined = branch.styles[display.id];
    if (!styles) continue;
    const variant = tailwindVariant(display);
    for (const [prop, raw] of Object.entries(styles)) {
      const value = sanitizeCssValue(raw);
      if (!isSafeCssProp(prop) || !value) continue;
      // Tailwind orders arbitrary properties by name, not as written, so a shorthand and a
      // longhand it covers could swap. Each declaration that must beat an earlier overlapping
      // one gets one more `&` of specificity (`[&&]:`); the same property on a later display
      // keeps its tier, since Tailwind already writes display variants after the base.
      // Two named utilities (`m-[0_auto]`, `mt-[2rem]`) are written shorthand first, so only a
      // shorthand that comes after its longhand (`pt-[20px]`, then `p-[3px]`) needs the bump.
      const cls = tailwindClass(prop, value, tokenKinds);
      let tier = 1;
      for (const d of decls) {
        if (d.prop === prop) tier = Math.max(tier, d.tier);
        // Only a named shorthand followed by a named longhand it covers is already in order.
        else if (cssOverlaps(d.prop, prop)) tier = Math.max(tier, /^!?\[/.test(d.cls) || /^!?\[/.test(cls) || !cssCovers(d.prop, prop) ? d.tier + 1 : d.tier);
      }
      decls.push({ prop, cls, variant, tier });
    }
  }
  // A declaration can take two classes (`bg-none bg-brand`); each gets the variant.
  return decls.flatMap((d) => d.cls.split(' ').map((c) => `${d.variant}${d.tier > 1 ? `[${'&'.repeat(d.tier)}]:` : ''}${c}`));
}

/* ------------------------------------------------------- element model */

/** A rendered element, before it is written as HTML, JSX or a template. */
type El =
  | {
      kind: 'el';
      tag: string;
      attrs: [string, string][];
      children: El[];
      svg: boolean;
      /** Component exports: render only when this prop is set (`negate`: when it isn't). */
      cond?: { prop: string; negate: boolean };
      /** Component exports: the root's class list gets the variant modifier classes from the `variant` prop. */
      variantClass?: boolean;
      /** Inside a `<pre>` (or a textarea): whitespace is written exactly as it is. */
      pre?: boolean;
      /** Its own styles make it `inline*`, so a line break beside it would show as a gap. */
      inlineDisplay?: boolean;
    }
  | { kind: 'text'; value: string; pre?: boolean };

/** Mark `<pre>` and `<textarea>` elements and everything inside them. */
function markPre(el: El, inPre = false): void {
  if (el.kind !== 'el') {
    if (inPre) el.pre = true;
    return;
  }
  const pre = inPre || el.pre || PRE_TAGS.has(el.tag);
  if (pre) el.pre = true;
  el.children.forEach((c) => markPre(c, pre));
}

/** A `data-show-if` test as the editor makes it: a boolean prop as it is; any other prop is off when '', 'false' or '0'. */
function condExpr(cond: { prop: string; negate: boolean }, props: ReadonlySet<string>, vue = false): string {
  // Vue templates may use only a fixed list of globals, which has `String` but not `globalThis`.
  // Elsewhere `globalThis.String`, since a component may itself be called String.
  const str = vue ? 'String' : 'globalThis.String';
  const on = props.has(cond.prop) ? cond.prop : `(${cond.prop} && ${str}(${cond.prop}) !== 'false' && ${str}(${cond.prop}) !== '0')`;
  return cond.negate ? `!${on}` : on;
}

interface Build {
  /** Prop defaults (component exports), to check URLs as they will be filled. */
  defaults?: Record<string, string>;
  styling: ComponentStyling;
  classOf: (b: Branch) => string;
  rules: DisplayRule[];
  tokenKinds: ReadonlyMap<string, TokenKind>;
  /** Component exports: `{{prop}}` placeholders become expressions, `data-show-if` a condition. */
  props?: boolean;
  /** Branches that need a generated class even without styles (variants style them). */
  forceClass?: Set<string>;
  /** Generated class per branch id, for variant rules. */
  classes?: Map<string, string>;
}

/**
 * Attribute names a framework template takes as plain attributes. Vue reads `:x`, `v-*`, `@x` and
 * `#x` as directives and Svelte reads `on:x`, `bind:x` and the like, which would run imported
 * attribute values as code, so only plain names and the XML namespaces are kept. No `.` either: on a
 * bound attribute Vue reads `.camel` and `.prop` as modifiers (`:inner-h-t-m-l.camel` sets innerHTML).
 */
const PLAIN_ATTR = /^(?:(?:xlink|xml|xmlns):)?[a-zA-Z_][\w-]*$/;
// `is` too: Vue renders `<component is="script">` and `is="vue:script"` as the element it names.
/** Attribute names the frameworks take for themselves: `is` (Vue), `ref` and `key` (React, Vue), `slot` (Svelte, Vue), `children` and `dangerouslySetInnerHTML` (React). */
const FRAMEWORK_ATTRS = new Set(['is', 'ref', 'key', 'slot', 'children', 'dangerouslysetinnerhtml']);
const isExportAttr = (name: string, value: string, defaults?: Record<string, string>) =>
  PLAIN_ATTR.test(name) && !/^v-/i.test(name) && !FRAMEWORK_ATTRS.has(name.toLowerCase()) && !isDomPropName(name) && landsAs(name).every((n) => isSafeFilled(n, value, defaults));
/**
 * Vue sets an attribute whose name is a property of the element (`innerHTML`) as that property,
 * so a mixed-case name is kept only when it is an SVG attribute's own case (`viewBox`), and the
 * HTML-setting property names are never kept.
 */
const isDomPropName = (name: string): boolean =>
  /^(inner|outer)(html|text)$|^textcontent$/i.test(name) || (name !== name.toLowerCase() && !/^(xlink|xml|xmlns):/.test(name) && canonicalSvgAttr(name.toLowerCase()) !== name);
/**
 * The names an attribute can end up as in the page: JSX camel-cases `h-ref` to `hRef`, which the
 * browser reads as `href`, and React writes `xlinkHref` as `xlink:href`, so each is checked.
 */
function landsAs(name: string): string[] {
  const jsx = jsxAttrName(name).toLowerCase();
  return [name, jsx, jsx === 'xlinkhref' ? 'xlink:href' : jsx];
}
/**
 * `isSafeAttr` for a value as it will be at run time: with its `{{prop}}` placeholders empty and
 * filled with the props' defaults too (`java{{x}}script:` or a `javascript:` default would
 * otherwise only become a URL in the exported component).
 */
function isSafeFilled(name: string, value: string, defaults?: Record<string, string>): boolean {
  if (!isSafeAttr(name, value)) return false;
  if (!/\{\{/.test(value)) return true;
  const fill = (values: Record<string, string>) => value.replace(/\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g, (_m, p: string) => (Object.hasOwn(values, p) ? values[p] : ''));
  return isSafeAttr(name, fill({})) && (!defaults || isSafeAttr(name, fill(defaults)));
}
/** Vue's built-in components aren't HTML; exported as they are, `<component>` could render any element. */
// `slot` too: Vue renders it as a slot outlet and drops its content.
const FRAMEWORK_TAGS = new Set(['component', 'teleport', 'keep-alive', 'keepalive', 'suspense', 'transition', 'transition-group', 'transitiongroup', 'slot']);

function leafEl(leaf: Leaf, inSvg: boolean, defaults?: Record<string, string>): El {
  const attrs = Object.entries(leaf.attrs ?? {}).filter(([n, v]) => isExportAttr(n, v, defaults));
  if (leaf.type === 'shape') {
    const tag = canonicalTag(leaf.value);
    return { kind: 'el', tag: SVG_SHAPES.has(tag) ? tag : 'g', attrs, children: [], svg: true };
  }
  if (leaf.type === 'image') {
    const src = isSafeFilled('src', leaf.value, defaults) ? leaf.value : '';
    if (inSvg) return { kind: 'el', tag: 'image', attrs: [['href', src], ...attrs.filter(([n]) => n !== 'href' && n !== 'alt')], children: [], svg: true };
    const rest = attrs.filter(([n]) => n !== 'src' && n !== 'alt');
    return { kind: 'el', tag: 'img', attrs: [['src', src], ['alt', leaf.attrs?.alt ?? ''], ...rest], children: [], svg: false };
  }
  return { kind: 'text', value: leaf.value };
}

/**
 * Mend nesting a browser would repair while parsing, which Svelte refuses to compile (and React
 * warns about): a link in a link becomes a span, a paragraph or heading holding blocks a div,
 * rows straight under a table go in a tbody, and whitespace between table parts goes.
 */
/**
 * Whether an element matching `test` sits anywhere below `node`, outside SVG. Svelte refuses a
 * paragraph-closing element (`<div>`, `<ul>` …) at any depth under a `<p>`, and a heading under
 * a heading; others (`<select>`, `<picture>`, `<ruby>`) are fine there, in browsers too.
 */
function tagBelow(node: Branch, test: (tag: string) => boolean, inSvg = false): boolean {
  return node.children.some((c) => {
    if (!isBranch(c)) return false;
    const lower = c.tag.toLowerCase();
    if (inSvg) return tagBelow(c, test, lower !== 'foreignobject');
    if (lower === 'svg') return tagBelow(c, test, true);
    return test(lower) || tagBelow(c, test);
  });
}

/** Elements whose start tag closes an open one of the same group, so one can't sit directly in another. */
const AUTO_CLOSE_GROUP: Record<string, string> = { li: 'li', dd: 'dl', dt: 'dl', td: 'cell', th: 'cell', rt: 'ruby', rp: 'ruby' };

/** Table parts and the parents the parser keeps them in (cells and rows outside a row or body are wrapped below). */
const TABLE_PARENTS: Record<string, RegExp> = {
  caption: /^table$/,
  colgroup: /^table$/,
  thead: /^table$/,
  tbody: /^table$/,
  tfoot: /^table$/,
  col: /^(table|colgroup)$/,
  tr: /^(table|thead|tbody|tfoot)$/,
  td: /^(tr|table|thead|tbody|tfoot)$/,
  th: /^(tr|table|thead|tbody|tfoot)$/,
};

/** Runs of children matching `test` gathered into new `tag` wrappers (ids derived from the parent's). */
function wrapRuns(parent: Branch, children: TreeNode[], tag: string, test: (c: TreeNode) => boolean): TreeNode[] {
  if (!children.some(test)) return children;
  const out: TreeNode[] = [];
  let run: Branch | null = null;
  for (const c of children) {
    if (test(c)) {
      if (!run) {
        run = { kind: 'branch', id: `${parent.id}~${tag}${out.length}`, tag, classes: [], attrs: {}, styles: {}, children: [] };
        out.push(run);
      }
      run.children.push(c);
    } else {
      run = null;
      out.push(c);
    }
  }
  return out;
}

const tagIs = (c: TreeNode, re: RegExp) => isBranch(c) && re.test(c.tag.toLowerCase());

export function repairNesting(node: Branch, ctx: { a?: boolean; form?: boolean; button?: boolean; parent?: string } = {}): Branch {
  const lower = node.tag.toLowerCase();
  if (lower === 'svg') return node;
  let tag = node.tag;
  if ((lower === 'a' && ctx.a) || (lower === 'button' && ctx.button)) tag = 'span';
  if (lower === 'form' && ctx.form) tag = 'div';
  if (lower === 'p' && tagBelow(node, closesParagraph)) tag = 'div';
  if (/^h[1-6]$/.test(lower) && tagBelow(node, (t) => /^h[1-6]$/.test(t))) tag = 'div';
  // An <li> right inside an <li> (a <td> in a <td>, …) would close its parent when parsed.
  const group = Object.hasOwn(AUTO_CLOSE_GROUP, lower) ? AUTO_CLOSE_GROUP[lower] : undefined;
  if (group && ctx.parent && Object.hasOwn(AUTO_CLOSE_GROUP, ctx.parent) && AUTO_CLOSE_GROUP[ctx.parent] === group) tag = group === 'ruby' ? 'span' : 'div';
  // A table part outside a table is dropped by the parser. At a component's root (no parent) it
  // may be meant for a table the component is used in, so it is kept there.
  if (ctx.parent !== undefined && Object.hasOwn(TABLE_PARENTS, lower) && !TABLE_PARENTS[lower].test(ctx.parent)) tag = 'div';
  const inner = { a: ctx.a || lower === 'a', form: ctx.form || lower === 'form', button: ctx.button || lower === 'button', parent: tag.toLowerCase() };
  // An <option> in an <option> (an <optgroup> in an <optgroup>) can't be written: its content joins the parent.
  let own: TreeNode[] = node.children;
  if (lower === 'option' || lower === 'optgroup') {
    while (own.some((c) => isBranch(c) && c.tag.toLowerCase() === lower)) own = own.flatMap((c) => (isBranch(c) && c.tag.toLowerCase() === lower ? c.children : [c]));
  }
  let children: TreeNode[] = own.map((c) => (isBranch(c) ? repairNesting(c, inner) : c));
  const now = tag.toLowerCase();
  if (/^(table|thead|tbody|tfoot|tr)$/.test(now)) {
    children = children.filter((c) => isBranch(c) || c.type !== 'text' || c.value.trim() !== '');
    // Anything that isn't a table part (text, an image, a <p>) is moved out of a table by the
    // parser, so it goes in a cell; and stray cells go in a row.
    const parts = now === 'table' ? /^(caption|colgroup|col|thead|tbody|tfoot|tr|td|th|template)$/ : now === 'tr' ? /^(td|th|template)$/ : /^(tr|td|th|template)$/;
    children = wrapRuns(node, children, 'td', (c) => !tagIs(c, parts));
    if (now !== 'tr') children = wrapRuns(node, children, 'tr', (c) => tagIs(c, /^t[dh]$/));
  }
  if (lower === 'table') {
    children = wrapRuns(node, children, 'colgroup', (c) => tagIs(c, /^col$/));
    children = wrapRuns(node, children, 'tbody', (c) => tagIs(c, /^tr$/));
  }
  const same = tag === node.tag && children.length === node.children.length && children.every((c, i) => c === node.children[i]);
  return same ? node : { ...node, tag, children };
}

function branchEl(branch: Branch, b: Build, inSvg: boolean, asTag?: string): El {
  const safe = safeTag(branch.tag);
  const tag = asTag ?? (FRAMEWORK_TAGS.has(safe.toLowerCase()) ? 'div' : safe);
  const svg = inSvg || tag === 'svg';
  const childSvg = childrenInSvg(branch, inSvg);
  const classes = branch.classes.filter(Boolean);
  const forced = b.forceClass?.has(branch.id) && b.styling === 'css';
  if (hasStyles(branch) || forced) {
    if (b.styling === 'tailwind') classes.push(...tailwindClasses(branch, b.tokenKinds));
    else {
      const cls = b.classOf(branch);
      classes.push(cls);
      b.classes?.set(branch.id, cls);
      if (hasStyles(branch)) b.rules.push({ selector: `.${cls}`, styles: branch.styles });
    }
  }
  const attrs: [string, string][] = [];
  if (classes.length) attrs.push(['class', classes.join(' ')]);
  let cond: { prop: string; negate: boolean } | undefined;
  for (const [name, value] of Object.entries(branch.attrs)) {
    if (b.props && name === IF_ATTR) {
      const prop = value.trim().replace(/^!/, '');
      if (isPropName(prop)) cond = { prop, negate: value.trim().startsWith('!') };
      continue;
    }
    if (name === 'class' || name === 'style' || !isExportAttr(name, value, b.defaults)) continue;
    // HTML ignores `value` on these (the content or the selected option counts); frameworks don't.
    if (name.toLowerCase() === 'value' && (tag === 'textarea' || tag === 'select') && !svg) continue;
    attrs.push([name, value]);
  }
  if (tag === 'svg' && !inSvg && !branch.attrs.xmlns) attrs.push(['xmlns', 'http://www.w3.org/2000/svg']);
  const children = branch.children.map((c: TreeNode) => (isBranch(c) ? branchEl(c, b, childSvg) : leafEl(c, childSvg, b.defaults)));
  const el: El = cond ? { kind: 'el', tag, attrs, children, svg, cond } : { kind: 'el', tag, attrs, children, svg };
  if (!svg && hasInlineDisplay(branch)) el.inlineDisplay = true;
  // `white-space: pre` and the like show whitespace as written, as a <pre> does.
  if (keepsWhitespace(branch) || (svg && branch.attrs['xml:space'] === 'preserve')) el.pre = true;
  return el;
}

/* ------------------------------------------------------ props in markup */

/** Split a value at its `{{prop}}` placeholders: literal strings and prop names, alternating. */
function segments(value: string): { lit: string; prop?: string }[] {
  const out: { lit: string; prop?: string }[] = [];
  let last = 0;
  for (const m of value.matchAll(/\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g)) {
    out.push({ lit: value.slice(last, m.index), prop: m[1] });
    last = m.index! + m[0].length;
  }
  out.push({ lit: value.slice(last) });
  return out;
}
const hasProps = (value: string) => /\{\{\s*[A-Za-z][A-Za-z0-9_]*\s*\}\}/.test(value);
/** A prop as the editor writes it into text: a boolean prop (in `bools`) is 'true', or nothing when off. */
const propText = (prop: string, bools?: ReadonlySet<string>): string => (bools?.has(prop) ? `(${prop} ? 'true' : '')` : prop);
/** A JS template literal for a value with placeholders: `card-${tone}`. */
const templateLiteral = (value: string, extra = '', bools?: ReadonlySet<string>): string =>
  `\`${segments(value)
    .map((s) => s.lit.replace(/[`\\]/g, '\\$&').replace(/\$\{/g, '\\${') + (s.prop ? `\${${propText(s.prop, bools)}}` : ''))
    .join('')}${extra}\``;
/** A JS expression for a value: the bare prop when the value is just `{{prop}}`. */
const propExpr = (value: string, bools?: ReadonlySet<string>): string => {
  const segs = segments(value);
  return segs.length === 2 && !segs[0].lit && !segs[1].lit ? propText(segs[0].prop!, bools) : templateLiteral(value, '', bools);
};
/** The `variant` prop's modifier classes, added to the root's class list. */
const VARIANT_CALL = 'variantClasses(variant)';
const variantSuffix = `\${${VARIANT_CALL}}`;

/* ------------------------------------------------------------- writers */

const isInlineEl = (el: El): boolean => el.kind === 'text' || isInlineTag(el.tag);
/** Keep children on one line when line breaks could change the text, or open gaps between inline-block siblings. */
const keepTogether = (children: El[]): boolean => oneLine(children) || children.some((c) => c.kind === 'el' && c.inlineDisplay);
/** Keep children on one line when line breaks could show as spaces: any text or inline element beside them (as the canvas renders). */
const oneLine = (children: El[]): boolean => children.some((c) => c.kind === 'text' || isInlineEl(c));
/**
 * Children on separate lines for HTML, Vue and Svelte. HTML keeps the line break between two
 * inline elements as a space, so runs of inline siblings stay together on one line.
 */
function childLines(children: El[], pad: string, write: (c: El) => string): string {
  const lines: string[] = [];
  let prevInline = false;
  for (const c of children) {
    const inline = isInlineEl(c);
    if (inline && prevInline) lines[lines.length - 1] += write(c);
    else lines.push(pad + write(c));
    prevInline = inline;
  }
  return lines.join('\n');
}

/**
 * Children written on one line. Svelte drops whitespace at the start and end of an element,
 * which shows inside inline elements (`<strong>Note: </strong>`), so it is written as `{' '}`.
 */
function inlineChildren(children: El[], mode: 'html' | 'vue' | 'svelte', write: (c: El) => string, pre = false): string {
  const parts = children.map(write);
  // Both keep whitespace inside a <pre> as written.
  if (pre) return parts.join('');
  if (mode === 'vue' && parts.length) {
    // Vue drops a whitespace-only first or last child.
    // Only HTML whitespace: Vue and Svelte keep a non-breaking space.
    const blank = (i: number) => children[i].kind === 'text' && parts[i] !== '' && !/[^ \t\n\f\r]/.test(parts[i]);
    if (blank(0)) parts[0] = `{{ ' ' }}`;
    if (blank(parts.length - 1)) parts[parts.length - 1] = `{{ ' ' }}`;
  }
  if (mode === 'svelte' && parts.length) {
    if (children[0].kind === 'text' && /^[ \t\n\f\r]/.test(parts[0])) parts[0] = `{' '}${parts[0].replace(/^[ \t\n\f\r]+/, '')}`;
    const last = parts.length - 1;
    if (children[last].kind === 'text' && /[ \t\n\f\r]$/.test(parts[last])) parts[last] = `${parts[last].replace(/[ \t\n\f\r]+$/, '')}{' '}`;
  }
  return parts.join('');
}

/** HTML (also Vue and Svelte templates). */
/** `props` is false outside a component; in one, the names of its boolean props. */
/** An `&` a parser would read as a character reference: `&#…` or `&name;` (`&fit=crop` is left alone). */
const REF_AMP = /&(?=#|[A-Za-z][A-Za-z0-9]*;)/g;

/**
 * A class attribute, with `&` left as written unless it could start a character reference:
 * Tailwind reads classes from the source text, so `[&&]:` written `[&amp;&amp;]:` would be missed.
 */
const escapeClassAttr = (v: string): string => v.replace(REF_AMP, '&amp;').replace(/"/g, '&quot;');

/** HTML (and Vue and Svelte templates) drop one newline right after these tags, so a leading one is doubled. */
const leadNewline = (tag: string, content: string): string => (/^(pre|textarea|listing)$/i.test(tag) && /^[\r\n]/.test(content) ? `\n${content}` : content);

function writeHtml(el: El, depth: number, mode: 'html' | 'vue' | 'svelte', props: false | ReadonlySet<string> = false): string {
  if (el.kind === 'text' && props && mode !== 'html' && hasProps(el.value)) {
    // Vue: {{ title }}; Svelte: {title}. Literal parts are escaped as usual.
    const segs = segments(el.value);
    return segs
      .map((s, i) => {
        // A boolean prop reads as the editor stores it: 'true', or nothing when off.
        const expr = s.prop && props.has(s.prop) ? `${s.prop} ? 'true' : ''` : s.prop;
        // Vue splits the text at each prop and drops a whitespace-only first or last piece, which
        // shows at an inline element's edge (`<strong> {{ name }} </strong>`): write it as a space.
        const edge = (i === 0 || i === segs.length - 1) && segs.length > 1;
        const lit = mode === 'vue' && !el.pre && edge && /^[ \t\n\f\r]+$/.test(s.lit) ? `{{ ' ' }}` : writeHtml({ kind: 'text', value: s.lit, pre: el.pre }, depth, mode);
        return lit + (expr ? (mode === 'vue' ? `{{ ${expr} }}` : `{${expr}}`) : '');
      })
      .join('');
  }
  if (el.kind === 'el' && props && mode !== 'html') {
    const inner = writePropsEl(el, depth, mode, props);
    if (el.cond && mode === 'svelte') return `{#if ${condExpr(el.cond, props)}}${inner}{/if}`;
    return inner;
  }
  if (el.kind === 'text') {
    // Vue condenses whitespace and Svelte collapses it between nodes, even where CSS shows it; a
    // string expression keeps it. Escaped so neither template parser sees a tag or delimiter in it.
    if (el.pre && mode !== 'html' && /[ \t\n\f\r]{2}|[\n\t\f\r]|^[ \t\n\f\r]|[ \t\n\f\r]$/.test(el.value)) {
      const literal = JSON.stringify(el.value).replace(/[<>&{}]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
      // Vue writes a constant subtree as an HTML string, and parsing that drops a newline right after
      // `<pre>` or `<textarea>`. A call isn't a constant to Vue, so `String(…)` keeps it.
      if (mode === 'vue') return /^[\r\n]/.test(el.value) ? `{{ String(${literal}) }}` : `{{ ${literal} }}`;
      return `{${literal}}`;
    }
    const text = escapeHtml(el.value);
    // `{` starts an expression in Svelte, `{{` in Vue. Every brace is escaped, so neither a run of
    // braces nor two text leaves side by side can form one.
    if (mode !== 'html') return text.replace(/[{}]/g, (c) => (c === '{' ? '&#123;' : '&#125;'));
    return text;
  }
  // Escape for HTML first, then Svelte's braces, so the &#123; entities are not escaped again.
  const esc = (v: string, n = '') => {
    const out = n === 'class' ? escapeClassAttr(v) : escapeAttr(v);
    return mode === 'svelte' ? out.replace(/[{}]/g, (c) => (c === '{' ? '&#123;' : '&#125;')) : out;
  };
  const attrs = el.attrs.map(([n, v]) => (v === '' && !el.svg ? ` ${n}` : ` ${n}="${esc(v, n)}"`)).join('');
  if (!el.svg && VOID_TAGS.has(el.tag)) return `<${el.tag}${attrs}>`;
  if (!el.children.length) return el.svg ? `<${el.tag}${attrs} />` : `<${el.tag}${attrs}></${el.tag}>`;
  if (el.pre || keepTogether(el.children)) return `<${el.tag}${attrs}>${leadNewline(el.tag, inlineChildren(el.children, mode, (c) => writeHtml(c, depth + 1, mode), el.pre))}</${el.tag}>`;
  const pad = '  '.repeat(depth + 1);
  return `<${el.tag}${attrs}>\n${childLines(el.children, pad, (c) => writeHtml(c, depth + 1, mode))}\n${'  '.repeat(depth)}</${el.tag}>`;
}

const JSX_ATTRS: Record<string, string> = {
  class: 'className',
  for: 'htmlFor',
  tabindex: 'tabIndex',
  colspan: 'colSpan',
  rowspan: 'rowSpan',
  readonly: 'readOnly',
  maxlength: 'maxLength',
  minlength: 'minLength',
  crossorigin: 'crossOrigin',
  srcset: 'srcSet',
  autoplay: 'autoPlay',
  autofocus: 'autoFocus',
  autocomplete: 'autoComplete',
  contenteditable: 'contentEditable',
  datetime: 'dateTime',
  enctype: 'encType',
  accesskey: 'accessKey',
  novalidate: 'noValidate',
  spellcheck: 'spellCheck',
  usemap: 'useMap',
  charset: 'charSet',
  playsinline: 'playsInline',
  referrerpolicy: 'referrerPolicy',
  allowfullscreen: 'allowFullScreen',
  formaction: 'formAction',
  hreflang: 'hrefLang',
  inputmode: 'inputMode',
  itemscope: 'itemScope',
  itemtype: 'itemType',
  itemid: 'itemID',
  itemprop: 'itemProp',
  itemref: 'itemRef',
  formnovalidate: 'formNoValidate',
  formmethod: 'formMethod',
  formtarget: 'formTarget',
  formenctype: 'formEncType',
  nomodule: 'noModule',
  enterkeyhint: 'enterKeyHint',
  popovertarget: 'popoverTarget',
  popovertargetaction: 'popoverTargetAction',
  fetchpriority: 'fetchPriority',
  srclang: 'srcLang',
  srcdoc: 'srcDoc',
  cellpadding: 'cellPadding',
  cellspacing: 'cellSpacing',
  frameborder: 'frameBorder',
  marginheight: 'marginHeight',
  marginwidth: 'marginWidth',
  'accept-charset': 'acceptCharset',
  'http-equiv': 'httpEquiv',
  'xlink:href': 'xlinkHref',
  'xml:space': 'xmlSpace',
  'xml:lang': 'xmlLang',
};


/** HTML attributes React's types take as numbers. */
const NUMERIC_ATTRS = new Set(['tabindex', 'colspan', 'rowspan', 'rows', 'cols', 'size', 'maxlength', 'minlength', 'start', 'span']);

/** SVG presentation attributes, which React takes in camel case (`strokeWidth`). */
const SVG_DASHED = new Set(
  'alignment-baseline baseline-shift clip-path clip-rule color-interpolation color-interpolation-filters color-profile color-rendering dominant-baseline enable-background fill-opacity fill-rule flood-color flood-opacity font-family font-size font-size-adjust font-stretch font-style font-variant font-weight glyph-name glyph-orientation-horizontal glyph-orientation-vertical horiz-adv-x image-rendering letter-spacing lighting-color marker-end marker-mid marker-start overline-position overline-thickness paint-order panose-1 pointer-events rendering-intent shape-rendering stop-color stop-opacity strikethrough-position strikethrough-thickness stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin stroke-miterlimit stroke-opacity stroke-width text-anchor text-decoration text-rendering underline-position underline-thickness unicode-bidi unicode-range units-per-em v-alphabetic v-hanging v-ideographic v-mathematical vector-effect vert-adv-y vert-origin-x vert-origin-y word-spacing writing-mode x-height'.split(' '),
);

/** An attribute name as React expects it. */
export function jsxAttrName(name: string): string {
  const lower = name.toLowerCase();
  if (Object.hasOwn(JSX_ATTRS, lower)) return JSX_ATTRS[lower];
  if (lower.startsWith('data-') || lower.startsWith('aria-')) return lower;
  // Only names React knows in camel case are converted (SVG presentation attributes, `xlink:*`);
  // React passes any other name through as written (`hx-post`, a custom element's `some-attr`).
  if (SVG_DASHED.has(lower) || /^(xlink|xml|xmlns):/.test(lower)) return lower.replace(/[-:]([a-z])/g, (_m, c: string) => c.toUpperCase());
  return name;
}

/** An element of a Vue or Svelte component template, with prop bindings. */
function writePropsEl(el: El & { kind: 'el' }, depth: number, mode: 'vue' | 'svelte', props: ReadonlySet<string>): string {
  // Escape for HTML first, then Svelte's braces, so the &#123; entities are not escaped again.
  const esc = (v: string, n = '') => {
    const out = n === 'class' ? escapeClassAttr(v) : escapeAttr(v);
    return mode === 'svelte' ? out.replace(/[{}]/g, (c) => (c === '{' ? '&#123;' : '&#125;')) : out;
  };
  const attrs = el.attrs
    .map(([n, v]) => {
      const variant = n === 'class' && el.variantClass;
      if (!hasProps(v) && !variant) return v === '' && !el.svg ? ` ${n}` : ` ${n}="${esc(v, n)}"`;
      // A boolean attribute is on unless its prop is off (see `expandComponent` in core): a
      // boolean prop as it is, any other value unless it is "false".
      if (!variant && !el.svg && BOOLEAN_ATTRS.has(n.toLowerCase())) {
        const expr = propExpr(v);
        const on = props.has(expr) ? expr : `${expr} !== 'false'`;
        return mode === 'vue' ? ` :${n}="${escapeAttr(on)}"` : ` ${n}={${on}}`;
      }
      if (mode === 'vue') return ` :${n}="${(n === 'class' ? escapeClassAttr : escapeAttr)(variant ? templateLiteral(v, variantSuffix, props) : propExpr(v, props))}"`;
      // Svelte: attribute values can hold {expressions} between literal text.
      const body = segments(v)
        .map((s) => esc(s.lit, n) + (s.prop ? `{${props.has(s.prop) ? `${s.prop} ? 'true' : ''` : s.prop}}` : ''))
        .join('');
      return ` ${n}="${body}${variant ? `{${VARIANT_CALL}}` : ''}"`;
    })
    .join('');
  const cond = mode === 'vue' && el.cond ? ` v-if="${escapeAttr(condExpr(el.cond, props, true))}"` : '';
  if (!el.svg && VOID_TAGS.has(el.tag)) return `<${el.tag}${cond}${attrs}>`;
  if (!el.children.length) return el.svg ? `<${el.tag}${cond}${attrs} />` : `<${el.tag}${cond}${attrs}></${el.tag}>`;
  if (el.pre || keepTogether(el.children)) return `<${el.tag}${cond}${attrs}>${leadNewline(el.tag, inlineChildren(el.children, mode, (c) => writeHtml(c, depth + 1, mode, props), el.pre))}</${el.tag}>`;
  const pad = '  '.repeat(depth + 1);
  return `<${el.tag}${cond}${attrs}>\n${childLines(el.children, pad, (c) => writeHtml(c, depth + 1, mode, props))}\n${'  '.repeat(depth)}</${el.tag}>`;
}

const jsxString = (value: string): string => JSON.stringify(value);

/** `props` is false outside a component; in one, the names of its boolean props. */
function writeJsx(el: El, depth: number, props: false | ReadonlySet<string> = false): string {
  if (el.kind === 'text') {
    if (props && hasProps(el.value))
      return segments(el.value)
        // React renders nothing for `true` and `false`, so a boolean prop is written as the editor
        // stores it: 'true', or nothing when off.
        .map((s) => (s.lit ? writeJsx({ kind: 'text', value: s.lit }, depth) : '') + (s.prop ? (props.has(s.prop) ? `{${s.prop} ? 'true' : ''}` : `{${s.prop}}`) : ''))
        .join('');
    // Plain text is fine unless it holds JSX syntax characters; then use a string expression.
    // Line breaks too: JSX text collapses them (and the indentation around them).
    return /[{}<>\n\r]/.test(el.value) || /^\s|\s$/.test(el.value) ? `{${jsxString(el.value)}}` : el.value.replace(/&/g, '&amp;');
  }
  if (props && el.cond) {
    const { cond, ...rest } = el;
    return `{${condExpr(cond, props)} && (${writeJsx(rest, depth, props)})}`;
  }
  const attrs = el.attrs
    // A `.` in a name is fine in HTML but not in JSX, and of the `xmlns:` names React knows only `xmlnsXlink`.
    .filter(([n]) => !n.includes('.') && !(/^xmlns:/i.test(n) && n.toLowerCase() !== 'xmlns:xlink'))
    .map(([n, v]) => {
      // Without onChange, React makes `value`/`checked` read-only; the default* props keep fields editable.
      const formField = (el.tag === 'input' || el.tag === 'textarea' || el.tag === 'select') && (n === 'value' || n === 'checked');
      // A custom element gets `class` and `for` as written: React 18 would write `classname=` there.
      const custom = el.tag.includes('-') && /^(class|for)$/i.test(n);
      const name = formField ? (n === 'value' ? 'defaultValue' : 'defaultChecked') : custom ? n.toLowerCase() : jsxAttrName(n);
      if (props && n === 'class' && el.variantClass) return ` ${name}={${templateLiteral(v, variantSuffix, props)}}`;
      const numeric = !el.svg && NUMERIC_ATTRS.has(n.toLowerCase());
      // `hidden="until-found"` too: React takes `hidden` as a boolean only and renders a string as `hidden=""`.
      const boolAttr = !el.svg && BOOLEAN_ATTRS.has(n.toLowerCase());
      if (props && hasProps(v)) {
        const expr = propExpr(v);
        // `globalThis.Number`: a component or prop may itself be called Number.
        // A boolean prop in any other attribute reads as the editor writes it: 'true', or nothing when off.
        if (props.has(expr)) return ` ${name}={${boolAttr ? expr : numeric ? `globalThis.Number(${expr})` : `${expr} ? 'true' : ''`}}`;
        // A text prop turns a boolean attribute on as HTML does (any value), unless it is "false".
        if (boolAttr) return ` ${name}={globalThis.String(${expr}) !== 'false'}`;
        // An empty prop leaves the attribute off, as the string form does, rather than giving 0.
        // A prop with no default is undefined, which would give NaN.
        return numeric ? ` ${name}={${expr} == null || ${expr} === '' ? undefined : globalThis.Number(${expr})}` : ` ${name}={${propExpr(v, props)}}`;
      }
      // HTML turns a boolean attribute on whatever its value, and React (and its types) take `true`.
      if (boolAttr) return ` ${name}`;
      // React's types take numbers for these.
      if (numeric && /^-?\d{1,15}$/.test(v.trim())) return ` ${name}={${Number(v.trim())}}`;
      // `&` only where it could start a reference: Tailwind reads `[&&]:` classes from the source text.
      // JSX attribute strings are literal (backslashes and braces included), so a JS string is only
      // needed for a value holding both quote kinds or a line break; Tailwind reads classes as written.
      const amp = v.replace(REF_AMP, '&amp;');
      if (/[\n\r]/.test(v) || (v.includes('"') && v.includes("'"))) return ` ${name}={${jsxString(v)}}`;
      return v.includes('"') ? ` ${name}='${amp}'` : ` ${name}="${amp}"`;
    })
    .join('');
  // React takes one child at most in a <textarea> (props split the text into several), and
  // wants its text as defaultValue anyway.
  if (el.tag === 'textarea' && el.children.length) {
    const value = el.children.map((c) => (c.kind === 'text' ? c.value : '')).join('');
    const expr = props && hasProps(value) ? templateLiteral(value, '', props) : jsxString(value);
    return / defaultValue=/.test(attrs) ? `<${el.tag}${attrs} />` : `<${el.tag}${attrs} defaultValue={${expr}} />`;
  }
  if (!el.children.length) return `<${el.tag}${attrs} />`;
  if (oneLine(el.children)) return `<${el.tag}${attrs}>${el.children.map((c) => writeJsx(c, depth + 1, props)).join('')}</${el.tag}>`;
  const pad = '  '.repeat(depth + 1);
  return `<${el.tag}${attrs}>\n${el.children.map((c) => pad + writeJsx(c, depth + 1, props)).join('\n')}\n${'  '.repeat(depth)}</${el.tag}>`;
}

/* --------------------------------------------------------------- files */

/**
 * The design kit files: `kits.css`, in kit order. CSS takes `@import` only before any rule, so
 * when a linked kit follows an inline one, or a later inline kit has its own `@import`, each
 * inline kit gets its own file under `kits/` and `kits.css` imports them all in order.
 */
function kitFiles(kits: DesignKit[], layered = false): ComponentFile[] {
  const enabled = kits.filter((k) => k.enabled && k.source !== 'env' && (k.href || k.css.trim()));
  if (!enabled.length) return [];
  // With Tailwind, kits go in the `components` layer. Tailwind v4's utilities are in a layer, and
  // unlayered kit CSS would beat every one of them, so a branch couldn't override its kit classes.
  const link = (href: string) => `@import url("${href.replace(/["\\\n\r]/g, '')}")${layered ? ' layer(components)' : ''};`;
  const inlineCss = (k: DesignKit) => `/* ${commentText(k.name)} */\n${k.css.trim()}`;
  const firstInline = enabled.findIndex((k) => !k.href);
  const together =
    firstInline < 0 || enabled.slice(firstInline).every((k, i) => !k.href && (i === 0 || !/@import/i.test(k.css)));
  const head = layered
    ? '/* Design kits from Tree Weaver, in load order, below Tailwind\'s utilities (the same layer order Tailwind v4 declares). */\n@layer theme, base, components, utilities;\n'
    : '/* Design kits from Tree Weaver, in load order. */\n';
  if (together && !layered) return [{ path: 'kits.css', contents: `${head}${enabled.map((k) => (k.href ? link(k.href) : inlineCss(k))).join('\n\n')}\n` }];
  const used = new Set<string>();
  const files: ComponentFile[] = [];
  const lines = enabled.map((k) => {
    if (k.href) return link(k.href);
    const base = slugify(k.name, 'kit');
    let slug = base;
    for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;
    used.add(slug);
    files.push({ path: `kits/${slug}.css`, contents: `${inlineCss(k)}\n` });
    return link(`./kits/${slug}.css`);
  });
  return [{ path: 'kits.css', contents: `${head}${lines.join('\n')}\n` }, ...files];
}

/** Export a tree as a component (or a plain HTML page) with its styles. */
export function exportComponent(tree: Tree, opts: ComponentOptions): ComponentExport {
  const framework = opts.framework;
  const styling = opts.styling ?? 'css';
  const name = pascalName(opts.name ?? tree.name);
  if (framework === 'swiftui' || framework === 'flutter') {
    const type = nativeTypeName(name, framework);
    const entry = framework === 'swiftui' ? `${type}.swift` : dartFileName(type);
    const kits = opts.kits ?? [];
    // Tokens become a DesignTokens type the view refers to by name.
    const tokenFile = framework === 'swiftui' ? exportSwiftUITokens(kits) : exportFlutterTokens(kits);
    const native = { name: type, kits, tokens: !!tokenFile };
    const contents = framework === 'swiftui' ? exportSwiftUI(tree, native) : exportFlutter(tree, native);
    const files = [{ path: entry, contents }];
    if (tokenFile) files.push({ path: framework === 'swiftui' ? DESIGN_TOKENS_SWIFT : DESIGN_TOKENS_DART, contents: tokenFile });
    return { name: type, framework, entry, files };
  }
  const tokens = themeTokens((opts.kits ?? []).filter((k) => k.enabled));
  // Generated classes are namespaced (`home__hero`) so they never meet a design kit's own classes.
  const build: Build = { styling, classOf: classNamer(`${cssIdent(slugify(tree.name, 'layout'))}__`), rules: [], tokenKinds: new Map(tokens.map((t) => [t.name, t.kind])) };
  const svgTree = isSvgRoot(tree.root);

  // A page root is a <body>; in a component it becomes a wrapper <div>.
  const rootTag = svgTree ? undefined : framework === 'html' ? 'body' : 'div';
  const root = branchEl(repairNesting(tree.root), build, false, rootTag);
  markPre(root);
  if (root.kind === 'el' && !svgTree && framework !== 'html' && !root.attrs.some(([n]) => n === 'class')) {
    // Name the wrapper so it can be styled from outside: namespaced like every generated class,
    // since a bare `card` or `hidden` would pick up a kit class or a Tailwind utility.
    root.attrs.unshift(['class', build.classOf({ kind: 'branch', id: '', tag: 'div', name: 'root', classes: [], attrs: {}, styles: {}, children: [] })]);
  }

  const css = styling === 'css' ? renderDisplayCss(build.rules) : '';
  const kitFileList = kitFiles(opts.kits ?? [], styling === 'tailwind');
  const kitCss = kitFileList.length > 0;
  const files: ComponentFile[] = [];
  const header = (comment: (s: string) => string) => comment(`Generated by Tree Weaver from the tree "${commentText(tree.name)}".`);
  const cssFile = `${name}.css`;
  const tailwindNote = styling === 'tailwind' ? ' Needs Tailwind CSS v3.4+ or v4 (it uses arbitrary values and max-* variants).' : '';
  let entry: string;

  switch (framework) {
    case 'react': {
      const ext = opts.typescript ? 'tsx' : 'jsx';
      entry = `${name}.${ext}`;
      const imports = [kitCss ? `import './kits.css';` : '', css ? `import './${cssFile}';` : ''].filter(Boolean).join('\n');
      const body = writeJsx(root, 2);
      files.push({
        path: entry,
        contents: `${header((s) => `// ${s}${tailwindNote}`)}\n${imports ? `${imports}\n` : ''}\nexport default function ${name}() {\n  return (\n    ${body}\n  );\n}\n`,
      });
      break;
    }
    case 'vue': {
      entry = `${name}.vue`;
      const style = [kitCss ? `<style src="./kits.css"></style>` : '', css ? `<style>\n${css}\n</style>` : ''].filter(Boolean).join('\n');
      files.push({ path: entry, contents: `<!-- ${header((s) => s)}${tailwindNote} -->\n<template>\n  ${writeHtml(root, 1, 'vue')}\n</template>\n${style ? `\n${style}\n` : ''}` });
      break;
    }
    case 'svelte': {
      entry = `${name}.svelte`;
      const style = css ? `\n<style>\n  /* Global: the classes are generated, so scoping only gets in the way of overrides. */\n${css.replace(/^(\.[\w-]+)/gm, ':global($1)').replace(/^(\s+)(\.[\w-]+)( \{)/gm, '$1:global($2)$3')}\n</style>\n` : '';
      const script = kitCss ? `<script>\n  import './kits.css';\n</script>\n\n` : '';
      files.push({ path: entry, contents: `<!-- ${header((s) => s)}${tailwindNote} -->\n${script}${writeHtml(root, 0, 'svelte')}\n${style}` });
      break;
    }
    case 'html': {
      entry = 'index.html';
      const links = [
        styling === 'css' ? `<link rel="stylesheet" href="base.css">` : '',
        kitCss ? `<link rel="stylesheet" href="kits.css">` : '',
        css ? `<link rel="stylesheet" href="${cssFile}">` : '',
        styling === 'tailwind' ? `<!-- Build Tailwind CSS over this file and link the output here. -->` : '',
      ].filter(Boolean);
      const body = svgTree ? `<body>\n  ${writeHtml(root, 1, 'html')}\n</body>` : writeHtml(root, 0, 'html');
      files.push({
        path: entry,
        contents: `<!doctype html>\n<!-- ${header((s) => s)}${tailwindNote} -->\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${escapeHtml(tree.name)}</title>\n${links.join('\n')}\n</head>\n${body}\n</html>\n`,
      });
      if (styling === 'css') files.push({ path: 'base.css', contents: `${BASE_CSS}\n` });
      break;
    }
    default:
      throw new Error(`Unknown framework "${String(framework)}"`);
  }
  if (css && framework !== 'vue' && framework !== 'svelte') files.push({ path: cssFile, contents: `/* ${header((s) => s)} */\n${css}\n` });
  files.push(...kitFileList);
  files.push(...tokenFiles(tokens, styling));
  return { name, framework, styling, entry, files };
}

/** `tokens.json`, and with Tailwind the theme files its token utilities (`bg-color-brand`) need. */
function tokenFiles(tokens: ThemeToken[], styling: string): { path: string; contents: string }[] {
  if (!tokens.length) return [];
  const files = [{ path: 'tokens.json', contents: `${JSON.stringify(tokensToDtcg(tokens), null, 2)}\n` }];
  const theme = styling === 'tailwind' ? tailwindThemeCss(tokens) : '';
  if (theme) files.push({ path: 'tailwind.theme.css', contents: theme }, { path: 'tailwind.tokens.cjs', contents: tailwindPreset(tokens) });
  return files;
}

/* ------------------------------------------------- reusable components */

const VARIANT_DOC = "a variant for every display (\"compact\"), or one per display ({ lg: \"row\", \"mobile-portrait\": \"stacked\" }; \"-\" is the base look), inheriting like styles do";

/** Class-safe names for variants, unique, never `base` (the modifier for no variant). */
function variantSlugs(variants: ComponentVariant[]): Map<ComponentVariant, string> {
  const used = new Set(['base']);
  const out = new Map<ComponentVariant, string>();
  for (const v of variants) {
    const slug = slugify(v.name, 'variant');
    let name = slug;
    for (let i = 2; used.has(name); i++) name = `${slug}-${i}`;
    used.add(name);
    out.set(v, name);
  }
  return out;
}

/** The display a display's styles cascade from directly, or `undefined` for the base. */
const parentDisplay = (d: DisplayDef) => d.inherits[d.inherits.length - 1];

/**
 * The runtime part of breakpoint-aware variants: `variantClasses(variant)` turns the `variant`
 * prop (one variant, or a pick per display that inherits like styles) into one modifier class
 * per display, `root--<display>-<variant>` (`-base` for none), which the variant rules match.
 */
function variantHelper(rootCls: string, tsName?: string): string {
  const table = DISPLAYS.map((d) => `[${JSON.stringify(d.id)}, ${JSON.stringify(parentDisplay(d) ?? '')}]`).join(', ');
  const ts = !!tsName;
  return [
    `// Each display and the display it inherits from, widest first.`,
    `const VARIANT_DISPLAYS${ts ? ': [string, string][]' : ''} = [${table}];`,
    ``,
    `/** One modifier class per display for the variant it shows: its own pick, else the one it inherits. */`,
    `function variantClasses(variant${ts ? `: ${tsName}Props['variant']` : ''})${ts ? ': string' : ''} {`,
    `  if (!variant) return '';`,
    `  const picks${ts ? ': Partial<Record<string, string>>' : ''} = typeof variant === 'string' ? { lg: variant } : variant;`,
    `  const at${ts ? ': Record<string, string>' : ''} = {};`,
    `  return VARIANT_DISPLAYS.map(([display, parent]) => {`,
    `    const pick = picks[display];`,
    `    at[display] = pick == null ? (parent ? at[parent] : '') : pick === '-' ? '' : pick;`,
    `    return \` ${rootCls}--\${display}-\${at[display] || 'base'}\`;`,
    `  }).join('');`,
    `}`,
  ].join('\n');
}

/**
 * CSS for breakpoint-aware variants. For each display and each pair of (variant the display
 * inherits, variant it shows), a rule under the display's media query holds what changes
 * between the two, so a narrower display can switch variants and undo what the wider one set,
 * exactly as `variantStyles` does in the editor. Only properties some variant sets are written;
 * the rest comes from the template's own rules.
 */
function variantRules(def: ComponentDef, variants: ComponentVariant[], slugs: Map<ComponentVariant, string>, rootCls: string, classes: Map<string, string>): DisplayRule[] {
  if (!variants.length) return [];
  const base = new Map<string, DisplayStyles>();
  walk(def.root, (n) => {
    if (isBranch(n)) base.set(n.id, n.styles);
  });
  const ids = [...new Set(variants.flatMap((v) => Object.keys(v.styles)))].filter((id) => classes.has(id) && base.has(id));
  const options: (ComponentVariant | undefined)[] = [undefined, ...variants];
  const mod = (d: string, v: ComponentVariant | undefined) => `${rootCls}--${d}-${v ? slugs.get(v) : 'base'}`;
  const rules: DisplayRule[] = [];
  for (const id of ids) {
    const keys = new Set(variants.flatMap((v) => Object.values(v.styles[id] ?? {}).flatMap((m) => Object.keys(m ?? {}))));
    const full = (d: DisplayDef['id'], v: ComponentVariant | undefined): StyleMap => {
      const over = v?.styles[id];
      const all: StyleMap = { ...resolveStyles(base.get(id)!, d), ...(over ? resolveStyles(over, d) : {}) };
      return Object.fromEntries(Object.entries(all).filter(([k]) => keys.has(k)));
    };
    const target = (mods: string) => (id === def.root.id ? `.${rootCls}${mods}` : `.${rootCls}${mods} .${classes.get(id)}`);
    for (const d of DISPLAYS) {
      const parent = parentDisplay(d);
      for (const shown of options) {
        if (!parent) {
          // The base display only needs what differs from the template's own rules.
          const plain = full(d.id, undefined);
          const own = Object.fromEntries(Object.entries(full(d.id, shown)).filter(([k, v]) => plain[k] !== v));
          if (shown && Object.keys(own).length) rules.push({ selector: target(`.${mod(d.id, shown)}`), styles: { [d.id]: own } });
          continue;
        }
        for (const inherited of options) {
          const from = full(parent, inherited);
          const to = full(d.id, shown);
          const own: StyleMap = {};
          for (const [k, v] of Object.entries(to)) if (from[k] !== v) own[k] = v;
          for (const k of Object.keys(from)) if (!(k in to)) own[k] = 'unset';
          if (Object.keys(own).length) rules.push({ selector: target(`.${mod(parent, inherited)}.${mod(d.id, shown)}`), styles: { [d.id]: own } });
        }
      }
    }
  }
  return rules;
}


/** Words a prop can't be named in a JS, Vue or Svelte component (a variable of that name is a syntax error). */
const RESERVED_WORDS = new Set(
  'key ref variantClasses VARIANT_DISPLAYS globalThis String Number arguments await break case catch class const continue debugger default delete do else enum eval export extends false finally for function if implements import in instanceof interface let new null package private protected public return static super switch this throw true try typeof var void while with yield'.split(' '),
);

/** A prop's default as a JS literal. */
const jsDefault = (p: ComponentProp): string =>
  p.type === 'boolean'
    ? // The editor's rule (see `truthy` in core's components.ts): '', 'false' and '0' are off.
      String(!!p.default && p.default !== 'false' && p.default !== '0')
    : p.default === undefined
      ? 'undefined'
      : // Escaped so a default cannot close the <script> block it sits in (Vue and Svelte).
        JSON.stringify(p.default).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

/**
 * Export a reusable component (see `components.ts` in core) as a React, Vue or Svelte component
 * with its props: `{{title}}` placeholders become expressions, `data-show-if` branches render
 * conditionally, and variants become a `variant` prop: one variant, or a pick per display that
 * inherits like styles, turned into one modifier class per display on the root (see
 * `variantHelper` and `variantRules`), so exports switch variants at breakpoints as the editor does. Tailwind
 * exports keep props but not variants (they would need one class list per variant). HTML and
 * native exports write the component as it looks with its default props.
 */
export function exportComponentDef(def: ComponentDef, opts: ComponentOptions): ComponentExport {
  const framework = opts.framework;
  const styling = opts.styling ?? 'css';
  const name = pascalName(opts.name ?? def.name);
  if (framework === 'html' || framework === 'swiftui' || framework === 'flutter') {
    // No props in these targets: export the component as it looks by default.
    const tree = createTree(def.name, { kind: 'branch', id: 'b_body', tag: 'body', type: 'root', classes: [], attrs: {}, styles: {}, children: [expandComponent(def, { component: def.id }, 'b_c')] });
    return exportComponent(tree, { ...opts, name });
  }
  const props = componentProps(def);
  const reserved = props.filter((p) => RESERVED_WORDS.has(p.name));
  if (reserved.length) throw new Error(`Rename the prop${reserved.length > 1 ? 's' : ''} ${reserved.map((p) => `"${p.name}"`).join(', ')} before exporting "${def.name}": ${reserved.length > 1 ? 'those names are' : 'that name is'} reserved in JavaScript or by the generated code`);
  const variants = styling === 'css' ? def.variants : [];
  const tokens = themeTokens((opts.kits ?? []).filter((k) => k.enabled));
  const prefix = `${cssIdent(slugify(def.name, 'component'))}__`;
  const build: Build = {
    styling,
    classOf: classNamer(prefix),
    rules: [],
    tokenKinds: new Map(tokens.map((t) => [t.name, t.kind])),
    props: true,
    defaults: Object.fromEntries(props.map((p) => [p.name, p.default ?? ''])),
    forceClass: new Set([def.root.id, ...variants.flatMap((v) => Object.keys(v.styles))]),
    classes: new Map(),
  };
  const root = branchEl(repairNesting(def.root), build, false);
  markPre(root);
  // The editor ignores `data-show-if` on a component's root (see expandComponent), and so does the export.
  if (root.kind === 'el') delete root.cond;
  const rootCls = build.classes!.get(def.root.id)!;
  const slugs = variantSlugs(variants);
  if (root.kind === 'el' && variants.length && rootCls) root.variantClass = true;
  build.rules.push(...variantRules(def, variants, slugs, rootCls, build.classes!));
  const options = variants.map((v) => slugs.get(v)!);
  // With variants, `variant` is the generated variant prop; a prop of the same name would be declared twice.
  const allProps = variants.length ? [...props.filter((p) => p.name !== 'variant'), { name: 'variant', type: 'enum' as const, default: '', options }] : props;
  const booleanProps: ReadonlySet<string> = new Set(allProps.filter((p) => p.type === 'boolean').map((p) => p.name));
  const helper = variants.length ? variantHelper(rootCls, opts.typescript && framework === 'react' ? name : undefined) : '';

  const css = styling === 'css' ? renderDisplayCss(build.rules) : '';
  const kitFileList = kitFiles(opts.kits ?? [], styling === 'tailwind');
  const kitCss = kitFileList.length > 0;
  const files: ComponentFile[] = [];
  const header = commentText(`Generated by Tree Weaver from the component "${def.name}".${variants.length ? ` Variants: ${options.join(', ')}.` : ''}`);
  const cssFile = `${name}.css`;
  const docs = allProps.map((p) => `${p.name}${p.name === 'variant' && !p.description ? `: ${VARIANT_DOC}` : p.description ? `: ${p.description}` : ''}`);
  let entry: string;
  switch (framework) {
    case 'react': {
      const ext = opts.typescript ? 'tsx' : 'jsx';
      entry = `${name}.${ext}`;
      const imports = [kitCss ? `import './kits.css';` : '', css ? `import './${cssFile}';` : ''].filter(Boolean).join('\n');
      const tsType = (p: ComponentProp) =>
        p.name === 'variant' && variants.length
          ? `${name}Variant | '' | Partial<Record<${name}Display, ${name}Variant | '-'>>`
          : p.type === 'boolean'
            ? 'boolean'
            : p.type === 'enum' && p.options?.length
              ? [...new Set([...p.options, p.default ?? ''])].map((o) => JSON.stringify(o)).join(' | ') + " | ''"
              : 'string';
      const types =
        opts.typescript && variants.length
          ? `\nexport type ${name}Variant = ${options.map((o) => JSON.stringify(o)).join(' | ')};\nexport type ${name}Display = ${DISPLAYS.map((d) => JSON.stringify(d.id)).join(' | ')};\n`
          : '';
      const iface = opts.typescript ? `${types}\nexport interface ${name}Props {\n${allProps.map((p) => `  ${p.name}?: ${tsType(p)};`).join('\n')}\n}\n` : '';
      const params = allProps.length ? `{ ${allProps.map((p) => `${p.name} = ${jsDefault(p)}`).join(', ')} }${opts.typescript ? `: ${name}Props` : ''}` : '';
      files.push({
        path: entry,
        contents: `// ${header}\n${imports ? `${imports}\n` : ''}${iface}${helper ? `\n${helper}\n` : ''}\nexport default function ${name}(${params}) {\n  return (\n    ${writeJsx(root, 2, booleanProps)}\n  );\n}\n`,
      });
      break;
    }
    case 'vue': {
      entry = `${name}.vue`;
      const vueType = (p: ComponentProp) => (p.name === 'variant' && variants.length ? '[String, Object]' : p.type === 'boolean' ? 'Boolean' : 'String');
      const script = allProps.length
        ? `<script setup>\ndefineProps({\n${allProps.map((p) => `  ${p.name}: { type: ${vueType(p)}, default: ${jsDefault(p)} },`).join('\n')}\n});\n${helper ? `\n${helper}\n` : ''}</script>\n\n`
        : '';
      const style = [kitCss ? `<style src="./kits.css"></style>` : '', css ? `<style>\n${css}\n</style>` : ''].filter(Boolean).join('\n');
      files.push({ path: entry, contents: `<!-- ${header} -->\n${script}<template>\n  ${writeHtml(root, 1, 'vue', booleanProps)}\n</template>\n${style ? `\n${style}\n` : ''}` });
      break;
    }
    case 'svelte': {
      entry = `${name}.svelte`;
      const lines = [kitCss ? `  import './kits.css';` : '', ...allProps.map((p) => `  export let ${p.name} = ${jsDefault(p)};`), helper ? `\n${helper.replace(/^(?=.)/gm, '  ')}` : ''].filter(Boolean);
      const script = lines.length ? `<script>\n${lines.join('\n')}\n</script>\n\n` : '';
      const style = css ? `\n<style>\n  /* Global: the classes are generated, so scoping only gets in the way of overrides. */\n${css.replace(/^(\s*)(\.[^{}\n]*?)\s*\{/gm, '$1:global($2) {')}\n</style>\n` : '';
      files.push({ path: entry, contents: `<!-- ${header} -->\n${script}${writeHtml(root, 0, 'svelte', booleanProps)}\n${style}` });
      break;
    }
    default:
      throw new Error(`Unknown framework "${String(framework)}"`);
  }
  if (docs.length) files[0].contents = files[0].contents.replace(header, () => commentText(`${header} Props: ${docs.join('; ')}.`));
  if (css && framework === 'react') files.push({ path: cssFile, contents: `/* ${header} */\n${css}\n` });
  files.push(...kitFileList);
  files.push(...tokenFiles(tokens, styling));
  return { name, framework, styling, entry, files };
}
