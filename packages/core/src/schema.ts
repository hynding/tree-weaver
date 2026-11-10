import { DISPLAY_IDS } from './displays';
import { SCHEMA_VERSION } from './model';

/**
 * The JSON Schema (draft 2020-12) for Tree Weaver documents, as written to JSON and YAML.
 *
 * It describes the canonical form: what Tree Weaver writes, and what agents and other
 * tools should write. Ids, timestamps and `kind` are optional because the importer fills
 * them in. The importer also accepts a few aliases (`class`, `text`, `src`, the `base`
 * display); `validateDocument` warns about those instead of rejecting them.
 *
 * The same object is committed as `schema/tree-weaver-v1.schema.json` (run `pnpm schema`
 * after changing it) and published with the web app at `SCHEMA_URL`.
 */

export const SCHEMA_URL = 'https://hynding.github.io/tree-weaver/schema/tree-weaver-v1.schema.json';

/** Tags that render as a plain `div` because they could run or embed foreign content. */
export const BLOCKED_TAGS: readonly string[] = [
  'script', 'style', 'iframe', 'object', 'embed', 'frame', 'frameset', 'base', 'meta', 'link',
  // SVG animation can rewrite attributes (an href to a script URL) after rendering.
  'animate', 'set', 'animatemotion', 'animatetransform', 'handler', 'listener',
];


const ref = (name: string) => ({ $ref: `#/$defs/${name}` });
const str = (description: string) => ({ type: 'string', description });

