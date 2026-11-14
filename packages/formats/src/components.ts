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
} from '@tree-weaver/core';
import { slugify } from './slug';

const SVG_SHAPES = new Set(SVG_SHAPE_TAGS);

/**
 * Framework exports: a tree as source code for a codebase, not a standalone page.
 *
 * - `react`: a function component (`.jsx`, or `.tsx` with `typescript`);
 * - `vue`: a single-file component (`.vue`);
 * - `svelte`: a component (`.svelte`);
 * - `html`: an `index.html` with its stylesheets as separate files.
 *
 * Styles come out either as a CSS file with readable class names (`styling: 'css'`, the
 * default) or as Tailwind utility classes (`styling: 'tailwind'`), with displays mapped to
 * responsive variants. Design kits are written to `kits.css` in both cases. Nothing from
 * the editor (`data-tw` attributes, ids) is left in the output.
 */

export type ComponentFramework = 'react' | 'vue' | 'svelte' | 'html';
export type ComponentStyling = 'css' | 'tailwind';

export const COMPONENT_FRAMEWORKS: readonly { id: ComponentFramework; label: string }[] = [
  { id: 'react', label: 'React (JSX)' },
  { id: 'vue', label: 'Vue (single-file component)' },
  { id: 'svelte', label: 'Svelte' },
  { id: 'html', label: 'HTML + CSS files' },
];

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
  styling: ComponentStyling;
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

/** One declaration as a Tailwind class (without the display variant). */
export function tailwindClass(prop: string, value: string): string {
  const v = value.trim();
  const keyword = KEYWORD_UTILITIES[prop]?.[v];
  if (keyword) return keyword;
  const utility = VALUE_UTILITIES[prop];
  // Single values only: `p-[1rem_2rem]` works too, but the arbitrary property reads plainer.
  if (utility && !/\s/.test(v) && !/[[\]]/.test(v)) return `${utility}-[${bracket(v)}]`;
  return `[${prop}:${bracket(v)}]`;
}

function tailwindClasses(branch: Branch): string[] {
  const out: string[] = [];
  for (const display of DISPLAYS) {
    const styles: StyleMap | undefined = branch.styles[display.id];
    if (!styles) continue;
    const variant = tailwindVariant(display);
    for (const [prop, raw] of Object.entries(styles)) {
      const value = sanitizeCssValue(raw);
      if (!isSafeCssProp(prop) || !value) continue;
      out.push(`${variant}${tailwindClass(prop, value)}`);
    }
  }
  return out;
}

/* ------------------------------------------------------- element model */

/** A rendered element, before it is written as HTML, JSX or a template. */
type El =
  | { kind: 'el'; tag: string; attrs: [string, string][]; children: El[]; svg: boolean }
  | { kind: 'text'; value: string };

interface Build {
  styling: ComponentStyling;
  classOf: (b: Branch) => string;
  rules: DisplayRule[];
}

function leafEl(leaf: Leaf, inSvg: boolean): El {
  const attrs = Object.entries(leaf.attrs ?? {}).filter(([n, v]) => isSafeAttr(n, v));
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
  if (hasStyles(branch)) {
    if (b.styling === 'tailwind') classes.push(...tailwindClasses(branch));
    else {
      const cls = b.classOf(branch);
      classes.push(cls);
      b.rules.push({ selector: `.${cls}`, styles: branch.styles });
    }
  }
  const attrs: [string, string][] = [];
  if (classes.length) attrs.push(['class', classes.join(' ')]);
  for (const [name, value] of Object.entries(branch.attrs)) {
    if (name === 'class' || name === 'style' || !isSafeAttr(name, value)) continue;
    attrs.push([name, value]);
  }
  if (tag === 'svg' && !inSvg && !branch.attrs.xmlns) attrs.push(['xmlns', 'http://www.w3.org/2000/svg']);
  const children = branch.children.map((c: TreeNode) => (isBranch(c) ? branchEl(c, b, childSvg) : leafEl(c, childSvg)));
  return { kind: 'el', tag, attrs, children, svg };
}

