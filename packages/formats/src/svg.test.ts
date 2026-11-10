import { createBranch, createKit, createShape, createSvg, createSvgTree, createTree, isBranch, text, type Branch, type Leaf } from '@tree-weaver/core';
import { describe, expect, it } from 'vitest';
import { detectFormat, exportTree, FormatError, importDocument, importHtml } from './index';

const logo = () => {
  const group = createBranch({ tag: 'g', name: 'Badge', styles: { lg: { fill: 'navy' }, 'mobile-portrait': { opacity: '0.5' } }, children: [createShape('circle', { cx: '50', cy: '50', r: '40' })] });
  const label = createBranch({ tag: 'text', attrs: { x: '50', y: '55', 'text-anchor': 'middle' }, children: [text('Tree & Weaver')] });
  const gradient = createBranch({ tag: 'linearGradient', attrs: { id: 'fade' }, children: [createShape('stop'), createShape('stop', { offset: '100%' })] });
  return createSvgTree('Logo', [createBranch({ tag: 'defs', children: [gradient] }), group, label], '0 0 100 100');
};

const strip = (tree: { root: Branch }, textIds = true) =>
  JSON.parse(JSON.stringify(tree.root, (key, value) => (!textIds && value?.kind === 'leaf' && value.type === 'text' ? { ...value, id: '' } : value)));

describe('SVG format', () => {
  it('exports a standalone SVG that opens again unchanged', () => {
    const tree = logo();
    const kit = createKit('Brand', '.x { fill: red; }');
    const svg = exportTree(tree, 'svg', [kit]);
    expect(svg).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>/);
    expect(svg).toMatch(/<svg [^>]*xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    expect(svg).toContain('viewBox="0 0 100 100"');
    expect(svg).toContain('<linearGradient');
    expect(svg).toContain('<style data-tw-styles="">');
    expect(detectFormat(svg)).toBe('svg');
    const doc = importDocument(svg, undefined, 'logo.svg');
    if (doc.kind !== 'tree') throw new Error('expected a tree');
    expect(doc.tree.name).toBe('Logo');
    expect(strip(doc.tree)).toEqual(strip(tree));
    expect(doc.kits.map((k) => [k.name, k.css])).toEqual([['Brand', '.x { fill: red; }']]);
  });

  it('round-trips SVG trees through every data format and HTML', () => {
    const tree = logo();
    for (const format of ['json', 'yaml', 'xml', 'html'] as const) {
      const doc = importDocument(exportTree(tree, format), format);
      if (doc.kind !== 'tree') throw new Error('expected a tree');
      // Published HTML writes text without the ids the editor gives text leaves.
      expect(strip(doc.tree, format !== 'html'), format).toEqual(strip(tree, format !== 'html'));
    }
  });

  it('exports the first <svg> branch of a page, and explains when there is none', () => {
    const page = createTree('Page');
    page.root.children.push(createBranch({ tag: 'p', children: [text('Intro')] }), createSvg([createShape('rect')]));
    expect(exportTree(page, 'svg')).toContain('<rect data-tw-leaf=');
    expect(() => exportTree(createTree('Empty'), 'svg')).toThrow(FormatError);
  });

  it('imports SVG files from other tools', () => {
    const file = `<?xml version="1.0"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:inkscape="http://www.inkscape.org" viewBox="0 0 24 24" inkscape:version="1.2">
  <title>Leaf icon</title>
  <style>.a { fill: green; }</style>
  <script>alert(1)</script>
  <metadata>junk</metadata>
  <defs><symbol id="dot"><circle r="2"/></symbol></defs>
  <g class="a" style="stroke: black" onclick="evil()">
    <path d="M2 2 L22 22" style="stroke-width: 2; fill: none" />
    <use xlink:href="#dot" x="4" y="4"/>
    <image xlink:href="leaf.png" width="8" height="8"/>
    <animate attributeName="href" to="javascript:alert(1)"/>
  </g>
</svg>`;
    expect(detectFormat(file)).toBe('svg');
    const doc = importDocument(file);
    if (doc.kind !== 'tree') throw new Error('expected a tree');
    const root = doc.tree.root;
    expect(doc.tree.name).toBe('Leaf icon');
    expect(root.tag).toBe('svg');
    expect(root.attrs).toEqual({ xmlns: 'http://www.w3.org/2000/svg', viewBox: '0 0 24 24' });
    expect(root.children.map((c) => (isBranch(c) ? c.tag : c.type))).toEqual(['title', 'defs', 'g']);
    const g = root.children[2] as Branch;
    expect(g.classes).toEqual(['a']);
    expect(g.styles).toEqual({ lg: { stroke: 'black' } });
    expect(g.attrs).toEqual({});
    const [path, use, image] = g.children as Leaf[];
    expect(path).toMatchObject({ type: 'shape', value: 'path', attrs: { d: 'M2 2 L22 22', 'stroke-width': '2', fill: 'none' } });
    expect(use).toMatchObject({ type: 'shape', value: 'use', attrs: { href: '#dot', x: '4', y: '4' } });
    expect(image).toMatchObject({ type: 'image', value: 'leaf.png', attrs: { width: '8', height: '8' } });
    expect(g.children).toHaveLength(3);
    expect(doc.kits.map((k) => k.css)).toEqual(['.a { fill: green; }']);
  });

  it('reads inline SVG in HTML with its SVG case', () => {
    const doc = importHtml('<body><p>Hi</p><svg viewBox="0 0 10 10"><linearGradient gradientUnits="userSpaceOnUse"><stop offset="0"/></linearGradient><rect width="5" height="5"/><text>Label</text></svg></body>');
    if (doc.kind !== 'tree') throw new Error('expected a tree');
    const svg = doc.tree.root.children[1] as Branch;
    expect(svg.tag).toBe('svg');
    expect(svg.attrs).toEqual({ viewBox: '0 0 10 10' });
    const [gradient, rect, label] = svg.children as [Branch, Leaf, Branch];
    expect(gradient).toMatchObject({ tag: 'linearGradient', attrs: { gradientUnits: 'userSpaceOnUse' } });
    expect(gradient.children[0]).toMatchObject({ type: 'shape', value: 'stop' });
    expect(rect).toMatchObject({ type: 'shape', value: 'rect', attrs: { width: '5', height: '5' } });
    expect(label.children[0]).toMatchObject({ type: 'text', value: 'Label' });
  });

  it('rejects files that are not SVG', () => {
    expect(() => importDocument('<html></html>', 'svg')).toThrow(FormatError);
  });
});
