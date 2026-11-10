import { createBranch, createLeaf, createTree } from './create';
import type { Branch, Leaf, Tree, TreeNode } from './model';
import { isBranch } from './model';

/**
 * SVG in Tree Weaver.
 *
 * - An **SVG tree** is a tree whose root branch is an `<svg>` (a drawing, an icon, a chart)
 *   instead of the page `<body>`. It exports to a standalone `.svg` file.
 * - An **SVG branch** is a container element: `svg`, `g`, `defs`, `symbol`, `a`, `text`,
 *   gradients, patterns, masks and the like. An `<svg>` branch can also sit inside any
 *   HTML tree, as inline SVG.
 * - An **SVG leaf** is a `shape` leaf: a drawn element with no children (`rect`, `circle`,
 *   `path`, a gradient `stop`, ...). Its `value` is the element name and its `attrs` the
 *   geometry and paint. Text inside an SVG `<text>` branch stays a text leaf, and an image
 *   leaf inside an SVG renders as `<image>`.
 *
 * Everything inside an `<svg>` branch, up to a `<foreignObject>`, is in "SVG context".
 */

export const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

/** SVG elements that hold other elements: they become branches. */
export const SVG_BRANCH_TAGS: readonly string[] = [
  'svg', 'g', 'defs', 'symbol', 'a', 'switch', 'text', 'tspan', 'textPath', 'title', 'desc',
  'clipPath', 'mask', 'pattern', 'marker', 'linearGradient', 'radialGradient', 'filter', 'foreignObject',
  'feMerge', 'feComponentTransfer', 'feDiffuseLighting', 'feSpecularLighting',
];

/** SVG elements drawn without children: they become shape leaves. */
export const SVG_SHAPE_TAGS: readonly string[] = [
  'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path', 'use', 'stop',
  'feBlend', 'feColorMatrix', 'feComposite', 'feDropShadow', 'feFlood', 'feGaussianBlur', 'feImage',
  'feMergeNode', 'feMorphology', 'feOffset', 'feTile', 'feTurbulence', 'feFuncR', 'feFuncG', 'feFuncB', 'feFuncA',
  'feDisplacementMap', 'feConvolveMatrix', 'fePointLight', 'feSpotLight', 'feDistantLight',
];

/** The shapes the editor offers, in palette order. */
export const SHAPES = ['rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path', 'use'] as const;
export type ShapeName = (typeof SHAPES)[number];

const SHAPE_SET = new Set(SVG_SHAPE_TAGS);
const BRANCH_SET = new Set(SVG_BRANCH_TAGS);

/** Elements whose name only exists in SVG (so not `a`, `title` or `image`'s HTML twin). */
const SVG_ONLY = new Set([...SVG_BRANCH_TAGS, ...SVG_SHAPE_TAGS].filter((t) => !['a', 'title', 'svg'].includes(t)));

const byLower = (names: readonly string[]) => new Map(names.map((n) => [n.toLowerCase(), n]));
const TAG_CASE = byLower([...SVG_BRANCH_TAGS, ...SVG_SHAPE_TAGS, 'image']);

/** SVG attributes that are camelCase. HTML parsers lowercase them; this puts the case back. */
const ATTR_CASE = byLower([
  'viewBox', 'preserveAspectRatio', 'gradientUnits', 'gradientTransform', 'spreadMethod', 'patternUnits',
  'patternContentUnits', 'patternTransform', 'clipPathUnits', 'maskUnits', 'maskContentUnits', 'markerUnits',
  'markerWidth', 'markerHeight', 'refX', 'refY', 'pathLength', 'textLength', 'lengthAdjust', 'startOffset',
  'filterUnits', 'primitiveUnits', 'stdDeviation', 'baseFrequency', 'numOctaves', 'stitchTiles', 'kernelMatrix',
  'kernelUnitLength', 'targetX', 'targetY', 'edgeMode', 'preserveAlpha', 'divisor', 'surfaceScale',
  'diffuseConstant', 'specularConstant', 'specularExponent', 'limitingConeAngle', 'pointsAtX', 'pointsAtY',
  'pointsAtZ', 'xChannelSelector', 'yChannelSelector', 'tableValues', 'keyPoints', 'keyTimes', 'keySplines',
  'requiredExtensions', 'systemLanguage', 'zoomAndPan',
]);

/** A tag in its canonical case: SVG names keep their camelCase (`linearGradient`), everything else is lowercase. */
export function canonicalTag(tag: string): string {
  const lower = tag.trim().toLowerCase();
  return TAG_CASE.get(lower) ?? lower;
}

/** An attribute name in its canonical SVG case (`viewbox` becomes `viewBox`). */
export function canonicalSvgAttr(name: string): string {
  return ATTR_CASE.get(name.toLowerCase()) ?? name;
}

export const isShapeTag = (tag: string): boolean => SHAPE_SET.has(canonicalTag(tag));
export const isSvgBranchTag = (tag: string): boolean => BRANCH_SET.has(canonicalTag(tag));

/** True for a tag that only exists in SVG, such as `g` or `linearGradient` (not `svg`, `a` or `title`). */
export const isSvgOnlyTag = (tag: string): boolean => SVG_ONLY.has(canonicalTag(tag));

/** True for a node that only makes sense inside an `<svg>`: a shape leaf or an SVG-only branch such as `g`. */
export function isSvgOnly(node: TreeNode): boolean {
  return isBranch(node) ? isSvgOnlyTag(node.tag) : node.type === 'shape';
}

