import {
  keepsWhitespace,
  BRANCH_ATTR,
  canonicalSvgAttr,
  canonicalTag,
  childrenInSvg,
  CUSTOM_KIT_SOURCE,
  TOKENS_KIT_SOURCE,
  createId,
  displayForMedia,
  isShapeTag,
  isStylesheetUrl,
  LEAF_ATTR,
  parseCss,
  parseDeclarations,
  renderDocument,
  type Branch,
  type CssNode,
  type DesignKit,
  type DisplayId,
  type DisplayStyles,
  type Tree,
} from '@tree-weaver/core';
import type { ChildNode, Element } from 'domhandler';
import { parseDocument } from 'htmlparser2';
import { fromData } from './data';
import { isInlineTag } from './inline';
import type { TreeDocument } from './types';

export interface HtmlExportOptions {
  kits?: DesignKit[];
}

/** A standalone HTML page for the tree, with its kits and generated responsive CSS inlined. */
export function exportHtml(tree: Tree, opts: HtmlExportOptions = {}): string {
  return renderDocument(tree, { kits: opts.kits, pretty: true });
}

/* ----------------------------------------------------------------- import */

/** Elements that never become branches. */
const SKIP_TAGS = new Set(['script', 'noscript', 'template', 'style', 'link', 'meta', 'title', 'base', 'head', 'iframe', 'object', 'embed']);
const RAW_TEXT_TAGS = new Set(['pre', 'textarea', 'code']);

const isElement = (n: ChildNode): n is Element => n.type === 'tag' || n.type === 'script' || n.type === 'style';

function* allElements(nodes: ChildNode[]): Generator<Element> {
  for (const n of nodes) {
    if (!isElement(n)) continue;
    yield n;
    yield* allElements(n.children);
  }
}

const textContent = (el: Element): string =>
  el.children.map((c) => (c.type === 'text' ? c.data : isElement(c) ? textContent(c) : '')).join('');

