import {
  canonicalTag,
  DISPLAYS,
  escapeAttr,
  escapeHtml,
  isBranch,
  isSafeAttr,
  isSafeCssProp,
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
  return (branch: Branch): string => {
    const base = slugify(branch.name || branch.type || branch.tag, branch.tag);
    const stem = `${prefix}${base}`.replace(/[^a-z0-9_-]/gi, '-').replace(/^-+|-+$/g, '') || `${prefix}node`;
    const n = (used.get(stem) ?? 0) + 1;
    used.set(stem, n);
    return n === 1 ? stem : `${stem}-${n}`;
  };
}

/** A slug that is also a valid CSS class name: it must not start with a digit. */
const cssIdent = (slug: string): string => (/^[a-z_]/i.test(slug) ? slug : `layout-${slug}`.replace(/-+$/, ''));

const hasStyles = (b: Branch): boolean => Object.values(b.styles).some((m) => m && Object.keys(m).length > 0);

/* ------------------------------------------------------------ tailwind */

/** The Tailwind variant prefix for a display, from its media query: `max-[1024px]:`, `max-[600px]:portrait:`. */
export function tailwindVariant(display: DisplayDef): string {
  if (!display.media) return '';
  const parts: string[] = [];
  const min = /min-width:\s*(\d+(?:\.\d+)?)px/.exec(display.media);
  const max = /max-width:\s*(\d+(?:\.\d+)?)px/.exec(display.media);
  if (min) parts.push(`min-[${min[1]}px]`);
  if (max) parts.push(`max-[${max[1]}px]`);
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
  'align-items': { start: 'items-start', 'flex-start': 'items-start', end: 'items-end', 'flex-end': 'items-end', center: 'items-center', baseline: 'items-baseline', stretch: 'items-stretch' },
  'justify-content': {
    start: 'justify-start',
    'flex-start': 'justify-start',
    end: 'justify-end',
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

/** A CSS value inside Tailwind's brackets: spaces become `_`, literal underscores are escaped. */
const bracket = (value: string): string =>
  value
    .trim()
    .replace(/_/g, '\\_')
    .replace(/\s*,\s*/g, ',')
    .replace(/\s+/g, '_');

/**
 * One declaration as a Tailwind class (without the display variant). With the forest's token
 * kinds, a value that is exactly `var(--token)` becomes the theme utility (`bg-brand`).
 */
export function tailwindClass(prop: string, value: string, tokenKinds?: ReadonlyMap<string, TokenKind>): string {
  const v = value.trim();
  const themed = tokenKinds ? tailwindTokenClass(prop, v, tokenKinds) : undefined;
  if (themed) return themed;
  const keyword = KEYWORD_UTILITIES[prop]?.[v];
  if (keyword) return keyword;
  const utility = VALUE_UTILITIES[prop];
  // Single values only: `p-[1rem_2rem]` works too, but the arbitrary property reads plainer.
  if (utility && !/\s/.test(v) && !/[[\]]/.test(v)) return `${utility}-[${bracket(v)}]`;
  return `[${prop}:${bracket(v)}]`;
}

function tailwindClasses(branch: Branch, tokenKinds: ReadonlyMap<string, TokenKind>): string[] {
  const out: string[] = [];
  for (const display of DISPLAYS) {
    const styles: StyleMap | undefined = branch.styles[display.id];
    if (!styles) continue;
    const variant = tailwindVariant(display);
    for (const [prop, raw] of Object.entries(styles)) {
      const value = sanitizeCssValue(raw);
      if (!isSafeCssProp(prop) || !value) continue;
      out.push(`${variant}${tailwindClass(prop, value, tokenKinds)}`);
    }
  }
  return out;
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
    }
  | { kind: 'text'; value: string };

interface Build {
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
 * attribute values as code, so only plain names and the XML namespaces are kept.
 */
const PLAIN_ATTR = /^(?:(?:xlink|xml|xmlns):)?[a-zA-Z_][\w.-]*$/;
const isExportAttr = (name: string, value: string) => PLAIN_ATTR.test(name) && !/^v-/i.test(name) && isSafeAttr(name, value);

function leafEl(leaf: Leaf, inSvg: boolean): El {
  const attrs = Object.entries(leaf.attrs ?? {}).filter(([n, v]) => isExportAttr(n, v));
  if (leaf.type === 'shape') {
    const tag = canonicalTag(leaf.value);
    return { kind: 'el', tag: SVG_SHAPES.has(tag) ? tag : 'g', attrs, children: [], svg: true };
  }
  if (leaf.type === 'image') {
    const src = isSafeAttr('src', leaf.value) ? leaf.value : '';
    if (inSvg) return { kind: 'el', tag: 'image', attrs: [['href', src], ...attrs.filter(([n]) => n !== 'href' && n !== 'alt')], children: [], svg: true };
    const rest = attrs.filter(([n]) => n !== 'src' && n !== 'alt');
    return { kind: 'el', tag: 'img', attrs: [['src', src], ['alt', leaf.attrs?.alt ?? ''], ...rest], children: [], svg: false };
  }
  return { kind: 'text', value: leaf.value };
}

function branchEl(branch: Branch, b: Build, inSvg: boolean, asTag?: string): El {
  const tag = asTag ?? safeTag(branch.tag);
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
    if (name === 'class' || name === 'style' || !isExportAttr(name, value)) continue;
    attrs.push([name, value]);
  }
  if (tag === 'svg' && !inSvg && !branch.attrs.xmlns) attrs.push(['xmlns', 'http://www.w3.org/2000/svg']);
  const children = branch.children.map((c: TreeNode) => (isBranch(c) ? branchEl(c, b, childSvg) : leafEl(c, childSvg)));
  return cond ? { kind: 'el', tag, attrs, children, svg, cond } : { kind: 'el', tag, attrs, children, svg };
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
/** A JS template literal for a value with placeholders: `card-${tone}`. */
const templateLiteral = (value: string, extra = ''): string =>
  `\`${segments(value)
    .map((s) => s.lit.replace(/[`\\]/g, '\\$&').replace(/\$\{/g, '\\${') + (s.prop ? `\${${s.prop}}` : ''))
    .join('')}${extra}\``;