export const TREE_WEAVER_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: SCHEMA_URL,
  title: 'Tree Weaver document',
  description:
    'A Tree Weaver forest (project) or tree (layout), made of branches (elements) and leaves (text, images or SVG shapes). ' +
    'Files usually use the envelope { "format": "tree-weaver", "version": 1, "forest" | "tree": ... }; ' +
    'a bare forest, tree or branch is accepted too.',
  anyOf: [ref('forestEnvelope'), ref('treeEnvelope'), ref('forest'), ref('tree'), ref('branch')],
  $defs: {
    forestEnvelope: {
      type: 'object',
      description: 'A file holding a whole forest.',
      required: ['format', 'forest'],
      additionalProperties: false,
      properties: {
        $schema: { type: 'string' },
        format: { const: 'tree-weaver' },
        version: { type: 'integer', minimum: 1, maximum: SCHEMA_VERSION },
        forest: ref('forest'),
      },
    },
    treeEnvelope: {
      type: 'object',
      description: 'A file holding one tree and the design kits it uses.',
      required: ['format', 'tree'],
      additionalProperties: false,
      properties: {
        $schema: { type: 'string' },
        format: { const: 'tree-weaver' },
        version: { type: 'integer', minimum: 1, maximum: SCHEMA_VERSION },
        tree: ref('tree'),
        kits: { type: 'array', items: ref('kit') },
      },
    },
    forest: {
      type: 'object',
      description: 'A project: trees plus the design kits they share. Kits load in order; later kits override earlier ones.',
      required: ['trees'],
      additionalProperties: false,
      properties: {
        id: str('Optional. Filled in on import.'),
        name: str('Shown in the editor. Defaults to "Untitled forest".'),
        version: { const: SCHEMA_VERSION },
        trees: { type: 'array', items: ref('tree') },
        kits: { type: 'array', items: ref('kit') },
        createdAt: str('ISO 8601 timestamp. Optional.'),
        updatedAt: str('ISO 8601 timestamp. Optional.'),
      },
    },
    tree: {
      type: 'object',
      description: 'One layout: a page, a screen or a reusable section, or an SVG drawing when its root is an <svg>.',
      required: ['root'],
      additionalProperties: false,
      properties: {
        id: str('Optional. Filled in on import.'),
        name: str('Shown in the editor. Defaults to "Untitled tree".'),
        root: {
          allOf: [ref('branch')],
          description: 'The page body, which renders as <body> whatever its tag; or, with "tag": "svg", the root of an SVG tree (a drawing).',
        },
        createdAt: str('ISO 8601 timestamp. Optional.'),
        updatedAt: str('ISO 8601 timestamp. Optional.'),
      },
    },
    node: {
      description: 'A branch, a leaf, or a string (shorthand for a text leaf).',
      anyOf: [{ type: 'string' }, ref('branch'), ref('leaf')],
    },
    branch: {
      type: 'object',
      description: 'A component: an HTML or SVG element with classes, attributes, per-display styles and children.',
      additionalProperties: false,
      anyOf: [{ required: ['kind'] }, { required: ['tag'] }, { required: ['children'] }],
      properties: {
        kind: { const: 'branch' },
        id: str('Optional, unique within the forest. Filled in on import.'),
        tag: {
          type: 'string',
          description:
            'HTML tag, lowercase, or an SVG container tag in its own case ("svg", "g", "defs", "linearGradient"). ' +
            'Defaults to "div". Script-like and animation tags are not allowed.',
          pattern: '^[a-z][a-zA-Z0-9-]*$',
          not: { enum: [...BLOCKED_TAGS, 'animateMotion', 'animateTransform'] },
        },
        type: str('Optional catalog type the branch came from, such as "grid", "flex-row" or "table".'),
        name: str('Optional friendly name shown in the outline.'),
        classes: { type: 'array', items: { type: 'string', pattern: '^\\S+$' }, uniqueItems: true },
        attrs: ref('attrs'),
        styles: ref('displayStyles'),
        children: { type: 'array', items: ref('node') },
      },
    },
    leaf: {
      type: 'object',
      description:
        'Content: text; an image whose value is its URL; or an SVG shape whose value is the element name ' +
        '("rect", "circle", "ellipse", "line", "polyline", "polygon", "path", "use", "stop", ...) and whose attrs are its geometry and paint. ' +
        'Shapes belong inside an <svg> branch.',
      required: ['value'],
      additionalProperties: false,
      properties: {
        kind: { const: 'leaf' },
        id: str('Optional. Filled in on import.'),
        type: { enum: ['text', 'image', 'shape'], default: 'text' },
        value: str('The text, the image URL, or the shape element name.'),
        attrs: ref('attrs'),
      },
    },
    attrs: {
      type: 'object',
      description: 'HTML or SVG attributes (SVG names keep their case, e.g. "viewBox"). Event handlers (on*) and style are not allowed: use styles instead.',
      propertyNames: { pattern: '^(?![oO][nN])(?![sS][tT][yY][lL][eE]$)[a-zA-Z_:][a-zA-Z0-9_.:-]*$' },
      additionalProperties: { type: 'string' },
    },
    displayId: {
      enum: [...DISPLAY_IDS],
      description:
        'lg = desktop large (the base every display inherits), xl = desktop XL, tablet, ' +
        'mobile-landscape and mobile-portrait (both inherit tablet).',
    },
    displayStyles: {
      type: 'object',
      description: 'CSS declarations per display. Put shared styles on lg and only the differences on other displays.',
      propertyNames: ref('displayId'),
      additionalProperties: ref('styleMap'),
    },
    styleMap: {
      type: 'object',
      description: 'CSS declarations keyed by kebab-case property, e.g. { "grid-template-columns": "1fr 1fr" }. Values are strings with units.',
      propertyNames: { pattern: '^(--[A-Za-z0-9_-]+|-?[a-z][a-z0-9-]*)$' },
      additionalProperties: { type: 'string', pattern: '^[^{};]*$' },
    },
    kit: {
      type: 'object',
      description: 'A design kit: CSS inlined in css, a stylesheet linked by href, or editable rules.',
      additionalProperties: false,
      properties: {
        id: str('Optional. Filled in on import.'),
        name: str('Shown in the editor.'),
        css: str('Raw CSS. For a linked kit, a snapshot used to list its classes.'),
        enabled: { type: 'boolean', default: true },
        source: str('Where the kit came from: a file name, a URL, "builtin", "custom" or "env".'),
        href: { type: 'string', pattern: '^https?://[^\\s"\'<>]+$', description: 'Stylesheet URL for a linked kit.' },
        rules: { type: 'array', items: ref('styleRule'), description: 'Editable rules. When present, css is generated from them.' },
      },
    },
    styleRule: {
      type: 'object',
      description: 'A custom CSS rule: any selector with per-display declarations.',
      required: ['selector'],
      additionalProperties: false,
      properties: {
        id: str('Optional. Filled in on import.'),
        selector: { type: 'string', pattern: '^[^{};@]+$' },
        styles: ref('displayStyles'),
      },
    },
  },
} as const;