/* ------------------------------------------------------------- writers */

const INLINE = new Set(['a', 'abbr', 'b', 'br', 'code', 'em', 'i', 'img', 'kbd', 'mark', 'q', 's', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'tspan']);
const isInlineEl = (el: El): boolean => el.kind === 'text' || INLINE.has(el.tag);
/** Keep children on one line when line breaks could change the text: any text, or only inline elements. */
const oneLine = (children: El[]): boolean => children.some((c) => c.kind === 'text') || children.every(isInlineEl);

/** HTML (also Vue and Svelte templates). */
function writeHtml(el: El, depth: number, mode: 'html' | 'vue' | 'svelte'): string {
  if (el.kind === 'text') {
    const text = escapeHtml(el.value);
    // `{` starts an expression in Svelte, `{{` in Vue.
    if (mode === 'svelte') return text.replace(/[{}]/g, (c) => (c === '{' ? '&#123;' : '&#125;'));
    if (mode === 'vue') return text.replace(/\{\{/g, '{<!-- -->{');
    return text;
  }
  const attrs = el.attrs.map(([n, v]) => (v === '' && !el.svg ? ` ${n}` : ` ${n}="${escapeAttr(mode === 'svelte' ? v.replace(/[{}]/g, (c) => (c === '{' ? '&#123;' : '&#125;')) : v)}"`)).join('');
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

const jsxString = (value: string): string => JSON.stringify(value);

function writeJsx(el: El, depth: number): string {
  if (el.kind === 'text') {
    // Plain text is fine unless it holds JSX syntax characters; then use a string expression.
    return /[{}<>]/.test(el.value) || /^\s|\s$/.test(el.value) ? `{${jsxString(el.value)}}` : el.value.replace(/&/g, '&amp;');
  }
  const attrs = el.attrs
    .map(([n, v]) => {
      const name = jsxAttrName(n);
      if (v === '' && !el.svg && n !== 'alt' && n !== 'class') return ` ${name}`;
      return /["\\{}<>\n]/.test(v) ? ` ${name}={${jsxString(v)}}` : ` ${name}="${v.replace(/&/g, '&amp;')}"`;
    })
    .join('');
  if (!el.children.length) return `<${el.tag}${attrs} />`;
  if (oneLine(el.children)) return `<${el.tag}${attrs}>${el.children.map((c) => writeJsx(c, depth + 1)).join('')}</${el.tag}>`;
  const pad = '  '.repeat(depth + 1);
  return `<${el.tag}${attrs}>\n${el.children.map((c) => pad + writeJsx(c, depth + 1)).join('\n')}\n${'  '.repeat(depth)}</${el.tag}>`;
}

/* --------------------------------------------------------------- files */

function kitsCss(kits: DesignKit[]): string {
  const enabled = kits.filter((k) => k.enabled && k.source !== 'env');
  if (!enabled.length) return '';
  const imports = enabled.filter((k) => k.href).map((k) => `@import url("${k.href!.replace(/["\\]/g, '')}");`);
  const inline = enabled.filter((k) => !k.href && k.css.trim()).map((k) => `/* ${k.name.replace(/\*\//g, '')} */\n${k.css.trim()}`);
  return `/* Design kits from Tree Weaver, in load order. */\n${[...imports, ...inline].join('\n\n')}\n`;
}

/** Export a tree as a component (or a plain HTML page) with its styles. */
export function exportComponent(tree: Tree, opts: ComponentOptions): ComponentExport {
  const framework = opts.framework;
  const styling = opts.styling ?? 'css';
  const name = pascalName(opts.name ?? tree.name);
  // Generated classes are namespaced (`home__hero`) so they never meet a design kit's own classes.
  const build: Build = { styling, classOf: classNamer(`${cssIdent(slugify(tree.name, 'layout'))}__`), rules: [] };
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
  const header = (comment: (s: string) => string) => comment(`Generated by Tree Weaver from the tree "${tree.name.replace(/\*\/|-->/g, '')}".`);
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
  return { name, framework, styling, entry, files };
}