const SELECTOR = new RegExp(`^\\[${BRANCH_ATTR}=(?:"((?:[^"\\\\]|\\\\[\\s\\S])*)"|'((?:[^'\\\\]|\\\\[\\s\\S])*)'|([^\\]"'\\s]+))\\]$`);
/** Undo CSS escapes (a backslash before a character, or a hex code point) in a quoted selector value. */
const cssUnescape = (v: string): string => v.replace(/\\([0-9a-fA-F]{1,6})[ \t\n]?|\\([\s\S])/g, (_, hex: string | undefined, ch: string | undefined) => (hex ? codePoint(Number.parseInt(hex, 16)) : (ch as string)));
const codePoint = (n: number): string => (n > 0 && n <= 0x10ffff && (n < 0xd800 || n > 0xdfff) ? String.fromCodePoint(n) : '\ufffd');
/** A selector list split on its commas, but not on commas inside quoted strings. */
function splitSelectors(list: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote = '';
  for (let i = 0; i < list.length; i++) {
    const ch = list[i];
    if (quote) {
      cur += ch;
      if (ch === '\\') cur += list[++i] ?? '';
      else if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Read rules written by `renderTreeCss` back into per-branch display styles. */
export function readTreeCss(css: string, into: Map<string, DisplayStyles>): void {
  const visit = (nodes: CssNode[], display: DisplayId) => {
    for (const node of nodes) {
      if (node.type === 'rule') {
        for (const sel of splitSelectors(node.selector)) {
          const m = SELECTOR.exec(sel.trim());
          if (!m) continue;
          const id = m[3] ?? cssUnescape(m[1] ?? m[2]);
          const styles = into.get(id) ?? {};
          styles[display] = { ...styles[display], ...node.declarations };
          into.set(id, styles);
        }
      } else if (node.name === 'media' && node.children) {
        const target = displayForMedia(node.prelude);
        if (target) visit(node.children, target);
      }
    }
  };
  visit(parseCss(css), 'lg');
}

export interface Ctx {
  /** Responsive styles per branch id, read from exported CSS or Markdown front matter. */
  styles: Map<string, DisplayStyles>;
  /** Parsed as XML (a standalone .svg), which keeps whitespace the HTML parser drops. */
  xml?: boolean;
}

export type RawNode = Record<string, unknown>;

/**
 * Comment directives let formats without layout syntax (Markdown) describe branches:
 *
 * - `<!-- tw:branch {json} -->` ... `<!-- /tw:branch -->` wraps siblings in a branch.
 * - `<!-- tw:meta {json} -->` adds id, classes, attributes, type or name to the next element.
 * - `<!-- tw:inline -->` unwraps the next paragraph into its parent (loose inline content).
 */
export const DIRECTIVE = /^\s*(\/?)tw:(branch|meta|inline)\b\s*([\s\S]*?)\s*$/;

/** JSON that is safe inside an HTML comment. */
export const directiveJson = (value: unknown): string => JSON.stringify(value).replace(/--/g, '-\\u002d');

function parseDirectiveJson(text: string): RawNode {
  if (!text) return {};
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as RawNode) : {};
  } catch {
    return {};
  }
}

/** Whether a node sits in a line: text, or an element whose display (its imported styles, its inline style, or its tag's default) is inline. */
const inlineish = (n: ChildNode | undefined, ctx: Ctx): boolean => {
  if (!n) return false;
  if (n.type === 'text') return true;
  if (!isElement(n)) return false;
  const id = n.attribs[BRANCH_ATTR];
  const inlineDisplay = n.attribs.style ? parseDeclarations(n.attribs.style).display : undefined;
  const display = inlineDisplay ?? (id ? ctx.styles.get(id)?.lg?.display : undefined);
  if (typeof display === 'string' && display.trim()) return /^inline\b|^inline-/.test(display.trim().toLowerCase());
  return isInlineTag(n.name);
};

/** A browser drops one line break straight after `<pre>`, `<textarea>` or `<listing>`; so does the import. */
function dropLeadingNewline(tag: string, children: RawNode[]): RawNode[] {
  const first = children[0];
  if (!['pre', 'textarea', 'listing'].includes(tag) || first?.kind !== 'leaf' || typeof first.value !== 'string' || !/^\r?\n/.test(first.value)) return children;
  const value = first.value.replace(/^\r?\n/, '');
  return value ? [{ ...first, value }, ...children.slice(1)] : children.slice(1);
}

function applyMeta(node: RawNode, meta: RawNode, ctx: Ctx): void {
  if (node.kind !== 'branch') return;
  for (const key of ['type', 'name'] as const) if (typeof meta[key] === 'string') node[key] = meta[key];
  if (Array.isArray(meta.classes)) node.classes = meta.classes;
  if (meta.attrs && typeof meta.attrs === 'object') node.attrs = { ...(node.attrs as object), ...(meta.attrs as object) };
  if (typeof meta.id === 'string' && meta.id) {
    node.id = meta.id;
    const styles = ctx.styles.get(meta.id);
    if (styles) node.styles = { ...styles, ...(node.styles as object) };
  }
}

function convertChildren(nodes: ChildNode[], ctx: Ctx, raw: boolean, svg = false, inline = false): RawNode[] {
  // An SVG <title> is the drawing's accessible name, so it stays.
  // Plain comments are dropped here, so the text either side of one still sees its neighbours.
  const kept = nodes.filter(
    (n) => n.type === 'text' || (n.type === 'comment' && DIRECTIVE.test(n.data)) || (isElement(n) && (!SKIP_TAGS.has(n.name) || (svg && n.name === 'title'))),
  );
  // Stack of open `tw:branch` directives; the bottom entry collects this level's output.
  const stack: { branch: RawNode | null; items: RawNode[] }[] = [{ branch: null, items: [] }];
  const close = () => {
    const done = stack.pop()!;
    done.branch!.children = done.items;
    stack[stack.length - 1].items.push(done.branch!);
  };
  let meta: RawNode | null = null;
  let unwrapNext = false;

  kept.forEach((node, i) => {
    const items = stack[stack.length - 1].items;
    if (node.type === 'comment') {
      const m = DIRECTIVE.exec(node.data);
      if (!m) return;
      const [, closing, kind, json] = m;
      if (kind === 'branch' && closing) {
        if (stack.length > 1) close();
      } else if (kind === 'branch') {
        const data = parseDirectiveJson(json);
        const branch: RawNode = { kind: 'branch', tag: typeof data.tag === 'string' ? data.tag : 'div', classes: [], attrs: {}, styles: {}, children: [] };
        applyMeta(branch, data, ctx);
        stack.push({ branch, items: [] });
      } else if (kind === 'meta') meta = parseDirectiveJson(json);
      else unwrapNext = true;
      return;
    }
    if (node.type === 'text') {
      let value = node.data;
      if (!raw) {
        // HTML whitespace only: a non-breaking space (and other Unicode spaces) is content.
        value = value.replace(/[ \t\n\f\r]+/g, ' ');
        // A space at the edge of an inline element (`<strong>Note: </strong>`) shows, so only a
        // block's edges are trimmed.
        if (i === 0 && !inline) value = value.replace(/^ /, '');
        if (i === kept.length - 1 && !inline) value = value.replace(/ $/, '');
        // Whitespace only matters between two pieces of inline content.
        // At an inline element's edge the other side is the text around the element.
        const side = (n: ChildNode | undefined) => (n ? inlineish(n, ctx) : inline);
        // In SVG only text content (`<text>`, `<tspan>`: passed as inline) shows a space between its parts.
        if (!/[^ ]/.test(value)) value = (!svg || inline) && side(kept[i - 1]) && side(kept[i + 1]) ? ' ' : '';
      }
      if (value) items.push({ kind: 'leaf', type: 'text', value });
      return;
    }
    const el = node as Element;
    if (unwrapNext && el.name === 'p') {
      unwrapNext = false;
      items.push(...convertChildren(el.children, ctx, raw, svg));
      return;
    }
    unwrapNext = false;
    const converted = convertElement(el, ctx, raw, svg);
    if (meta) applyMeta(converted, meta, ctx);
    meta = null;
    items.push(converted);
  });
  while (stack.length > 1) close();
  return stack[0].items;
}

function convertElement(el: Element, ctx: Ctx, raw: boolean, svg = false): RawNode {
  return convertParts(el.name.toLowerCase(), el.attribs, el.children, ctx, raw, svg);
}

const isHandlerOrStyle = (name: string): boolean => {
  const n = name.toLowerCase();
  return n === 'style' || n.startsWith('on');
};

/** Attributes of an SVG element in their SVG case, with `xlink:href` read as `href`. */
function svgAttrs(a: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(a)) {
    const name = k.toLowerCase() === 'xlink:href' ? 'href' : canonicalSvgAttr(k);
    if (name === 'href' && out.href !== undefined) continue;
    out[name] = v;
  }
  return out;
}

