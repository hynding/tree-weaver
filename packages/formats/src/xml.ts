import type { DesignKit, Forest, Tree, TreeNode } from '@tree-weaver/core';
import { DISPLAY_IDS } from '@tree-weaver/core';
import type { Element } from 'domhandler';
import { parseDocument } from 'htmlparser2';
import { fromData } from './data';
import { DOCUMENT_VERSION, FormatError, type TreeDocument } from './types';

/*
 * XML layout:
 *
 * <tree-weaver version="1">
 *   <forest id name created-at updated-at>
 *     <kits><kit id name enabled source>css</kit></kits>
 *     <tree id name created-at updated-at>
 *       <branch id tag type name class="a b">
 *         <attr name="href" value="/"/>
 *         <style display="lg"><declaration property="display" value="grid"/></style>
 *         <leaf id type="text">Hello</leaf>
 *         <leaf id type="image" value="cat.png"><attr name="alt" value="A cat"/></leaf>
 *       </branch>
 *     </tree>
 *   </forest>
 * </tree-weaver>
 *
 * A single tree export puts <tree> and an optional <kits> directly under <tree-weaver>.
 */

export const XML_NAMESPACE = 'https://github.com/hynding/tree-weaver/schema/1';

const esc = (v: string): string =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\r?\n/g, '&#10;');
const escText = (v: string): string => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function attrs(pairs: Record<string, string | undefined | boolean>): string {
  return Object.entries(pairs)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => ` ${k}="${esc(String(v))}"`)
    .join('');
}

function nodeXml(node: TreeNode, pad: string): string[] {
  if (node.kind === 'leaf') {
    const head = `<leaf${attrs({ id: node.id, type: node.type, value: node.type === 'image' ? node.value : undefined })}`;
    const extra = Object.entries(node.attrs ?? {}).map(([n, v]) => `<attr${attrs({ name: n })} value="${esc(v)}"/>`);
    if (node.type === 'text') return [`${pad}${head}>${escText(node.value)}</leaf>`];
    return extra.length ? [`${pad}${head}>${extra.join('')}</leaf>`] : [`${pad}${head}/>`];
  }
  const inner = `${pad}  `;
  const lines: string[] = [];
  for (const [name, value] of Object.entries(node.attrs)) lines.push(`${inner}<attr${attrs({ name })} value="${esc(value)}"/>`);
  for (const display of DISPLAY_IDS) {
    const styles = node.styles[display];
    if (!styles) continue;
    lines.push(`${inner}<style display="${display}">`);
    for (const [property, value] of Object.entries(styles)) {
      lines.push(`${inner}  <declaration${attrs({ property })} value="${esc(value)}"/>`);
    }
    lines.push(`${inner}</style>`);
  }
  for (const child of node.children) lines.push(...nodeXml(child, inner));
  const head = `${pad}<branch${attrs({ id: node.id, tag: node.tag, type: node.type, name: node.name, class: node.classes.join(' ') })}`;
  return lines.length ? [`${head}>`, ...lines, `${pad}</branch>`] : [`${head}/>`];
}

function treeXml(tree: Tree, pad: string): string[] {
  return [
    `${pad}<tree${attrs({ id: tree.id, name: tree.name, 'created-at': tree.createdAt, 'updated-at': tree.updatedAt })}>`,
    ...nodeXml(tree.root, `${pad}  `),
    `${pad}</tree>`,
  ];
}

function kitsXml(kits: DesignKit[], pad: string): string[] {
  if (!kits.length) return [];
  return [
    `${pad}<kits>`,
    ...kits.map((k) => `${pad}  <kit${attrs({ id: k.id, name: k.name, enabled: String(k.enabled), source: k.source })}>${escText(k.css)}</kit>`),
    `${pad}</kits>`,
  ];
}

