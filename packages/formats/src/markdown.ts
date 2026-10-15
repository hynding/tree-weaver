import {
  INLINE_TAGS,
  isBranch,
  renderNodeHtml,
  walk,
  type Branch,
  type DesignKit,
  type DisplayStyles,
  type Leaf,
  type Tree,
  type TreeNode,
} from '@tree-weaver/core';
import { parseDocument } from 'htmlparser2';
import { marked } from 'marked';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { fromData } from './data';
import { convertParts, directiveJson, type Ctx } from './html';
import { DOCUMENT_VERSION, FormatError, type TreeDocument } from './types';

/*
 * Markdown export writes content the way a person would (headings, paragraphs,
 * lists, tables, links, images, code) and keeps the layout in places Markdown
 * renderers ignore: YAML front matter for the tree, its kits and every branch's
 * responsive styles, and HTML comment directives for layout branches (see
 * DIRECTIVE in html.ts). Inline formatting with no Markdown syntax falls back to
 * inline HTML. Branch ids on plain headings, paragraphs and lists are not kept.
 */

export interface MarkdownExportOptions {
  kits?: DesignKit[];
}

const HEADING = /^h([1-6])$/;
const MARK_INLINE: Record<string, string> = { strong: '**', b: '**', em: '*', i: '*', del: '~~', s: '~~' };
const LINK_ATTRS = new Set(['href', 'title']);

const hasStyles = (b: Branch) => Object.keys(b.styles).length > 0;

/** Branch carries information that Markdown syntax alone would lose. */
function needsMeta(b: Branch, allowedAttrs: Set<string> = new Set()): boolean {
  return !!(b.type || b.name || b.classes.length || hasStyles(b) || Object.keys(b.attrs).some((a) => !allowedAttrs.has(a)));
}

function metaOf(b: Branch, allowedAttrs: Set<string> = new Set()): Record<string, unknown> {
  const meta: Record<string, unknown> = { id: b.id };
  if (b.type) meta.type = b.type;
  if (b.name) meta.name = b.name;
  if (b.classes.length) meta.classes = b.classes;
  const attrs = Object.fromEntries(Object.entries(b.attrs).filter(([k]) => !allowedAttrs.has(k)));
  if (Object.keys(attrs).length) meta.attrs = attrs;
  return meta;
}

const isInlineNode = (n: TreeNode): boolean => !isBranch(n) || INLINE_TAGS.has(n.tag);

export function escapeMarkdown(text: string, atLineStart = false): string {
  let out = text.replace(/\\/g, '\\\\').replace(/&/g, '&amp;').replace(/([`*_[\]<>|~])/g, '\\$1');
  if (atLineStart) out = out.replace(/^(\s*)([#+-])/, '$1\\$2').replace(/^(\s*)(\d+)([.)])/, '$1$2\\$3');
  return out;
}

const escapeUrl = (url: string): string => url.replace(/[ ()<>]/g, (c) => encodeURIComponent(c));

function inline(node: TreeNode, first: boolean): string {
  if (!isBranch(node)) {
    if (node.type === 'image') return image(node);
    return escapeMarkdown(node.value.replace(/\s*\n\s*/g, ' '), first);
  }
  const tag = node.tag;
  const content = () => node.children.map((c) => inline(c, false)).join('');
  if (MARK_INLINE[tag] && !needsMeta(node) && node.children.length) return wrapTrimmed(content(), MARK_INLINE[tag]);
  if (tag === 'code' && !needsMeta(node) && node.children.every((c) => !isBranch(c) && c.type === 'text')) {
    const code = node.children.map((c) => (c as Leaf).value).join('');
    const fence = code.includes('`') ? '`` ' : '`';
    return `${fence}${code}${fence.split('').reverse().join('')}`;
  }
  if (tag === 'a' && !needsMeta(node, LINK_ATTRS) && node.attrs.href !== undefined) {
    const title = node.attrs.title ? ` "${node.attrs.title.replace(/"/g, '\\"')}"` : '';
    return `[${content()}](${escapeUrl(node.attrs.href)}${title})`;
  }
  if (tag === 'br' && !needsMeta(node)) return '<br>';
  return renderNodeHtml(node);
}

function wrapTrimmed(text: string, mark: string): string {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)!;
  return m[2] ? `${m[1]}${mark}${m[2]}${mark}${m[3]}` : text;
}