/** A JS expression for a value: the bare prop when the value is just `{{prop}}`. */
const propExpr = (value: string): string => {
  const segs = segments(value);
  return segs.length === 2 && !segs[0].lit && !segs[1].lit ? segs[0].prop! : templateLiteral(value);
};
/** The `variant` prop's modifier classes, added to the root's class list. */
const VARIANT_CALL = 'variantClasses(variant)';
const variantSuffix = `\${${VARIANT_CALL}}`;

/* ------------------------------------------------------------- writers */

const INLINE = new Set(['a', 'abbr', 'b', 'br', 'code', 'em', 'i', 'img', 'kbd', 'mark', 'q', 's', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'tspan']);
const isInlineEl = (el: El): boolean => el.kind === 'text' || INLINE.has(el.tag);
/** Keep children on one line when line breaks could change the text: any text, or only inline elements. */
const oneLine = (children: El[]): boolean => children.some((c) => c.kind === 'text') || children.every(isInlineEl);

/** HTML (also Vue and Svelte templates). */
function writeHtml(el: El, depth: number, mode: 'html' | 'vue' | 'svelte', props = false): string {
  if (el.kind === 'text' && props && mode !== 'html' && hasProps(el.value)) {
    // Vue: {{ title }}; Svelte: {title}. Literal parts are escaped as usual.
    return segments(el.value)
      .map((s) => writeHtml({ kind: 'text', value: s.lit }, depth, mode) + (s.prop ? (mode === 'vue' ? `{{ ${s.prop} }}` : `{${s.prop}}`) : ''))
      .join('');
  }
  if (el.kind === 'el' && props && mode !== 'html') {
    const inner = writePropsEl(el, depth, mode);
    if (el.cond && mode === 'svelte') return `{#if ${el.cond.negate ? '!' : ''}${el.cond.prop}}${inner}{/if}`;
    return inner;
  }
  if (el.kind === 'text') {
    const text = escapeHtml(el.value);
    // `{` starts an expression in Svelte, `{{` in Vue. Every brace is escaped, so neither a run of
    // braces nor two text leaves side by side can form one.
    if (mode !== 'html') return text.replace(/[{}]/g, (c) => (c === '{' ? '&#123;' : '&#125;'));
    return text;
  }
  // Escape for HTML first, then Svelte's braces, so the &#123; entities are not escaped again.
  const esc = (v: string) => (mode === 'svelte' ? escapeAttr(v).replace(/[{}]/g, (c) => (c === '{' ? '&#123;' : '&#125;')) : escapeAttr(v));
  const attrs = el.attrs.map(([n, v]) => (v === '' && !el.svg ? ` ${n}` : ` ${n}="${esc(v)}"`)).join('');
  if (!el.svg && VOID_TAGS.has(el.tag)) return `<${el.tag}${attrs}>`;
  if (!el.children.length) return el.svg ? `<${el.tag}${attrs} />` : `<${el.tag}${attrs}></${el.tag}>`;
  if (oneLine(el.children)) return `<${el.tag}${attrs}>${el.children.map((c) => writeHtml(c, depth + 1, mode)).join('')}</${el.tag}>`;
  const pad = '  '.repeat(depth + 1);
  return `<${el.tag}${attrs}>\n${el.children.map((c) => pad + writeHtml(c, depth + 1, mode)).join('\n')}\n${'  '.repeat(depth)}</${el.tag}>`;
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
  'xlink:href': 'xlinkHref',
  'xml:space': 'xmlSpace',
  'xml:lang': 'xmlLang',
};

