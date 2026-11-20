import {
  INLINE_TAGS,
  isBranch,
  isSafeAttr,
  isSvgRoot,
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

// A shape leaf is drawn inside an SVG, never inline text.
const isInlineNode = (n: TreeNode): boolean => (isBranch(n) ? INLINE_TAGS.has(n.tag) : n.type !== 'shape');

export function escapeMarkdown(text: string, atLineStart = false): string {
  // Brackets and angle brackets as entities: a backslash escape can be taken apart (a link that
  // fails to parse, an autolink swallowing the backslash), an entity is always literal text.
  let out = text
    .replace(/\\/g, '\\\\')
    .replace(/&/g, '&amp;')
    .replace(/[[\]<>]/g, (c) => ({ '[': '&#91;', ']': '&#93;', '<': '&lt;', '>': '&gt;' })[c] as string)
    .replace(/([`*_|~])/g, '\\$1');
  if (atLineStart) out = out.replace(/^(\s*)([#+-])/, '$1\\$2').replace(/^(\s*)(\d+)([.)])/, '$1$2\\$3');
  // A `!` right before a link would turn it into an image.
  out = out.replace(/!$/, '\\!');
  // A closing `#` run would be read as the end of a heading.
  out = out.replace(/(^|\s)(#+)(\s*)$/, '$1\\$2$3');
  // Bare URLs would become links (GFM autolinks).
  out = out.replace(/\b(https?|ftp|mailto):/gi, '$1\\:').replace(/\bwww\./gi, 'www\\.').replace(/([\w.+-])@(?=[\w-]+\.)/g, '$1\\@');
  return out;
}

/** Set while a table row is written: a `|` there would split the cell, even inside code or a link. */
let inTable = false;

// Parentheses are backslash-escaped (they come back exactly); spaces, angle brackets and line breaks are percent-encoded.
const escapeUrl = (url: string): string =>
  url.replace(inTable ? /[ <>\t\n\r|]/g : /[ <>\t\n\r]/g, (c) => encodeURIComponent(c)).replace(/[\\()]/g, '\\$&');
/** A one-line title, quoted: a line break would end the paragraph, and a backslash could escape the closing quote. */
// Every ASCII punctuation mark is backslash-escaped, so nothing in a title reads as Markdown.
const titleOf = (title: string | undefined): string => (title ? ` "${oneLine(title).replace(/[!-/:-@[-`{-~]/g, '\\$&')}"` : '');
const oneLine = (text: string): string => text.replace(/\s*[\n\r]\s*/g, ' ');
/**
 * Inline HTML on one line (a blank line inside it would end the paragraph and start a new block),
 * with Markdown syntax in the text between its tags written as entities: only the tags are raw,
 * so `[x](javascript:…)` or `*` there would otherwise still become links and emphasis.
 */
const inlineHtml = (html: string): string =>
  html
    .split(/(<[^>]*>)/)
    .map((part, i) => (i % 2 ? (inTable ? part.replace(/\|/g, '&#124;') : part) : part.replace(/[\\`*_[\]~!:|#+\-=.(){}]/g, (c) => `&#${c.charCodeAt(0)};`)))
    .join('')
    .replace(/\r/g, '&#13;')
    .replace(/\n/g, '&#10;');

function inline(node: TreeNode, first: boolean): string {
  if (!isBranch(node)) {
    if (node.type === 'image') return image(node);
    return escapeMarkdown(oneLine(node.value), first);
  }
  const tag = node.tag;
  const content = () => inlineList(node.children, false);
  if (Object.hasOwn(MARK_INLINE, tag) && !needsMeta(node) && node.children.length) return wrapTrimmed(content(), MARK_INLINE[tag]);
  if (tag === 'code' && !needsMeta(node) && node.children.every((c) => !isBranch(c) && c.type === 'text')) {
    // Markdown turns line breaks in a code span into spaces anyway; a blank line would end the paragraph.
    let code = oneLine(node.children.map((c) => (c as Leaf).value).join(''));
    if (inTable) code = code.replace(/\|/g, '\\|');
    // A fence longer than any run of backticks in the code, padded with spaces when the code has any.
    const longest = Math.max(0, ...(code.match(/`+/g) ?? []).map((r) => r.length));
    const ticks = '`'.repeat(longest + 1);
    // An empty span has no Markdown form; CommonMark strips one space from each end when both have one.
    if (!code) return inlineHtml(renderNodeHtml(node));
    const pad = longest || (code.startsWith(' ') && code.endsWith(' ') && code.trim() !== '') || /^`|`$/.test(code);
    return pad ? `${ticks} ${code} ${ticks}` : `${ticks}${code}${ticks}`;
  }
  // A script link is dropped, as in every other export; its text stays.
  if (tag === 'a' && node.attrs.href !== undefined && !safeUrl('href', node.attrs.href)) return content();
  // A link inside a link has no Markdown form.
  const nestsLink = node.children.some(function has(c: TreeNode): boolean {
    return isBranch(c) && (c.tag === 'a' || c.children.some(has));
  });
  if (tag === 'a' && !needsMeta(node, LINK_ATTRS) && node.attrs.href !== undefined && !nestsLink) {
    return `[${content()}](${escapeUrl(node.attrs.href)}${titleOf(node.attrs.title)})`;
  }
  if (tag === 'br' && !needsMeta(node)) return '<br>';
  return inlineHtml(renderNodeHtml(node));
}

function wrapTrimmed(text: string, mark: string): string {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)!;
  return m[2] ? `${m[1]}${mark}${m[2]}${mark}${m[3]}` : text;
}

function image(leaf: Leaf): string {
  const alt = escapeMarkdown(oneLine(leaf.attrs?.alt ?? ''));
  if (!safeUrl('src', leaf.value)) return alt;
  const extra = Object.keys(leaf.attrs ?? {}).filter((k) => k !== 'alt' && k !== 'title');
  if (extra.length) return inlineHtml(renderNodeHtml(leaf));
  return `![${alt}](${escapeUrl(leaf.value)}${titleOf(leaf.attrs?.title)})`;
}

const inlineRun = (nodes: TreeNode[]): string => inlineList(nodes, true);

/**
 * Inline nodes written side by side. Emphasis (`**`, `*`, `~~`) and code spans only read back when
 * their delimiters can open and close where they land (CommonMark's flanking rules) and don't
 * run into a neighbour's; otherwise the element is written as inline HTML.
 */
function inlineList(nodes: TreeNode[], first: boolean): string {
  const parts = nodes.map((n, i) => inline(n, first && i === 0));
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (!isBranch(n) || needsMeta(n)) continue;
    const before = parts.slice(0, i).join('');
    const after = parts.slice(i + 1).join('');
    const mark = Object.hasOwn(MARK_INLINE, n.tag) ? MARK_INLINE[n.tag] : n.tag === 'code' && parts[i].startsWith('`') ? '`' : null;
    // Strikethrough mixed with emphasis, or `~~` meeting a nested `~~`, doesn't read back as written.
    const tilde = mark === '~~' && (/^\s*~~~|~~~\s*$/.test(parts[i]) || hasEmphasis(n));
    if (mark && (tilde || !delimitersFit(before, parts[i], after, mark))) parts[i] = inlineHtml(renderNodeHtml(n));
  }
  return parts.join('');
}

const hasEmphasis = (n: Branch): boolean => n.children.some((c) => isBranch(c) && ((Object.hasOwn(MARK_INLINE, c.tag) && MARK_INLINE[c.tag] !== '~~') || hasEmphasis(c)));

const isPunct = (c: string) => /[\p{P}\p{S}]/u.test(c);
const isSpace = (c: string) => c === '' || /\s/.test(c);

function delimitersFit(before: string, out: string, after: string, mark: string): boolean {
  const lead = /^\s*/.exec(out)![0];
  const trail = /\s*$/.exec(out)![0];
  const core = out.slice(lead.length, out.length - trail.length);
  if (!core.startsWith(mark[0])) return true;
  const prev = lead ? ' ' : before.slice(-1);
  const next = trail ? ' ' : after.charAt(0);
  // `**a****b**`, `a``b`: the delimiters would join a neighbour's.
  if (prev === mark[0] || next === mark[0]) return false;
  if (mark[0] === '`') return true;
  const open = mark.length;
  const first = core.charAt(open);
  const last = core.charAt(core.length - open - 1);
  if (isPunct(first) && !isSpace(prev) && !isPunct(prev)) return false;
  if (isPunct(last) && !isSpace(next) && !isPunct(next)) return false;
  return true;
}
/**
 * An inline run as one trimmed line, with block syntax at its start escaped: trimming can bring
 * any child (not just the first) to the start, where `#`, `-` or `1.` would start a block.
 */
const inlineLine = (nodes: TreeNode[]): string =>
  inlineRun(nodes)
    // HTML whitespace only: a non-breaking space is content.
    .replace(/^[ \t\n\r\f]+|[ \t\n\r\f]+$/g, '')
    .replace(/^([#+-])/, '\\$1')
    .replace(/^(\d+)([.)])/, '$1\\$2');

/**
 * Whether a link or image URL is safe as Markdown writes it. Markdown decodes character
 * references in link targets, so `&#106;avascript:` is checked decoded too.
 */
function safeUrl(name: string, url: string): boolean {
  if (!isSafeAttr(name, url)) return false;
  const el = parseDocument(`<a x="${url.replace(/"/g, '&quot;')}">`, { decodeEntities: true }).children[0];
  const decoded = el && 'attribs' in el ? ((el.attribs as Record<string, string>).x ?? '') : '';
  return isSafeAttr(name, decoded);
}

const directive = (kind: string, data?: unknown): string => `<!-- tw:${kind}${data === undefined ? '' : ` ${directiveJson(data)}`} -->`;

/** Children of a container: inline runs become unwrapped paragraphs, branches become blocks. */
function blocks(nodes: TreeNode[]): string[] {
  const out: string[] = [];
  let run: TreeNode[] = [];
  const flush = () => {
    if (!run.length) return;
    const text = inlineLine(run);
    if (text) out.push(`${directive('inline')}\n${text}`);
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

function list(b: Branch, pad = ''): string | null {
  const ordered = b.tag === 'ol';
  const lines: string[] = [];
  const start = Number.parseInt(b.attrs.start ?? '1', 10);
  let n = Number.isFinite(start) ? start : 1;
  // CommonMark list markers are 0 to 999999999; any other start keeps the HTML form.
  if (ordered && (n < 0 || n + b.children.length - 1 > 999999999)) return null;
  for (const item of b.children) {
    if (!isBranch(item) || item.tag !== 'li' || needsMeta(item)) return null;
    const inlineKids = item.children.filter(isInlineNode);
    const nested = item.children.filter((c) => !isInlineNode(c));
    // Inline content must come first; nested lists after it.
    if (item.children.slice(0, inlineKids.length).some((c) => !isInlineNode(c))) return null;
    const marker = ordered ? `${n++}.` : '-';
    // Edge non-breaking spaces as references: a trailing one would read as a paragraph of its own.
    lines.push(`${pad}${marker} ${inlineLine(inlineKids).replace(/^\u00a0+|\u00a0+$/g, (m) => '&#160;'.repeat(m.length))}`);
    for (const sub of nested) {
      if (!isBranch(sub) || (sub.tag !== 'ul' && sub.tag !== 'ol') || needsMeta(sub)) return null;
      // A nested list lines up with its item's text: past the marker (`10.` is wider than `-`).
      const md = list(sub, pad + ' '.repeat(marker.length + 1));
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
  // A Markdown table always has a header row, so one without stays HTML rather than gaining one.
  if (!rows.length || headerRows !== 1) return null;
  const cells = rows.map((r) => r.children);
  const width = Math.max(...cells.map((c) => c.length));
  for (const row of cells) {
    for (const cell of row) {
      if (!isBranch(cell) || (cell.tag !== 'td' && cell.tag !== 'th') || needsMeta(cell) || !cell.children.every(isInlineNode)) return null;
    }
  }
  const cell = (c: TreeNode | undefined): string => {
    if (!c) return '';
    inTable = true;
    try {
      // Cells are trimmed of every kind of space when read, like headings.
      return inlineLine((c as Branch).children).replace(/^\u00a0+|\u00a0+$/g, (m) => '&#160;'.repeat(m.length));
    } finally {
      inTable = false;
    }
  };
  const line = (row: TreeNode[]) => `| ${Array.from({ length: width }, (_, i) => cell(row[i])).join(' | ')} |`;
  const header = headerRows ? cells[0] : [];
  const body = headerRows ? cells.slice(1) : cells;
  return [line(header), `| ${Array.from({ length: width }, () => '---').join(' | ')} |`, ...body.map(line)].join('\n');
}

function block(b: Branch): string {
  // A drawing goes in as one line of inline SVG markup, ids included, so its shapes come back.
  // Its opening tag stands on a line of its own, which makes the rest an HTML block, not a paragraph.
  if (b.tag === 'svg') return inlineHtml(renderNodeHtml(b)).replace(/^(<svg\b[^>]*>)/, '$1\n');
  const allInline = b.children.every(isInlineNode);
  const heading = HEADING.exec(b.tag);
  // A heading's text is trimmed of every kind of space when read, so edge non-breaking spaces are written as references.
  const nbspRef = (m: string) => '&#160;'.repeat(m.length);
  const headingText = heading && allInline ? inlineLine(b.children).replace(/^\u00a0+/, nbspRef).replace(/\u00a0+$/, nbspRef) : '';
  if (heading && headingText) return withMeta(b, `${'#'.repeat(Number(heading[1]))} ${headingText}`);
  const paragraph = b.tag === 'p' && allInline ? inlineLine(b.children) : '';
  if (paragraph) return withMeta(b, paragraph);
  if (b.tag === 'hr' && !needsMeta(b)) return '---';
  if ((b.tag === 'ul' || b.tag === 'ol') && b.children.length) {
    const allowed = new Set(b.tag === 'ol' ? ['start'] : []);
    const md = list(b);
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
      // Backticks, more than the longest run in the code, so no line of it can close the fence.
      const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((r) => r.length));
      const fence = '`'.repeat(Math.max(3, longest + 1));
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
  // An SVG tree's root is written as the drawing itself, which carries its id.
  if (!isSvgRoot(tree.root) && (Object.keys(root).length > 1 || tree.root.type !== 'root' || tree.root.name !== 'Body')) front.root = root;
  if (Object.keys(styles).length) front.styles = styles;
  if (opts.kits?.length) front.kits = opts.kits;
  // Markdown is a page format: an SVG tree's drawing goes in as inline SVG.
  const body = blocks(isSvgRoot(tree.root) ? [tree.root] : tree.root.children).join('\n\n');
  // Renderers without front matter show it as text, where HTML in a name or CSS would be live:
  // then every string is double-quoted with `<` escaped (YAML reads `\x3C` back as `<`).
  // Only inside strings: an empty list is written `[]`.
  let yaml = stringifyYaml(front, { lineWidth: 0 });
  // Link syntax too: front matter shown as Markdown would make `[x](javascript:…)` a live link.
  if (/[<[\]`]/.test(yaml))
    yaml = stringifyYaml(front, { lineWidth: 0, defaultStringType: 'QUOTE_DOUBLE', defaultKeyType: 'QUOTE_DOUBLE' }).replace(/"(?:[^"\\]|\\.)*"/g, (q) => q.replace(/[<[\]`]/g, (c) => `\\x${c.charCodeAt(0).toString(16).toUpperCase()}`));
  return `---\n${yaml}---\n\n${body}\n`;
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
  let root = convertParts('body', {}, dom.children, ctx, false);
  // An SVG tree comes back as its drawing: the one root SVG the body holds.
  const kids = root.children as Record<string, unknown>[];
  if (!data.root && kids.length === 1 && kids[0].kind === 'branch' && kids[0].tag === 'svg' && kids[0].type === 'root') {
    const firstHeading = /^#\s+(.+)$/m.exec(body)?.[1]?.trim();
    root = kids[0];
    return fromData({ tree: { id: data.id, name: typeof data.name === 'string' ? data.name : (firstHeading ?? 'Imported markdown'), root }, kits: Array.isArray(data.kits) ? data.kits : [] }, 'markdown');
  }
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