/**
 * A shape or image inside an SVG becomes a leaf. Leaves have no styles, so a shape's
 * inline `style` declarations become presentation attributes (`fill`, `stroke`, ...).
 */
/** SVG presentation attributes: a shape's inline style for these can be written as the attribute. */
const PRESENTATION = new Set(
  'alignment-baseline baseline-shift clip-path clip-rule color color-interpolation color-interpolation-filters color-rendering cursor direction display dominant-baseline fill fill-opacity fill-rule filter flood-color flood-opacity font-family font-size font-size-adjust font-stretch font-style font-variant font-weight image-rendering letter-spacing lighting-color marker-end marker-mid marker-start mask opacity overflow paint-order pointer-events shape-rendering stop-color stop-opacity stroke stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin stroke-miterlimit stroke-opacity stroke-width text-anchor text-decoration text-rendering transform unicode-bidi vector-effect visibility word-spacing writing-mode'.split(' '),
);
/** Whether a declaration reads the same as an attribute (a `transform` with CSS units doesn't). */
const asAttribute = (prop: string, value: string): boolean =>
  PRESENTATION.has(prop) && !/!\s*important/i.test(value) && !/\bvar\(/i.test(value) && (prop !== 'transform' || !/\d(deg|rad|grad|turn|px|em|rem|%)|\b(translate|scale|rotate|skew)[XYZ3]|\b(matrix3d|perspective)\(/i.test(value));

function svgLeaf(tag: string, a: Record<string, string>): RawNode | null {
  if (!isShapeTag(tag) && tag !== 'image') return null;
  const attrs: Record<string, string> = {};
  for (const [k, v] of Object.entries(a)) if (!isHandlerOrStyle(k) && k !== LEAF_ATTR && !k.startsWith(`${BRANCH_ATTR}`)) attrs[k] = v;
  // Inline style beats presentation attributes, as in the browser. What an attribute can't say
  // (CSS-only properties, a transform in CSS units) goes on a <g> around the shape.
  const outer: Record<string, string> = {};
  if (a.style) for (const [prop, value] of Object.entries(parseDeclarations(a.style))) {
    if (asAttribute(prop, value)) attrs[prop] = value;
    else outer[prop] = value;
  }
  // A CSS transform replaces the attribute's, rather than adding to it.
  if (outer.transform !== undefined) delete attrs.transform;
  const id = a[LEAF_ATTR] ?? a[BRANCH_ATTR];
  let leaf: RawNode;
  if (tag === 'image') {
    const { href = '', ...rest } = attrs;
    leaf = { kind: 'leaf', id, type: 'image', value: href, attrs: rest };
  } else leaf = { kind: 'leaf', id, type: 'shape', value: tag, attrs };
  if (!Object.keys(outer).length) return leaf;
  return { kind: 'branch', id: createId('b'), tag: 'g', classes: '', attrs: {}, styles: { lg: outer }, children: [leaf] };
}

export function convertParts(tag: string, attribs: Record<string, string>, children: ChildNode[], ctx: Ctx, raw: boolean, svg = false): RawNode {
  // Inside an SVG, names keep their SVG case (`linearGradient`, `viewBox`), which HTML parsers lowercase.
  const inSvg = svg || tag === 'svg';
  if (inSvg) tag = canonicalTag(tag);
  const a = inSvg ? svgAttrs(attribs) : attribs;
  if (svg) {
    const leaf = svgLeaf(tag, a);
    if (leaf) return leaf;
  }
  // An <img> with inline styles becomes an img branch, which keeps them (an image leaf has no styles).
  if (tag === 'img' && a[BRANCH_ATTR] === undefined && !Object.keys(a.style ? parseDeclarations(a.style) : {}).length) {
    const attrs: Record<string, string> = {};
    for (const [k, v] of Object.entries(a)) if (k !== 'src' && k !== LEAF_ATTR && k !== 'style' && !k.startsWith('on')) attrs[k] = v;
    return { kind: 'leaf', id: a[LEAF_ATTR], type: 'image', value: a.src ?? '', attrs };
  }
  if (a[LEAF_ATTR] !== undefined) {
    const value = children.map((c) => (c.type === 'text' ? c.data : isElement(c) ? textContent(c) : '')).join('');
    return { kind: 'leaf', id: a[LEAF_ATTR], type: 'text', value };
  }

  const id = a[BRANCH_ATTR] || createId('b');
  const styles: DisplayStyles = { ...ctx.styles.get(id) };
  if (a.style) styles.lg = { ...styles.lg, ...parseDeclarations(a.style) };
  const attrs: Record<string, string> = {};
  for (const [k, v] of Object.entries(a)) {
    const n = k.toLowerCase();
    if (n === 'class' || n === 'style' || n.startsWith('on') || n === BRANCH_ATTR || n.startsWith(`${BRANCH_ATTR}-`)) continue;
    attrs[k] = v;
  }
  return {
    kind: 'branch',
    id,
    tag,
    type: a[`${BRANCH_ATTR}-type`],
    name: a[`${BRANCH_ATTR}-name`],
    classes: a.class ?? '',
    attrs,
    styles,
    // An XML parse (a standalone .svg) keeps the newline after `<pre>`; only the HTML parser drops it.
    children: (ctx.xml ? (_: string, c: RawNode[]) => c : dropLeadingNewline)(tag, impliedTbody(tag, convertChildren(children, ctx, raw || RAW_TEXT_TAGS.has(tag) || keepsWhitespace({ tag, styles } as Branch) || (inSvg && a['xml:space'] === 'preserve'), childrenInSvg({ tag }, svg), childrenInSvg({ tag }, svg) ? /^(text|tspan|textPath)$/.test(tag) : !svg && isInlineTag(tag)))),
  };
}

/** Rows straight under a `<table>` go in a `<tbody>`, as browsers parse them (and frameworks require). */
function impliedTbody(tag: string, children: RawNode[]): RawNode[] {
  if (tag !== 'table' || !children.some((c) => c.kind === 'branch' && c.tag === 'tr')) return children;
  const out: RawNode[] = [];
  let body: RawNode | null = null;
  for (const c of children) {
    if (c.kind === 'branch' && c.tag === 'tr') {
      if (!body) {
        body = { kind: 'branch', id: createId('b'), tag: 'tbody', classes: '', attrs: {}, styles: {}, children: [] };
        out.push(body);
      }
      (body.children as RawNode[]).push(c);
    } else if (c.kind === 'leaf' && typeof c.value === 'string' && !c.value.trim()) {
      if (!body) out.push(c);
    } else {
      body = null;
      out.push(c);
    }
  }
  return out;
}

/** The `<svg>` root of an exported SVG tree, when it is all the body holds. */
function soleSvgRoot(body: Element): Element | undefined {
  const elements = body.children.filter(isElement);
  const only = elements.length === 1 ? elements[0] : undefined;
  const hasText = body.children.some((c) => c.type === 'text' && c.data.trim());
  return only && only.name === 'svg' && only.attribs[`${BRANCH_ATTR}-type`] === 'root' && !hasText ? only : undefined;
}

const fileName = (href: string): string => href.split(/[?#]/)[0].split('/').pop() || href;

/**
 * Read any HTML page or fragment into a tree. Elements become branches, text and
 * images become leaves, inline `style` attributes become desktop (base) styles,
 * and `<style>` / `<link rel="stylesheet">` become design kits. Documents exported
 * by Tree Weaver round-trip with their ids, names and responsive styles.
 */
/** A `media` attribute as a condition, or '' when it always applies. Braces are dropped so it can't end a block. */
export const mediaOf = (media: string | undefined): string => {
  const m = (media ?? '').replace(/[{};]/g, '').trim();
  return !m || /^(all|screen)$/i.test(m) ? '' : m;
};

/** A <style>'s CSS under its `media` attribute. */
export const withMedia = (css: string, media: string | undefined): string => {
  const m = mediaOf(media);
  return m ? `@media ${m} {\n${css}\n}` : css;
};

/** Whether an element sits in a <noscript> or <template>, whose content doesn't apply. */
function insideInert(el: Element): boolean {
  for (let p = el.parent; p; p = p.parent) if (isElement(p as ChildNode) && /^(noscript|template)$/.test((p as Element).name)) return true;
  return false;
}

export function importHtml(text: string): TreeDocument {
  const dom = parseDocument(text, { lowerCaseTags: true, lowerCaseAttributeNames: true, decodeEntities: true });
  const styles = new Map<string, DisplayStyles>();
  const kits: (DesignKit | Record<string, unknown>)[] = [];
  let looseCss: string[] = [];
  let title = '';
  // Loose <style> blocks become one kit per run, in document order: a <link> between them, or an
  // @import (which must come first in its sheet), starts a new one.
  const flushCss = () => {
    if (looseCss.length) kits.push({ id: createId('k'), name: 'Imported styles', css: looseCss.join('\n\n'), enabled: true, source: 'html' });
    looseCss = [];
  };
  let treeId = '';
  let body: Element | undefined;

  for (const el of allElements(dom.children)) {
    // Styles in <noscript> or <template> don't apply, nor do alternate stylesheets.
    if ((el.name === 'style' || el.name === 'link') && insideInert(el)) continue;
    if (el.name === 'title' && !title) title = textContent(el).trim();
    else if (el.name === 'meta' && el.attribs.name === 'tw-tree') treeId = el.attribs.content ?? '';
    else if (el.name === 'body' && !body) body = el;
    else if (el.name === 'style') {
      const css = textContent(el);
      if (el.attribs['data-tw-styles'] !== undefined) readTreeCss(css, styles);
      else if (el.attribs['data-tw-base'] !== undefined) continue;
      else if (el.attribs['data-tw-kit'] !== undefined) {
        const kit: Record<string, unknown> = { id: el.attribs['data-tw-kit'] || createId('k'), name: el.attribs['data-tw-kit-name'] || 'Design kit', css: css.trim(), enabled: true };
        // Custom classes and selectors come back as an editable kit.
        if (el.attribs['data-tw-kit-editable'] !== undefined) Object.assign(kit, { editable: true, source: CUSTOM_KIT_SOURCE });
        if (el.attribs['data-tw-kit-tokens'] !== undefined) kit.source = TOKENS_KIT_SOURCE;
        kits.push(kit);
      } else if (css.trim()) {
        if (/@import\b/i.test(css) && looseCss.length) flushCss();
        looseCss.push(withMedia(css.trim(), el.attribs.media));
      }
    } else if (el.name === 'link' && /\bstylesheet\b/i.test(el.attribs.rel ?? '') && !/\balternate\b/i.test(el.attribs.rel ?? '') && el.attribs.href) {
      flushCss();
      const href = el.attribs.href.trim();
      // A deployment's own stylesheet (`data-tw-env`) becomes an ordinary kit with a fresh id.
      const id = el.attribs['data-tw-env'] === undefined ? el.attribs['data-tw-kit'] : '';
      const kit: DesignKit = { id: id || createId('k'), name: el.attribs['data-tw-kit-name'] || fileName(href), css: '', enabled: true, source: href };
      // Absolute stylesheets stay linked; relative ones can't load from here, so keep them as an @import.
      // A media condition (print) only an @import can carry.
      const media = mediaOf(el.attribs.media);
      if (isStylesheetUrl(href) && !media) kit.href = href;
      else kit.css = `@import url("${href.replace(/"/g, '%22')}")${media ? ` ${media}` : ''};`;
      kits.push(kit);
    }
  }
  flushCss();
  // Named after the page once the title is known.
  for (const k of kits) if (title && (k as { source?: string; name?: string }).source === 'html' && (k as { name?: string }).name === 'Imported styles') (k as { name: string }).name = `${title} styles`;

  const ctx: Ctx = { styles };
  // An exported SVG tree: the body holds just the drawing, which is the tree's root.
  const drawing = body && body.attribs[BRANCH_ATTR] === undefined ? soleSvgRoot(body) : undefined;
  if (drawing) {
    const root = convertParts('svg', drawing.attribs, drawing.children, ctx, false);
    return fromData({ tree: { id: treeId || undefined, name: title || 'Imported drawing', root }, kits }, 'html');
  }
  let rootNodes: ChildNode[];
  let rootAttrs: Record<string, string> = {};
  if (body) {
    rootNodes = body.children;
    rootAttrs = body.attribs;
  } else {
    const html = dom.children.find((n): n is Element => isElement(n) && n.name === 'html');
    rootNodes = html ? html.children : dom.children;
  }
  const root = convertParts('body', rootAttrs, rootNodes, ctx, false);
  root.type ??= 'root';
  root.name ??= 'Body';

  return fromData({ tree: { id: treeId || undefined, name: title || 'Imported page', root }, kits }, 'html');
}
