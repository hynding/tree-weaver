import type { DesignKit, Forest, Tree, TreeNode } from '@tree-weaver/core';
import { CONTROL_CHARS, DISPLAY_IDS } from '@tree-weaver/core';
import type { Element } from 'domhandler';
import { parseDocument } from 'htmlparser2';
import { fromData } from './data';
import { DOCUMENT_VERSION, FormatError, type TreeDocument } from './types';

/*
 * XML layout:
 *
 * <tree-weaver version="1">
 *   <forest id name created-at updated-at>
 *     <kits><kit id name enabled source href editable>css</kit></kits>
 *     <tree id name created-at updated-at>
 *       <branch id tag type name class="a b">
 *         <attr name="href" value="/"/>
 *         <style display="lg"><declaration property="display" value="grid"/></style>
 *         <leaf id type="text">Hello</leaf>
 *         <leaf id type="image" value="cat.png"><attr name="alt" value="A cat"/></leaf>
 *         <leaf id type="shape" value="circle"><attr name="r" value="40"/></leaf>
 *       </branch>
 *       <branch id tag><instance>{"component":"c1","props":{}}</instance>…</branch>
 *     </tree>
 *     <components>[ComponentDef JSON]</components>
 *   </forest>
 * </tree-weaver>
 *
 * A single tree export puts <tree> and an optional <kits> directly under <tree-weaver>.
 */

export const XML_NAMESPACE = 'https://github.com/hynding/tree-weaver/schema/1';

const esc = (v: string): string =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\n/g, '&#10;').replace(/\r/g, '&#13;').replace(/\t/g, '&#9;');
// XML parsers turn a raw \r (or \r\n) into \n, so carriage returns are written as references.
const escText = (v: string): string => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#13;');

function attrs(pairs: Record<string, string | undefined | boolean>): string {
  return Object.entries(pairs)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => ` ${k}="${esc(String(v))}"`)
    .join('');
}

function nodeXml(node: TreeNode, pad: string): string[] {
  if (node.kind === 'leaf') {
    const head = `<leaf${attrs({ id: node.id, type: node.type, value: node.type === 'text' ? undefined : node.value })}`;
    const extra = Object.entries(node.attrs ?? {}).map(([n, v]) => `<attr name="${esc(n)}" value="${esc(v)}"/>`);
    if (node.type === 'text') return [`${pad}${head}>${extra.join('')}${escText(node.value)}</leaf>`];
    return extra.length ? [`${pad}${head}>${extra.join('')}</leaf>`] : [`${pad}${head}/>`];
  }
  const inner = `${pad}  `;
  const lines: string[] = [];
  // A linked component instance: its link, as JSON (the expanded children follow as usual).
  if (node.instance) lines.push(`${inner}<instance>${escText(JSON.stringify(node.instance))}</instance>`);
  for (const [name, value] of Object.entries(node.attrs)) lines.push(`${inner}<attr name="${esc(name)}" value="${esc(value)}"/>`);
  for (const display of DISPLAY_IDS) {
    const styles = node.styles[display];
    if (!styles) continue;
    lines.push(`${inner}<style display="${display}">`);
    for (const [property, value] of Object.entries(styles)) {
      lines.push(`${inner}  <declaration property="${esc(property)}" value="${esc(value)}"/>`);
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
    // Rules and tokens go as JSON, so ids, kinds and descriptions survive (CSS alone would rebuild them without).
    ...kits.map(
      (k) =>
        `${pad}  <kit${attrs({ id: k.id, name: k.name, enabled: String(k.enabled), source: k.source, href: k.href, editable: k.rules ? 'true' : undefined })}>${k.rules ? `<rules>${escText(JSON.stringify(k.rules))}</rules>` : ''}${k.tokens ? `<tokens>${escText(JSON.stringify(k.tokens))}</tokens>` : ''}${escText(k.css)}</kit>`,
    ),
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
    if (f.components?.length) lines.push(`    <components>${escText(JSON.stringify(f.components))}</components>`);
    lines.push('  </forest>');
  } else {
    lines.push(...kitsXml(doc.kits, '  '), ...treeXml(doc.tree, '  '));
  }
  lines.push('</tree-weaver>', '');
  // XML 1.0 can't hold these even as references; import drops them from every format.
  return lines.join('\n').replace(CONTROL_CHARS, '');
}

/* ----------------------------------------------------------------- import */

const elements = (el: Element, name?: string): Element[] =>
  el.children.filter((c): c is Element => c.type === 'tag' && (name === undefined || localName(c) === name));

const localName = (el: Element): string => el.name.replace(/^.*:/, '');

const textOf = (el: Element): string =>
  // CDATA sections hold their text in a child node.
  el.children.map((c) => ('data' in c ? (c.data as string) : c.type === 'tag' || c.type === 'cdata' ? textOf(c as Element) : '')).join('');

function json(text: string, what: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new FormatError(`<${what}> does not hold valid JSON`, 'xml');
  }
}

function readNode(el: Element): Record<string, unknown> {
  const a = el.attribs;
  if (localName(el) === 'leaf') {
    // Text leaves hold their attrs as <attr> children before the text, which has no element children.
    const leafAttrs = Object.fromEntries(elements(el, 'attr').map((x) => [x.attribs.name ?? '', x.attribs.value ?? '']));
    return { kind: 'leaf', id: a.id, type: a.type, value: a.type === 'image' || a.type === 'shape' ? a.value : (a.value ?? textOf(el)), attrs: leafAttrs };
  }
  // Keys come from the file: only known displays, and maps without a prototype, so a display or
  // property named `__proto__` can't reach Object.prototype.
  const styles: Record<string, Record<string, string>> = Object.create(null);
  for (const style of elements(el, 'style')) {
    const display = style.attribs.display;
    if (!(DISPLAY_IDS as readonly string[]).includes(display)) continue;
    const map = (styles[display] ??= Object.create(null) as Record<string, string>);
    for (const decl of elements(style, 'declaration')) map[decl.attribs.property ?? ''] = decl.attribs.value ?? '';
  }
  return {
    kind: 'branch',
    id: a.id,
    tag: a.tag,
    type: a.type,
    name: a.name,
    classes: a.class ?? '',
    attrs: Object.fromEntries(elements(el, 'attr').map((x) => [x.attribs.name ?? '', x.attribs.value ?? ''])),
    styles,
    ...(elements(el, 'instance')[0] ? { instance: json(textOf(elements(el, 'instance')[0]), 'instance') } : {}),
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
  return elements(el, 'kit').map((k) => {
    const rules = elements(k, 'rules')[0];
    const tokens = elements(k, 'tokens')[0];
    // The CSS is the kit's own text, not its <rules>/<tokens> children.
    const css = k.children.map((c) => (c.type === 'text' || c.type === 'cdata' ? ('data' in c ? (c.data as string) : textOf(c as unknown as Element)) : '')).join('');
    return { ...k.attribs, css, ...(rules ? { rules: json(textOf(rules), 'rules') } : {}), ...(tokens ? { tokens: json(textOf(tokens), 'tokens') } : {}) };
  });
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
      ...(elements(forestEl, 'components')[0] ? { components: json(textOf(elements(forestEl, 'components')[0]), 'components') } : {}),
    };
    return fromData({ version, forest }, 'xml');
  }
  const treeEl = name === 'tree' ? top : holder && elements(holder, 'tree')[0];
  if (!treeEl) throw new FormatError('The XML has no <forest> or <tree>', 'xml');
  return fromData({ version, tree: readTree(treeEl), kits: holder ? readKits(elements(holder, 'kits')[0]) : [] }, 'xml');
}