/** An attribute name as React expects it. */
export function jsxAttrName(name: string): string {
  const lower = name.toLowerCase();
  if (JSX_ATTRS[lower]) return JSX_ATTRS[lower];
  if (lower.startsWith('data-') || lower.startsWith('aria-')) return lower;
  return name.replace(/[-:]([a-z])/g, (_m, c: string) => c.toUpperCase());
}

/** An element of a Vue or Svelte component template, with prop bindings. */
function writePropsEl(el: El & { kind: 'el' }, depth: number, mode: 'vue' | 'svelte'): string {
  // Escape for HTML first, then Svelte's braces, so the &#123; entities are not escaped again.
  const esc = (v: string) => (mode === 'svelte' ? escapeAttr(v).replace(/[{}]/g, (c) => (c === '{' ? '&#123;' : '&#125;')) : escapeAttr(v));
  const attrs = el.attrs
    .map(([n, v]) => {
      const variant = n === 'class' && el.variantClass;
      if (!hasProps(v) && !variant) return v === '' && !el.svg ? ` ${n}` : ` ${n}="${esc(v)}"`;
      if (mode === 'vue') return ` :${n}="${escapeAttr(variant ? templateLiteral(v, variantSuffix) : propExpr(v))}"`;
      // Svelte: attribute values can hold {expressions} between literal text.
      const body = segments(v)
        .map((s) => esc(s.lit) + (s.prop ? `{${s.prop}}` : ''))
        .join('');
      return ` ${n}="${body}${variant ? `{${VARIANT_CALL}}` : ''}"`;
    })
    .join('');
  const cond = mode === 'vue' && el.cond ? ` v-if="${el.cond.negate ? '!' : ''}${el.cond.prop}"` : '';
  if (!el.svg && VOID_TAGS.has(el.tag)) return `<${el.tag}${cond}${attrs}>`;
  if (!el.children.length) return el.svg ? `<${el.tag}${cond}${attrs} />` : `<${el.tag}${cond}${attrs}></${el.tag}>`;
  if (oneLine(el.children)) return `<${el.tag}${cond}${attrs}>${el.children.map((c) => writeHtml(c, depth + 1, mode, true)).join('')}</${el.tag}>`;
  const pad = '  '.repeat(depth + 1);
  return `<${el.tag}${cond}${attrs}>\n${el.children.map((c) => pad + writeHtml(c, depth + 1, mode, true)).join('\n')}\n${'  '.repeat(depth)}</${el.tag}>`;
}

const jsxString = (value: string): string => JSON.stringify(value);