function image(leaf: Leaf): string {
  const alt = (leaf.attrs?.alt ?? '').replace(/[[\]]/g, '\\$&');
  const extra = Object.keys(leaf.attrs ?? {}).filter((k) => k !== 'alt' && k !== 'title');
  if (extra.length) return renderNodeHtml(leaf);
  const title = leaf.attrs?.title ? ` "${leaf.attrs.title.replace(/"/g, '\\"')}"` : '';
  return `![${alt}](${escapeUrl(leaf.value)}${title})`;
}

const inlineRun = (nodes: TreeNode[]): string => nodes.map((n, i) => inline(n, i === 0)).join('');

const directive = (kind: string, data?: unknown): string => `<!-- tw:${kind}${data === undefined ? '' : ` ${directiveJson(data)}`} -->`;

/** Children of a container: inline runs become unwrapped paragraphs, branches become blocks. */
function blocks(nodes: TreeNode[]): string[] {
  const out: string[] = [];
  let run: TreeNode[] = [];
  const flush = () => {
    if (!run.length) return;
    const text = inlineRun(run);
    if (text.trim()) out.push(`${directive('inline')}\n${text.trim()}`);
    run = [];
  };
  for (const node of nodes) {
    if (isInlineNode(node)) run.push(node);
    else {
      flush();
      out.push(block(node as Branch));
    }
  }
  flush();
  return out;
}

const withMeta = (b: Branch, md: string, allowed?: Set<string>): string =>
  needsMeta(b, allowed) ? `${directive('meta', metaOf(b, allowed))}\n\n${md}` : md;

function container(b: Branch): string {
  const inner = blocks(b.children);
  const open = directive('branch', { tag: b.tag, ...metaOf(b) });
  return inner.length ? `${open}\n\n${inner.join('\n\n')}\n\n<!-- /tw:branch -->` : `${open}\n<!-- /tw:branch -->`;
}

function list(b: Branch, depth: number): string | null {
  const ordered = b.tag === 'ol';
  const lines: string[] = [];
  let n = Number(b.attrs.start ?? 1);
  for (const item of b.children) {
    if (!isBranch(item) || item.tag !== 'li' || needsMeta(item)) return null;
    const inlineKids = item.children.filter(isInlineNode);
    const nested = item.children.filter((c) => !isInlineNode(c));
    // Inline content must come first; nested lists after it.
    if (item.children.slice(0, inlineKids.length).some((c) => !isInlineNode(c))) return null;
    const marker = ordered ? `${n++}.` : '-';
    const pad = '   '.repeat(depth);
    lines.push(`${pad}${marker} ${inlineRun(inlineKids).trim()}`);
    for (const sub of nested) {
      if (!isBranch(sub) || (sub.tag !== 'ul' && sub.tag !== 'ol') || needsMeta(sub)) return null;
      const md = list(sub, depth + 1);
      if (md === null) return null;
      lines.push(md);
    }
  }
  return lines.join('\n');
}

function table(b: Branch): string | null {
  const rows: Branch[] = [];
  let headerRows = 0;
  for (const child of b.children) {
    if (!isBranch(child) || needsMeta(child)) return null;
    if (child.tag === 'tr') rows.push(child);
    else if (['thead', 'tbody', 'tfoot'].includes(child.tag)) {
      for (const r of child.children) {
        if (!isBranch(r) || r.tag !== 'tr' || needsMeta(r)) return null;
        rows.push(r);
        if (child.tag === 'thead') headerRows++;
      }
    } else return null;
  }
  if (!rows.length || headerRows > 1) return null;
  const cells = rows.map((r) => r.children);
  const width = Math.max(...cells.map((c) => c.length));
  for (const row of cells) {
    for (const cell of row) {
      if (!isBranch(cell) || (cell.tag !== 'td' && cell.tag !== 'th') || needsMeta(cell) || !cell.children.every(isInlineNode)) return null;
    }
  }
  const line = (row: TreeNode[]) =>
    `| ${Array.from({ length: width }, (_, i) => (row[i] ? inlineRun((row[i] as Branch).children).trim() : '')).join(' | ')} |`;
  const header = headerRows ? cells[0] : [];
  const body = headerRows ? cells.slice(1) : cells;
  return [line(header), `| ${Array.from({ length: width }, () => '---').join(' | ')} |`, ...body.map(line)].join('\n');
}