/** Whether a tree is an SVG tree (a drawing), rather than a page. */
export const isSvgTree = (tree: Pick<Tree, 'root'>): boolean => isSvgRoot(tree.root);
export const isSvgRoot = (root: Branch): boolean => canonicalTag(root.tag) === 'svg';

/** Whether children of `branch` are drawn as SVG, given whether `branch` itself sits in SVG context. */
export function childrenInSvg(branch: Pick<Branch, 'tag'>, inSvg: boolean): boolean {
  const tag = canonicalTag(branch.tag);
  if (tag === 'svg') return true;
  if (tag === 'foreignObject') return false;
  return inSvg;
}

/** Whether the children of branch `id` are drawn as SVG (it is an `<svg>` or inside one, short of a `<foreignObject>`). */
export function inSvgContext(root: Branch, id: string): boolean {
  let result = false;
  const search = (branch: Branch, inSvg: boolean): boolean => {
    const inner = childrenInSvg(branch, inSvg);
    if (branch.id === id) {
      result = inner;
      return true;
    }
    return branch.children.some((c) => isBranch(c) && search(c, inner));
  };
  search(root, false);
  return result;
}

/**
 * Why `node` can't go into branch `parentId`, or `null` when it can. SVG shapes and
 * groups need an `<svg>` around them, and HTML elements can't be drawn inside one
 * (wrap them in a `<foreignObject>`).
 */
export function placementProblem(root: Branch, parentId: string, node: TreeNode): string | null {
  const svg = inSvgContext(root, parentId);
  if (svg) {
    if (isBranch(node) && !isSvgBranchTag(node.tag) && !isSvgOnly(node)) return `<${node.tag}> can't be drawn inside an SVG; add an SVG canvas branch for it, or put it in a <foreignObject>`;
    return null;
  }
  if (isSvgOnly(node)) return `${isBranch(node) ? `<${node.tag}>` : `A ${node.value} shape`} needs an SVG around it; add an SVG canvas first and drop it inside`;
  return null;
}

/** The attributes the editor shows for each shape, in order. */
export const SHAPE_GEOMETRY: Record<string, readonly string[]> = {
  rect: ['x', 'y', 'width', 'height', 'rx', 'ry'],
  circle: ['cx', 'cy', 'r'],
  ellipse: ['cx', 'cy', 'rx', 'ry'],
  line: ['x1', 'y1', 'x2', 'y2'],
  polyline: ['points'],
  polygon: ['points'],
  path: ['d'],
  use: ['href', 'x', 'y', 'width', 'height'],
  stop: ['offset', 'stop-color', 'stop-opacity'],
};

/** Presentation attributes the editor offers on every shape. */
export const SHAPE_PAINT: readonly string[] = ['fill', 'stroke', 'stroke-width', 'opacity', 'transform'];

/** Starting attributes for a new shape, sized for a 200 × 200 viewBox. */
export function defaultShapeAttrs(shape: string): Record<string, string> {
  const paint = { fill: '#2f6f4f', stroke: 'none' };
  switch (canonicalTag(shape)) {
    case 'rect':
      return { x: '20', y: '20', width: '160', height: '100', rx: '8', ...paint };
    case 'circle':
      return { cx: '100', cy: '100', r: '60', ...paint };
    case 'ellipse':
      return { cx: '100', cy: '100', rx: '80', ry: '50', ...paint };
    case 'line':
      return { x1: '20', y1: '20', x2: '180', y2: '180', stroke: '#2f6f4f', 'stroke-width': '4' };
    case 'polyline':
      return { points: '20,160 70,60 120,120 180,40', fill: 'none', stroke: '#2f6f4f', 'stroke-width': '4' };
    case 'polygon':
      return { points: '100,20 180,180 20,180', ...paint };
    case 'path':
      return { d: 'M20 150 C 60 20, 140 20, 180 150 Z', ...paint };
    case 'use':
      return { href: '#', x: '0', y: '0' };
    case 'stop':
      return { offset: '0%', 'stop-color': '#2f6f4f' };
    default:
      return {};
  }
}

/** A new shape leaf, e.g. `createShape('circle')`. Attributes default to a visible shape. */
export function createShape(shape: string, attrs?: Record<string, string>): Leaf {
  const name = canonicalTag(shape);
  return createLeaf(name, 'shape', attrs ?? defaultShapeAttrs(name));
}

/** A new `<svg>` branch: a drawing area with a `viewBox`, scaling to the width it is given. */
export function createSvg(children: TreeNode[] = [], viewBox = '0 0 200 200', name = 'SVG'): Branch {
  return createBranch({
    tag: 'svg',
    type: 'svg',
    name,
    attrs: { xmlns: SVG_NAMESPACE, viewBox },
    styles: { lg: { display: 'block', width: '100%', 'max-width': '480px', height: 'auto' } },
    children,
  });
}

/** A new SVG tree: a drawing whose root is an `<svg>` instead of the page body. */
export function createSvgTree(name = 'Untitled drawing', children: TreeNode[] = [], viewBox = '0 0 800 600'): Tree {
  const root = createSvg(children, viewBox, 'Drawing');
  root.type = 'root';
  root.styles = { lg: { display: 'block', width: '100%', height: 'auto' } };
  return createTree(name, root);
}
