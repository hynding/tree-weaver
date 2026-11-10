import { describe, expect, it } from 'vitest';
import {
  canonicalSvgAttr,
  canonicalTag,
  createBranch,
  createShape,
  createSvg,
  createSvgTree,
  createTree,
  inSvgContext,
  isSvgTree,
  normalizeTree,
  placementProblem,
  renderDocument,
  renderNodeHtml,
  renderTreeBody,
  safeTag,
  text,
  validateDocument,
} from './index';

const drawing = () => {
  const circle = createShape('circle', { cx: '50', cy: '50', r: '40', fill: 'tomato' });
  const label = createBranch({ tag: 'text', attrs: { x: '50', y: '55' }, children: [text('Hi & bye')] });
  const gradient = createBranch({ tag: 'linearGradient', attrs: { id: 'fade', gradientUnits: 'userSpaceOnUse' }, children: [createShape('stop'), createShape('stop', { offset: '100%', 'stop-color': '#fff' })] });
  const defs = createBranch({ tag: 'defs', children: [gradient] });
  const group = createBranch({ tag: 'g', name: 'Badge', styles: { lg: { fill: 'navy' }, tablet: { opacity: '0.5' } }, children: [circle, label] });
  return { circle, label, group, defs, tree: createSvgTree('Logo', [defs, group], '0 0 100 100') };
};

describe('SVG names', () => {
  it('keeps the case of SVG tags and attributes', () => {
    expect(canonicalTag('LINEARGRADIENT')).toBe('linearGradient');
    expect(canonicalTag('DIV')).toBe('div');
    expect(canonicalSvgAttr('viewbox')).toBe('viewBox');
    expect(canonicalSvgAttr('data-x')).toBe('data-x');
    expect(safeTag('clippath')).toBe('clipPath');
  });

  it('blocks SVG animation, which can rewrite attributes after rendering', () => {
    for (const tag of ['animate', 'set', 'animateTransform', 'animatemotion', 'script']) expect(safeTag(tag)).toBe('div');
  });
});

describe('SVG trees', () => {
  it('render the <svg> root inside the body', () => {
    const { tree } = drawing();
    expect(isSvgTree(tree)).toBe(true);
    const html = renderDocument(tree);
    expect(html).toMatch(/<body>\s*<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 100 100"|<body>\s*<svg data-tw=/);
    expect(html).toContain('<linearGradient');
    expect(html).toContain('gradientUnits="userSpaceOnUse"');
    expect(html).toContain('<circle data-tw-leaf=');
    expect(html).toContain('Hi &amp; bye');
    // Branch styles work on SVG elements too, per display.
    expect(html).toMatch(/\[data-tw="[^"]+"\] \{\n {2}fill: navy;/);
  });

  it('survive normalizing, and other roots still become <body>', () => {
    const { tree } = drawing();
    const again = normalizeTree(JSON.parse(JSON.stringify(tree)));
    expect(again).toEqual(tree);
    expect(normalizeTree({ root: { tag: 'main' } }).root.tag).toBe('body');
  });

  it('use <tspan> for selectable text and <image> for images inside a drawing', () => {
    const { tree } = drawing();
    tree.root.children.push({ kind: 'leaf', id: 'l_img', type: 'image', value: 'cat.png', attrs: { alt: 'Cat', width: '20' } });
    const body = renderTreeBody(tree.root, { designer: true });
    expect(body).toContain('<tspan data-tw-leaf=');
    expect(body).not.toContain('<span');
    expect(body).toContain('<image data-tw-leaf="l_img" href="cat.png" width="20"/>');
  });

  it('write empty attributes with a value in XML mode', () => {
    const svg = createSvg([createShape('rect')]);
    svg.attrs = { viewBox: '0 0 10 10', 'data-flag': '' };
    expect(renderNodeHtml(svg, { xml: true })).toContain('data-flag=""');
  });
});

describe('SVG placement', () => {
  it('knows which branches draw SVG', () => {
    const { tree, group, defs } = drawing();
    expect(inSvgContext(tree.root, group.id)).toBe(true);
    expect(inSvgContext(tree.root, defs.id)).toBe(true);
    const page = createTree('Page');
    const svg = createSvg();
    const foreign = createBranch({ tag: 'foreignObject' });
    svg.children.push(foreign);
    page.root.children.push(svg);
    expect(inSvgContext(page.root, page.root.id)).toBe(false);
    expect(inSvgContext(page.root, svg.id)).toBe(true);
    expect(inSvgContext(page.root, foreign.id)).toBe(false);
  });

  it('keeps shapes in drawings and HTML out of them', () => {
    const page = createTree('Page');
    const svg = createSvg();
    page.root.children.push(svg);
    expect(placementProblem(page.root, page.root.id, createShape('circle'))).toMatch(/needs an SVG/);
    expect(placementProblem(page.root, page.root.id, createBranch({ tag: 'g' }))).toMatch(/needs an SVG/);
    expect(placementProblem(page.root, page.root.id, createSvg())).toBeNull();
    expect(placementProblem(page.root, svg.id, createShape('circle'))).toBeNull();
    expect(placementProblem(page.root, svg.id, createBranch({ tag: 'g' }))).toBeNull();
    expect(placementProblem(page.root, svg.id, text('label'))).toBeNull();
    expect(placementProblem(page.root, svg.id, createBranch({ tag: 'div' }))).toMatch(/can't be drawn/);
  });
});

describe('validating SVG', () => {
  it('accepts an SVG tree with shapes', () => {
    const { tree } = drawing();
    const result = validateDocument({ format: 'tree-weaver', version: 1, tree: JSON.parse(JSON.stringify(tree)) });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('reports shapes in the wrong place and unknown shapes', () => {
    const result = validateDocument({
      tree: {
        root: {
          tag: 'body',
          children: [
            { type: 'shape', value: 'circle', attrs: { r: '4', class: 'dot' } },
            { tag: 'svg', children: [{ type: 'shape', value: 'blob' }, { tag: 'div' }, { tag: 'circle' }, { tag: 'animate' }] },
          ],
        },
      },
    });
    expect(result.warnings.map((w) => w.path)).toEqual(
      expect.arrayContaining(['tree.root.children[0]', 'tree.root.children[1].children[1].tag']),
    );
    expect(result.errors.map((e) => e.path)).toEqual([
      'tree.root.children[1].children[0].value',
      'tree.root.children[1].children[2].tag',
      'tree.root.children[1].children[3].tag',
    ]);
  });
});