function block(b: Branch): string {
  const allInline = b.children.every(isInlineNode);
  const heading = HEADING.exec(b.tag);
  if (heading && allInline && b.children.length) return withMeta(b, `${'#'.repeat(Number(heading[1]))} ${inlineRun(b.children).trim()}`);
  if (b.tag === 'p' && allInline && b.children.length) return withMeta(b, inlineRun(b.children).trim());
  if (b.tag === 'hr' && !needsMeta(b)) return '---';
  if ((b.tag === 'ul' || b.tag === 'ol') && b.children.length) {
    const allowed = new Set(b.tag === 'ol' ? ['start'] : []);
    const md = list(b, 0);
    if (md !== null) return withMeta(b, md, allowed);
  }
  if (b.tag === 'table') {
    const md = table(b);
    if (md !== null) return withMeta(b, md);
  }
  if (b.tag === 'blockquote' && b.children.length && !needsMeta(b)) {
    return blocks(b.children)
      .join('\n\n')
      .split('\n')
      .map((l) => (l ? `> ${l}` : '>'))
      .join('\n');
  }
  if (b.tag === 'pre' && !needsMeta(b) && b.children.length === 1) {
    const code = b.children[0];
    if (isBranch(code) && code.tag === 'code' && !needsMeta(code) && code.children.every((c) => !isBranch(c) && c.type === 'text')) {
      const text = code.children.map((c) => (c as Leaf).value).join('').replace(/\n$/, '');
      const fence = text.includes('```') ? '~~~~' : '```';
      return `${fence}\n${text}\n${fence}`;
    }
  }
  return container(b);
}

export function exportMarkdown(tree: Tree, opts: MarkdownExportOptions = {}): string {
  const styles: Record<string, DisplayStyles> = {};
  walk(tree.root, (n) => {
    if (isBranch(n) && hasStyles(n)) styles[n.id] = n.styles;
  });
  const front: Record<string, unknown> = { 'tree-weaver': DOCUMENT_VERSION, id: tree.id, name: tree.name };
  const root = metaOf(tree.root);
  if (Object.keys(root).length > 1 || tree.root.type !== 'root' || tree.root.name !== 'Body') front.root = root;
  if (Object.keys(styles).length) front.styles = styles;
  if (opts.kits?.length) front.kits = opts.kits;
  const body = blocks(tree.root.children).join('\n\n');
  return `---\n${stringifyYaml(front, { lineWidth: 0 })}---\n\n${body}\n`;
}

/* ----------------------------------------------------------------- import */

const FRONT_MATTER = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

export function splitFrontMatter(text: string): { data: Record<string, unknown>; body: string } {
  const m = FRONT_MATTER.exec(text);
  if (!m) return { data: {}, body: text };
  let data: unknown;
  try {
    data = parseYaml(m[1]);
  } catch (err) {
    throw new FormatError(`Invalid front matter: ${(err as Error).message}`, 'markdown');
  }
  return { data: typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {}, body: text.slice(m[0].length) };
}

/**
 * Read Markdown (CommonMark + GitHub tables) into a tree. Front matter and
 * comment directives written by `exportMarkdown` restore layout branches and
 * responsive styles; plain Markdown from anywhere else imports as content.
 */
export function importMarkdown(text: string): TreeDocument {
  const { data, body } = splitFrontMatter(text);
  const html = marked.parse(body, { gfm: true, async: false });
  const dom = parseDocument(html, { decodeEntities: true });
  const styles = new Map<string, DisplayStyles>();
  if (data.styles && typeof data.styles === 'object') {
    for (const [id, s] of Object.entries(data.styles as Record<string, DisplayStyles>)) styles.set(id, s);
  }
  const ctx: Ctx = { styles };
  const root = convertParts('body', {}, dom.children, ctx, false);
  const rootMeta = (data.root ?? {}) as Record<string, unknown>;
  if (typeof rootMeta.id === 'string') {
    root.id = rootMeta.id;
    root.styles = styles.get(rootMeta.id) ?? {};
  }
  root.type = typeof rootMeta.type === 'string' ? rootMeta.type : 'root';
  root.name = typeof rootMeta.name === 'string' ? rootMeta.name : 'Body';
  if (Array.isArray(rootMeta.classes)) root.classes = rootMeta.classes;
  if (rootMeta.attrs && typeof rootMeta.attrs === 'object') root.attrs = rootMeta.attrs;

  const firstHeading = /^#\s+(.+)$/m.exec(body)?.[1]?.trim();
  const name = typeof data.name === 'string' ? data.name : (firstHeading ?? 'Imported markdown');
  return fromData({ tree: { id: data.id, name, root }, kits: Array.isArray(data.kits) ? data.kits : [] }, 'markdown');
}