export function exportXml(doc: TreeDocument): string {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', `<tree-weaver xmlns="${XML_NAMESPACE}" version="${DOCUMENT_VERSION}">`];
  if (doc.kind === 'forest') {
    const f: Forest = doc.forest;
    lines.push(`  <forest${attrs({ id: f.id, name: f.name, 'created-at': f.createdAt, 'updated-at': f.updatedAt })}>`);
    lines.push(...kitsXml(f.kits, '    '));
    for (const tree of f.trees) lines.push(...treeXml(tree, '    '));
    lines.push('  </forest>');
  } else {
    lines.push(...kitsXml(doc.kits, '  '), ...treeXml(doc.tree, '  '));
  }
  lines.push('</tree-weaver>', '');
  return lines.join('\n');
}

/* ----------------------------------------------------------------- import */

const elements = (el: Element, name?: string): Element[] =>
  el.children.filter((c): c is Element => c.type === 'tag' && (name === undefined || localName(c) === name));

const localName = (el: Element): string => el.name.replace(/^.*:/, '');

const textOf = (el: Element): string =>
  el.children.map((c) => ('data' in c ? (c.data as string) : c.type === 'tag' ? textOf(c as Element) : '')).join('');

function readNode(el: Element): Record<string, unknown> {
  const a = el.attribs;
  if (localName(el) === 'leaf') {
    const leafAttrs = Object.fromEntries(elements(el, 'attr').map((x) => [x.attribs.name, x.attribs.value ?? '']));
    return { kind: 'leaf', id: a.id, type: a.type, value: a.type === 'image' ? a.value : (a.value ?? textOf(el)), attrs: leafAttrs };
  }
  const styles: Record<string, Record<string, string>> = {};
  for (const style of elements(el, 'style')) {
    const map = (styles[style.attribs.display] ??= {});
    for (const decl of elements(style, 'declaration')) map[decl.attribs.property] = decl.attribs.value ?? '';
  }
  return {
    kind: 'branch',
    id: a.id,
    tag: a.tag,
    type: a.type,
    name: a.name,
    classes: a.class ?? '',
    attrs: Object.fromEntries(elements(el, 'attr').map((x) => [x.attribs.name, x.attribs.value ?? ''])),
    styles,
    children: el.children
      .filter((c): c is Element => c.type === 'tag' && (localName(c) === 'branch' || localName(c) === 'leaf'))
      .map(readNode),
  };
}

function readTree(el: Element): Record<string, unknown> {
  const root = elements(el, 'branch')[0];
  return { id: el.attribs.id, name: el.attribs.name, createdAt: el.attribs['created-at'], updatedAt: el.attribs['updated-at'], root: root && readNode(root) };
}

function readKits(el: Element | undefined): Record<string, unknown>[] {
  if (!el) return [];
  return elements(el, 'kit').map((k) => ({ ...k.attribs, css: textOf(k) }));
}

export function importXml(text: string): TreeDocument {
  const dom = parseDocument(text, { xmlMode: true, decodeEntities: true });
  const top = dom.children.find((c): c is Element => c.type === 'tag');
  if (!top) throw new FormatError('The XML has no root element', 'xml');
  const name = localName(top);
  if (name !== 'tree-weaver' && name !== 'forest' && name !== 'tree') {
    throw new FormatError(`Expected <tree-weaver>, <forest> or <tree>, found <${top.name}>`, 'xml');
  }
  const version = Number(top.attribs.version ?? DOCUMENT_VERSION);
  const holder = name === 'tree-weaver' ? top : null;
  const forestEl = name === 'forest' ? top : holder && elements(holder, 'forest')[0];
  if (forestEl) {
    const a = forestEl.attribs;
    const forest = {
      id: a.id,
      name: a.name,
      createdAt: a['created-at'],
      updatedAt: a['updated-at'],
      kits: readKits(elements(forestEl, 'kits')[0]),
      trees: elements(forestEl, 'tree').map(readTree),
    };
    return fromData({ version, forest }, 'xml');
  }
  const treeEl = name === 'tree' ? top : holder && elements(holder, 'tree')[0];
  if (!treeEl) throw new FormatError('The XML has no <forest> or <tree>', 'xml');
  return fromData({ version, tree: readTree(treeEl), kits: holder ? readKits(elements(holder, 'kits')[0]) : [] }, 'xml');
}

