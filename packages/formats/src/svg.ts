import {
  createId,
  isBranch,
  isSvgRoot,
  renderNodeHtml,
  renderTreeCss,
  walk,
  type Branch,
  type DesignKit,
  type DisplayStyles,
  type Tree,
} from '@tree-weaver/core';
import type { ChildNode, Element } from 'domhandler';
import { parseDocument } from 'htmlparser2';
import { fromData } from './data';
import { convertParts, readTreeCss, type Ctx } from './html';
import { FormatError, type TreeDocument } from './types';

/*
 * SVG files.
 *
 * Export writes a standalone `.svg` for an SVG tree (or the first `<svg>` branch of a
 * page). Its kits and responsive styles go in `<style>` elements inside the drawing, and
 * every element keeps its `data-tw` id, so the file opens again with nothing lost.
 *
 * Import reads any SVG file into an SVG tree: containers become branches, shapes become
 * shape leaves, `<image>` an image leaf and text a text leaf. Editor metadata (Inkscape,
 * Sodipodi), scripts and animation are dropped.
 */

export interface SvgExportOptions {
  kits?: DesignKit[];
}

/** The `<svg>` that an SVG export writes: the tree's root, or the first `<svg>` branch in a page. */
export function drawingOf(tree: Tree): Branch | null {
  if (isSvgRoot(tree.root)) return tree.root;
  let found: Branch | null = null;
  walk(tree.root, (node) => {
    if (found) return false;
    if (isBranch(node) && node.tag === 'svg') found = node;
  });
  return found;
}

const cdata = (css: string): string => `<![CDATA[\n${css.replace(/]]>/g, ']]]]><![CDATA[>')}\n]]>`;
const xmlAttr = (v: string): string => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/** A standalone SVG file for the tree's drawing, with its kits and responsive styles inside. */
export function exportSvg(tree: Tree, opts: SvgExportOptions = {}): string {
  const svg = drawingOf(tree);
  if (!svg) throw new FormatError('This tree has no SVG to export. Plant an SVG tree, or add an SVG canvas branch first.', 'svg');
  const styles: string[] = [];
  for (const kit of (opts.kits ?? []).filter((k) => k.enabled)) {
    const css = kit.href ? `@import url("${kit.href.replace(/"/g, '%22')}");` : kit.css;
    if (css.trim()) styles.push(`<style data-tw-kit="${xmlAttr(kit.id)}" data-tw-kit-name="${xmlAttr(kit.name)}">${cdata(css)}</style>`);
  }
  const branchCss = renderTreeCss(svg);
  if (branchCss) styles.push(`<style data-tw-styles="">${cdata(branchCss)}</style>`);
  // Designer markup keeps text leaves' ids on <tspan>s, which a standalone SVG draws the same.
  const markup = renderNodeHtml(svg, { pretty: true, xml: true, designer: true });
  const body = styles.length ? markup.replace(/^(<svg\b[^>]*>)/, `$1\n  ${styles.join('\n  ')}`) : markup;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!-- ${tree.name.replace(/--/g, '- -')} · made with Tree Weaver -->\n${body}\n`;
}

/* ----------------------------------------------------------------- import */

const isElement = (n: ChildNode): n is Element => n.type === 'tag' || n.type === 'script' || n.type === 'style';
const textOf = (el: Element): string => el.children.map((c) => (c.type === 'text' || c.type === 'cdata' ? textOfAny(c) : isElement(c) ? textOf(c) : '')).join('');
const textOfAny = (c: ChildNode): string => ('data' in c ? (c.data as string) : 'children' in c ? (c.children as ChildNode[]).map(textOfAny).join('') : '');

/** Elements dropped on import: scripts, animation, editor metadata and anything outside the SVG namespace. */
const DROP = new Set(['script', 'style', 'metadata', 'animate', 'set', 'animateMotion', 'animateTransform', 'handler', 'listener']);

/** Copy an XML element tree, dropping what Tree Weaver doesn't keep and namespaced extras (`inkscape:*`). */
function clean(el: Element): Element {
  el.children = el.children.filter((c) => !isElement(c) || (!DROP.has(c.name.replace(/^svg:/, '')) && !/^(?!svg:)\w+:/.test(c.name)));
  el.name = el.name.replace(/^svg:/, '');
  for (const name of Object.keys(el.attribs)) {
    if (/^(xmlns:|inkscape:|sodipodi:|sketch:|serif:)/.test(name)) delete el.attribs[name];
  }
  el.children.forEach((c) => isElement(c) && clean(c));
  return el;
}

function* allElements(nodes: ChildNode[]): Generator<Element> {
  for (const n of nodes) {
    if (!isElement(n)) continue;
    yield n;
    yield* allElements(n.children);
  }
}

/** Read an SVG file into an SVG tree, with any `<style>` it holds as design kits. */
export function importSvg(text: string): TreeDocument {
  const dom = parseDocument(text, { xmlMode: true, decodeEntities: true });
  const top = dom.children.find(isElement);
  if (!top || top.name.replace(/^svg:/, '') !== 'svg') throw new FormatError(`Expected an <svg> file${top ? `, found <${top.name}>` : ''}`, 'svg');

  const styles = new Map<string, DisplayStyles>();
  const kits: Record<string, unknown>[] = [];
  const looseCss: string[] = [];
  for (const el of allElements([top])) {
    if (el.name.replace(/^svg:/, '') !== 'style') continue;
    const css = textOf(el).trim();
    if (el.attribs['data-tw-styles'] !== undefined) readTreeCss(css, styles);
    else if (el.attribs['data-tw-kit'] !== undefined) kits.push({ id: el.attribs['data-tw-kit'] || createId('k'), name: el.attribs['data-tw-kit-name'] || 'Design kit', css, enabled: true });
    else if (css) looseCss.push(css);
  }

  const titleEl = top.children.find((c): c is Element => isElement(c) && c.name.replace(/^svg:/, '') === 'title');
  const title = titleEl ? textOf(titleEl).trim() : '';
  const comment = dom.children.find((c) => c.type === 'comment' && / · made with Tree Weaver $/.test(c.data));
  const name = comment && 'data' in comment ? (comment.data as string).replace(/ · made with Tree Weaver $/, '').trim() : title;
  if (looseCss.length) kits.push({ id: createId('k'), name: name ? `${name} styles` : 'Drawing styles', css: looseCss.join('\n\n'), enabled: true, source: 'svg' });

  const ctx: Ctx = { styles };
  const root = convertParts('svg', clean(top).attribs, top.children, ctx, false);
  root.type ??= 'root';
  root.name ??= 'Drawing';
  return fromData({ tree: { name: name || 'Imported drawing', root }, kits }, 'svg');
}

/** Whether a tree has a drawing an SVG export can write. */
export const hasDrawing = (tree: Tree): boolean => drawingOf(tree) !== null;
