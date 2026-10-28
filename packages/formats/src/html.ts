import {
  BRANCH_ATTR,
  CUSTOM_KIT_SOURCE,
  createId,
  DISPLAYS,
  INLINE_TAGS,
  isStylesheetUrl,
  LEAF_ATTR,
  parseCss,
  parseDeclarations,
  renderDocument,
  type CssNode,
  type DesignKit,
  type DisplayId,
  type DisplayStyles,
  type Tree,
} from '@tree-weaver/core';
import type { ChildNode, Element } from 'domhandler';
import { parseDocument } from 'htmlparser2';
import { fromData } from './data';
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

const normalizeMedia = (m: string): string => m.replace(/\s+/g, '').toLowerCase();
const MEDIA_TO_DISPLAY = new Map<string, DisplayId>(
  DISPLAYS.filter((d) => d.media).map((d) => [normalizeMedia(d.media as string), d.id]),
);
const SELECTOR = new RegExp(`^\\[${BRANCH_ATTR}=["']?([^"'\\]]+)["']?\\]$`);

/** Read rules written by `renderTreeCss` back into per-branch display styles. */
function readTreeCss(css: string, into: Map<string, DisplayStyles>): void {
  const visit = (nodes: CssNode[], display: DisplayId) => {
    for (const node of nodes) {
      if (node.type === 'rule') {
        for (const sel of node.selector.split(',')) {
          const m = SELECTOR.exec(sel.trim());
          if (!m) continue;
          const styles = into.get(m[1]) ?? {};
          styles[display] = { ...styles[display], ...node.declarations };
          into.set(m[1], styles);
        }
      } else if (node.name === 'media' && node.children) {
        const target = MEDIA_TO_DISPLAY.get(normalizeMedia(node.prelude));
        if (target) visit(node.children, target);
      }
    }
  };
  visit(parseCss(css), 'lg');
}

export interface Ctx {
  /** Responsive styles per branch id, read from exported CSS or Markdown front matter. */
  styles: Map<string, DisplayStyles>;
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

const inlineish = (n: ChildNode | undefined): boolean => !!n && (n.type === 'text' || (isElement(n) && INLINE_TAGS.has(n.name)));

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

function convertChildren(nodes: ChildNode[], ctx: Ctx, raw: boolean): RawNode[] {
  const kept = nodes.filter((n) => n.type === 'text' || n.type === 'comment' || (isElement(n) && !SKIP_TAGS.has(n.name)));
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
        value = value.replace(/\s+/g, ' ');
        if (i === 0) value = value.trimStart();
        if (i === kept.length - 1) value = value.trimEnd();
        // Whitespace only matters between two pieces of inline content.
        if (value.trim() === '') value = inlineish(kept[i - 1]) && inlineish(kept[i + 1]) ? ' ' : '';
      }
      if (value) items.push({ kind: 'leaf', type: 'text', value });
      return;
    }
    const el = node as Element;
    if (unwrapNext && el.name === 'p') {
      unwrapNext = false;
      items.push(...convertChildren(el.children, ctx, raw));
      return;
    }
    unwrapNext = false;
    const converted = convertElement(el, ctx, raw);
    if (meta) applyMeta(converted, meta, ctx);
    meta = null;
    items.push(converted);
  });
  while (stack.length > 1) close();
  return stack[0].items;
}

function convertElement(el: Element, ctx: Ctx, raw: boolean): RawNode {
  return convertParts(el.name.toLowerCase(), el.attribs, el.children, ctx, raw);
}

export function convertParts(tag: string, a: Record<string, string>, children: ChildNode[], ctx: Ctx, raw: boolean): RawNode {
  if (tag === 'img' && a[BRANCH_ATTR] === undefined) {
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
    children: convertChildren(children, ctx, raw || RAW_TEXT_TAGS.has(tag)),
  };
}

const fileName = (href: string): string => href.split(/[?#]/)[0].split('/').pop() || href;

/**
 * Read any HTML page or fragment into a tree. Elements become branches, text and
 * images become leaves, inline `style` attributes become desktop (base) styles,
 * and `<style>` / `<link rel="stylesheet">` become design kits. Documents exported
 * by Tree Weaver round-trip with their ids, names and responsive styles.
 */
export function importHtml(text: string): TreeDocument {
  const dom = parseDocument(text, { lowerCaseTags: true, lowerCaseAttributeNames: true, decodeEntities: true });
  const styles = new Map<string, DisplayStyles>();
  const kits: (DesignKit | Record<string, unknown>)[] = [];
  const looseCss: string[] = [];
  let title = '';
  let treeId = '';
  let body: Element | undefined;

  for (const el of allElements(dom.children)) {
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
        kits.push(kit);
      } else if (css.trim()) looseCss.push(css.trim());
    } else if (el.name === 'link' && /\bstylesheet\b/i.test(el.attribs.rel ?? '') && el.attribs.href) {
      const href = el.attribs.href.trim();
      // A deployment's own stylesheet (`data-tw-env`) becomes an ordinary kit with a fresh id.
      const id = el.attribs['data-tw-env'] === undefined ? el.attribs['data-tw-kit'] : '';
      const kit: DesignKit = { id: id || createId('k'), name: el.attribs['data-tw-kit-name'] || fileName(href), css: '', enabled: true, source: href };
      // Absolute stylesheets stay linked; relative ones can't load from here, so keep them as an @import.
      if (isStylesheetUrl(href)) kit.href = href;
      else kit.css = `@import url("${href.replace(/"/g, '%22')}");`;
      kits.push(kit);
    }
  }
  if (looseCss.length) kits.push({ id: createId('k'), name: title ? `${title} styles` : 'Imported styles', css: looseCss.join('\n\n'), enabled: true, source: 'html' });

  const ctx: Ctx = { styles };
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