function writeJsx(el: El, depth: number, props = false): string {
  if (el.kind === 'text') {
    if (props && hasProps(el.value))
      return segments(el.value)
        .map((s) => (s.lit ? writeJsx({ kind: 'text', value: s.lit }, depth) : '') + (s.prop ? `{${s.prop}}` : ''))
        .join('');
    // Plain text is fine unless it holds JSX syntax characters; then use a string expression.
    return /[{}<>]/.test(el.value) || /^\s|\s$/.test(el.value) ? `{${jsxString(el.value)}}` : el.value.replace(/&/g, '&amp;');
  }
  if (props && el.cond) {
    const { cond, ...rest } = el;
    return `{${cond.negate ? '!' : ''}${cond.prop} && (${writeJsx(rest, depth, props)})}`;
  }
  const attrs = el.attrs
    .map(([n, v]) => {
      const name = jsxAttrName(n);
      if (props && n === 'class' && el.variantClass) return ` ${name}={${templateLiteral(v, variantSuffix)}}`;
      if (props && hasProps(v)) return ` ${name}={${propExpr(v)}}`;
      if (v === '' && !el.svg && n !== 'alt' && n !== 'class') return ` ${name}`;
      return /["\\{}<>\n]/.test(v) ? ` ${name}={${jsxString(v)}}` : ` ${name}="${v.replace(/&/g, '&amp;')}"`;
    })
    .join('');
  if (!el.children.length) return `<${el.tag}${attrs} />`;
  if (oneLine(el.children)) return `<${el.tag}${attrs}>${el.children.map((c) => writeJsx(c, depth + 1, props)).join('')}</${el.tag}>`;
  const pad = '  '.repeat(depth + 1);
  return `<${el.tag}${attrs}>\n${el.children.map((c) => pad + writeJsx(c, depth + 1, props)).join('\n')}\n${'  '.repeat(depth)}</${el.tag}>`;
}

/* --------------------------------------------------------------- files */

function kitsCss(kits: DesignKit[]): string {
  const enabled = kits.filter((k) => k.enabled && k.source !== 'env');
  if (!enabled.length) return '';
  const imports = enabled.filter((k) => k.href).map((k) => `@import url("${k.href!.replace(/["\\]/g, '')}");`);
  const inline = enabled.filter((k) => !k.href && k.css.trim()).map((k) => `/* ${commentText(k.name)} */\n${k.css.trim()}`);
  return `/* Design kits from Tree Weaver, in load order. */\n${[...imports, ...inline].join('\n\n')}\n`;
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
  const root = branchEl(tree.root, build, false, rootTag);
  if (root.kind === 'el' && !svgTree && framework !== 'html' && !root.attrs.some(([n]) => n === 'class')) {
    // Name the wrapper so it can be styled from outside.
    root.attrs.unshift(['class', cssIdent(slugify(tree.name, 'layout'))]);
  }

  const css = styling === 'css' ? renderDisplayCss(build.rules) : '';
  const kitCss = kitsCss(opts.kits ?? []);
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
  if (kitCss) files.push({ path: 'kits.css', contents: kitCss });
  if (tokens.length) {
    files.push({ path: 'tokens.json', contents: `${JSON.stringify(tokensToDtcg(tokens), null, 2)}\n` });
    if (styling === 'tailwind') {
      const theme = tailwindThemeCss(tokens);
      if (theme) files.push({ path: 'tailwind.theme.css', contents: theme }, { path: 'tailwind.tokens.cjs', contents: tailwindPreset(tokens) });
    }
  }
  return { name, framework, styling, entry, files };
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
  'arguments await break case catch class const continue debugger default delete do else enum eval export extends false finally for function if implements import in instanceof interface let new null package private protected public return static super switch this throw true try typeof var void while with yield'.split(' '),
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
  if (reserved.length) throw new Error(`Rename the prop${reserved.length > 1 ? 's' : ''} ${reserved.map((p) => `"${p.name}"`).join(', ')} before exporting "${def.name}": ${reserved.length > 1 ? 'they are' : 'it is a'} reserved word${reserved.length > 1 ? 's' : ''} in JavaScript`);
  const variants = styling === 'css' ? def.variants : [];
  const tokens = themeTokens((opts.kits ?? []).filter((k) => k.enabled));
  const prefix = `${cssIdent(slugify(def.name, 'component'))}__`;
  const build: Build = {
    styling,
    classOf: classNamer(prefix),
    rules: [],
    tokenKinds: new Map(tokens.map((t) => [t.name, t.kind])),
    props: true,
    forceClass: new Set([def.root.id, ...variants.flatMap((v) => Object.keys(v.styles))]),
    classes: new Map(),
  };
  const root = branchEl(def.root, build, false);
  // The editor ignores `data-show-if` on a component's root (see expandComponent), and so does the export.
  if (root.kind === 'el') delete root.cond;
  const rootCls = build.classes!.get(def.root.id)!;
  const slugs = variantSlugs(variants);
  if (root.kind === 'el' && variants.length && rootCls) root.variantClass = true;
  build.rules.push(...variantRules(def, variants, slugs, rootCls, build.classes!));
  const options = variants.map((v) => slugs.get(v)!);
  // With variants, `variant` is the generated variant prop; a prop of the same name would be declared twice.
  const allProps = variants.length ? [...props.filter((p) => p.name !== 'variant'), { name: 'variant', type: 'enum' as const, default: '', options }] : props;
  const helper = variants.length ? variantHelper(rootCls, opts.typescript && framework === 'react' ? name : undefined) : '';

  const css = styling === 'css' ? renderDisplayCss(build.rules) : '';
  const kitCss = kitsCss(opts.kits ?? []);
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
              ? p.options.map((o) => JSON.stringify(o)).join(' | ') + " | ''"
              : 'string';
      const types =
        opts.typescript && variants.length
          ? `\nexport type ${name}Variant = ${options.map((o) => JSON.stringify(o)).join(' | ')};\nexport type ${name}Display = ${DISPLAYS.map((d) => JSON.stringify(d.id)).join(' | ')};\n`
          : '';
      const iface = opts.typescript ? `${types}\nexport interface ${name}Props {\n${allProps.map((p) => `  ${p.name}?: ${tsType(p)};`).join('\n')}\n}\n` : '';
      const params = allProps.length ? `{ ${allProps.map((p) => `${p.name} = ${jsDefault(p)}`).join(', ')} }${opts.typescript ? `: ${name}Props` : ''}` : '';
      files.push({
        path: entry,
        contents: `// ${header}\n${imports ? `${imports}\n` : ''}${iface}${helper ? `\n${helper}\n` : ''}\nexport default function ${name}(${params}) {\n  return (\n    ${writeJsx(root, 2, true)}\n  );\n}\n`,
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
      files.push({ path: entry, contents: `<!-- ${header} -->\n${script}<template>\n  ${writeHtml(root, 1, 'vue', true)}\n</template>\n${style ? `\n${style}\n` : ''}` });
      break;
    }
    case 'svelte': {
      entry = `${name}.svelte`;
      const lines = [kitCss ? `  import './kits.css';` : '', ...allProps.map((p) => `  export let ${p.name} = ${jsDefault(p)};`), helper ? `\n${helper.replace(/^(?=.)/gm, '  ')}` : ''].filter(Boolean);
      const script = lines.length ? `<script>\n${lines.join('\n')}\n</script>\n\n` : '';
      const style = css ? `\n<style>\n  /* Global: the classes are generated, so scoping only gets in the way of overrides. */\n${css.replace(/^(\s*)(\.[^{}\n]*?)\s*\{/gm, '$1:global($2) {')}\n</style>\n` : '';
      files.push({ path: entry, contents: `<!-- ${header} -->\n${script}${writeHtml(root, 0, 'svelte', true)}\n${style}` });
      break;
    }
    default:
      throw new Error(`Unknown framework "${String(framework)}"`);
  }
  if (docs.length) files[0].contents = files[0].contents.replace(header, () => commentText(`${header} Props: ${docs.join('; ')}.`));
  if (css && framework === 'react') files.push({ path: cssFile, contents: `/* ${header} */\n${css}\n` });
  if (kitCss) files.push({ path: 'kits.css', contents: kitCss });
  if (tokens.length) files.push({ path: 'tokens.json', contents: `${JSON.stringify(tokensToDtcg(tokens), null, 2)}\n` });
  return { name, framework, styling, entry, files };
}
