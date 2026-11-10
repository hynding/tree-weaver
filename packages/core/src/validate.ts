import { DISPLAY_IDS, isDisplayId } from './displays';
import { SCHEMA_VERSION } from './model';
import { VOID_TAGS } from './ops';
import { isSafeAttr, isSafeCssProp } from './render';
import { BLOCKED_TAGS } from './schema';
import { canonicalTag, childrenInSvg, isShapeTag, isSvgBranchTag, isSvgOnlyTag, SHAPES } from './svg';

/**
 * Strict checking of Tree Weaver data, for agents and tools that write it.
 *
 * `normalize*` is lenient on purpose: it fills in ids, drops what it doesn't understand
 * and never complains, so anything can be opened in the editor. That hides mistakes from
 * whoever wrote the data. `validateDocument` reports them instead, each with the path to
 * the problem and a hint on how to fix it.
 *
 * - **Errors** are things that would be dropped, changed or rendered differently from
 *   what the author meant (an unknown display, a camelCase CSS property, an `onclick`).
 * - **Warnings** are things the importer accepts but that are not canonical or are
 *   likely mistakes (aliases, unknown keys, duplicate ids, images without `alt`).
 *
 * A document with no errors imports exactly as written.
 */

export type IssueSeverity = 'error' | 'warning';

export interface ValidationIssue {
  severity: IssueSeverity;
  /** Where the problem is, e.g. `forest.trees[0].root.children[2].styles.tablet`. */
  path: string;
  message: string;
  /** How to fix it. */
  hint?: string;
}

export type DocumentKind = 'forest' | 'tree' | 'branch';

export interface ValidationResult {
  /** True when there are no errors. Warnings don't make a document invalid. */
  valid: boolean;
  /** What the document holds, when that could be worked out. */
  kind: DocumentKind | null;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  /** Number of branches and leaves checked. */
  counts: { trees: number; branches: number; leaves: number };
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const typeName = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'a list' : typeof v);
const DISPLAY_LIST = DISPLAY_IDS.join(', ');
const BLOCKED = new Set(BLOCKED_TAGS);
const TAG = /^[a-z][a-zA-Z0-9-]*$/;

const ENVELOPE_KEYS = new Set(['$schema', 'format', 'version', 'forest', 'tree', 'kits']);
const FOREST_KEYS = new Set(['id', 'name', 'version', 'trees', 'kits', 'createdAt', 'updatedAt']);
const TREE_KEYS = new Set(['id', 'name', 'root', 'createdAt', 'updatedAt']);
const BRANCH_KEYS = new Set(['kind', 'id', 'tag', 'type', 'name', 'classes', 'attrs', 'styles', 'children']);
const LEAF_KEYS = new Set(['kind', 'id', 'type', 'value', 'attrs']);
const KIT_KEYS = new Set(['id', 'name', 'css', 'enabled', 'source', 'href', 'rules']);
const RULE_KEYS = new Set(['id', 'selector', 'styles']);

/** Turn `gridTemplateColumns` into `grid-template-columns`. */
const kebab = (prop: string) => prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

class Checker {
  readonly errors: ValidationIssue[] = [];
  readonly warnings: ValidationIssue[] = [];
  readonly counts = { trees: 0, branches: 0, leaves: 0 };
  private readonly nodeIds = new Map<string, string>();

  error(path: string, message: string, hint?: string) {
    this.errors.push(hint ? { severity: 'error', path, message, hint } : { severity: 'error', path, message });
  }

  warn(path: string, message: string, hint?: string) {
    this.warnings.push(hint ? { severity: 'warning', path, message, hint } : { severity: 'warning', path, message });
  }

  unknownKeys(value: Obj, allowed: Set<string>, path: string, what: string, aliases: Record<string, string> = {}) {
    for (const key of Object.keys(value)) {
      if (allowed.has(key) || key in aliases) continue;
      this.warn(path === '$' ? key : `${path}.${key}`, `Unknown ${what} field "${key}" is ignored`, `Allowed fields: ${[...allowed].join(', ')}`);
    }
  }

  optionalString(value: Obj, key: string, path: string) {
    const v = value[key];
    if (v === undefined || typeof v === 'string') return;
    if (typeof v === 'number' || typeof v === 'boolean') {
      this.warn(`${path}.${key}`, `"${key}" should be a string, not ${typeName(v)}`, `Write it as "${String(v)}"`);
    } else {
      this.error(`${path}.${key}`, `"${key}" must be a string, not ${typeName(v)}`);
    }
  }

  id(value: Obj, path: string) {
    this.optionalString(value, 'id', path);
    const id = value.id;
    if (typeof id !== 'string' && typeof id !== 'number') return;
    const key = String(id);
    if (!key) return;
    const first = this.nodeIds.get(key);
    if (first) {
      this.warn(`${path}.id`, `Duplicate id "${key}" (first used at ${first}); a new id will be generated`, 'Give every branch and leaf a unique id, or leave ids out');
    } else {
      this.nodeIds.set(key, path);
    }
  }

  /** The envelope, or a bare forest, tree or branch. */
  document(value: unknown, path: string): DocumentKind | null {
    if (!isObj(value)) {
      this.error(path, `Expected a Tree Weaver object, got ${typeName(value)}`, 'Start from { "format": "tree-weaver", "version": 1, "tree": { "root": { ... } } }');
      return null;
    }
    const isEnvelope = value.format !== undefined || value.forest !== undefined || value.tree !== undefined;
    if (isEnvelope) {
      if (value.format === undefined) this.warn(path, 'Missing "format"', 'Add "format": "tree-weaver"');
      else if (value.format !== 'tree-weaver') this.error('format', `Unsupported format "${String(value.format)}"`, 'Use "format": "tree-weaver"');
      if (value.version !== undefined) {
        if (typeof value.version !== 'number' || !Number.isInteger(value.version) || value.version < 1) {
          this.error('version', '"version" must be a whole number', `Use "version": ${SCHEMA_VERSION}`);
        } else if (value.version > SCHEMA_VERSION) {
          this.error('version', `Version ${value.version} is newer than this Tree Weaver understands (${SCHEMA_VERSION})`);
        }
      }
      this.unknownKeys(value, ENVELOPE_KEYS, path, 'envelope');
      if (value.forest !== undefined && value.tree !== undefined) {
        this.error(path, 'A document holds a forest or a tree, not both', 'Put the tree inside forest.trees');
      }
      if (value.forest !== undefined) {
        if (value.kits !== undefined) this.warn('kits', 'Top-level "kits" is ignored next to a forest', 'Move them into forest.kits');
        this.forest(value.forest, 'forest');
        return 'forest';
      }
      if (value.tree !== undefined) {
        this.kits(value.kits, 'kits');
        this.tree(value.tree, 'tree');
        return 'tree';
      }
      this.error(path, 'The envelope has no "forest" or "tree"', 'Add "tree": { "root": { ... } } or "forest": { "trees": [ ... ] }');
      return null;
    }
    if (value.trees !== undefined) {
      this.forest(value, 'forest');
      return 'forest';
    }
    if (value.root !== undefined) {
      this.tree(value, 'tree');
      return 'tree';
    }
    if (value.kind === 'branch' || value.tag !== undefined || value.children !== undefined) {
      this.node(value, 'branch');
      return 'branch';
    }
    this.error(path, 'Could not find a forest, tree or branch', 'Use the envelope { "format": "tree-weaver", "version": 1, "tree": { "root": { ... } } }');
    return null;
  }

  forest(value: unknown, path: string) {
    if (!isObj(value)) return this.error(path, `Expected a forest object, got ${typeName(value)}`);
    this.unknownKeys(value, FOREST_KEYS, path, 'forest');
    this.optionalString(value, 'id', path);
    this.optionalString(value, 'name', path);
    if (value.version !== undefined && value.version !== SCHEMA_VERSION) {
      this.warn(`${path}.version`, `Forest version ${String(value.version)} is not ${SCHEMA_VERSION}; it will be read as ${SCHEMA_VERSION}`);
    }
    if (value.trees === undefined) this.warn(path, 'The forest has no "trees"', 'Add "trees": [ { "name": "Home", "root": { ... } } ]');
    else if (!Array.isArray(value.trees)) this.error(`${path}.trees`, `"trees" must be a list, not ${typeName(value.trees)}`);
    else {
      const treeIds = new Map<string, number>();
      value.trees.forEach((t, i) => {
        const id = isObj(t) && typeof t.id === 'string' ? t.id : '';
        if (id && treeIds.has(id)) this.warn(`${path}.trees[${i}].id`, `Duplicate tree id "${id}"; a new id will be generated`);
        if (id) treeIds.set(id, i);
        this.tree(t, `${path}.trees[${i}]`);
      });
    }
    this.kits(value.kits, `${path}.kits`);
  }

  tree(value: unknown, path: string) {
    if (!isObj(value)) return this.error(path, `Expected a tree object, got ${typeName(value)}`);
    this.counts.trees++;
    this.unknownKeys(value, TREE_KEYS, path, 'tree');
    this.optionalString(value, 'id', path);
    this.optionalString(value, 'name', path);
    if (value.root === undefined) {
      this.warn(path, 'The tree has no "root"; it will be empty', 'Add "root": { "tag": "body", "children": [ ... ] }');
      return;
    }
    const root = value.root;
    if (typeof root === 'string' || (isObj(root) && (root.kind === 'leaf' || (root.kind === undefined && root.tag === undefined && root.children === undefined)))) {
      this.error(`${path}.root`, 'A tree root must be a branch, not a leaf', 'Wrap the content: "root": { "tag": "body", "children": [ ... ] }');
      return;
    }
    if (isObj(root) && typeof root.tag === 'string' && root.tag.toLowerCase() !== 'body' && root.tag !== 'svg') {
      this.warn(`${path}.root.tag`, `The root renders as <body>, not <${root.tag}>`, 'Use "tag": "body" on the root and put a <main> or <div> inside it, or "tag": "svg" for an SVG tree (a drawing)');
    }
    this.node(root, `${path}.root`, true);
  }

  /** `inSvg`: whether the node sits inside an `<svg>` branch. */
  node(value: unknown, path: string, isRoot = false, inSvg = false) {
    if (typeof value === 'string') {
      this.counts.leaves++;
      return;
    }
    if (!isObj(value)) return this.error(path, `Expected a branch, a leaf or a string, got ${typeName(value)}`);
    const kind = value.kind ?? (value.tag !== undefined || value.children !== undefined ? 'branch' : 'leaf');
    if (kind === 'branch') return this.branch(value, path, isRoot, inSvg);
    if (kind === 'leaf') return this.leaf(value, path, inSvg);
    this.error(`${path}.kind`, `Unknown node kind "${String(kind)}"`, 'Use "branch" for elements or "leaf" for text and images');
  }

  branch(value: Obj, path: string, isRoot: boolean, inSvg = false) {
    this.counts.branches++;
    this.unknownKeys(value, BRANCH_KEYS, path, 'branch', { class: 'classes' });
    this.id(value, path);
    this.optionalString(value, 'type', path);
    this.optionalString(value, 'name', path);

    let tag = 'div';
    if (value.tag !== undefined) {
      if (typeof value.tag !== 'string') {
        this.error(`${path}.tag`, `"tag" must be a string, not ${typeName(value.tag)}`);
      } else {
        tag = canonicalTag(value.tag);
        if (!TAG.test(tag)) {
          this.error(`${path}.tag`, `"${value.tag}" is not a valid tag; it will render as <div>`, 'Use a lowercase HTML tag such as "section", "div" or "h2"');
        } else if (BLOCKED.has(tag.toLowerCase())) {
          this.error(
            `${path}.tag`,
            `<${tag}> is not allowed; it will render as <div>`,
            tag === 'style' || tag === 'link' ? 'Put CSS in a design kit (forest.kits) instead' : /^(animate|set)/i.test(tag) ? 'SVG animation is not supported; animate with CSS in a design kit' : 'Scripts and embedded documents are not supported',
          );
        } else if (tag !== value.tag) {
          this.warn(`${path}.tag`, `"${value.tag}" will be read as "${tag}"`, isSvgBranchTag(tag) ? 'SVG tags keep their own case' : 'HTML tags are lowercase');
        } else if (isShapeTag(tag)) {
          this.error(`${path}.tag`, `<${tag}> is an SVG shape, which is a leaf`, `Write { "type": "shape", "value": "${tag}", "attrs": { ... } }`);
        }
        if (!isRoot && TAG.test(tag)) {
          if (inSvg && !isSvgBranchTag(tag) && !isSvgOnlyTag(tag)) {
            this.warn(`${path}.tag`, `<${tag}> is not drawn inside an SVG`, 'Use SVG elements here, or wrap HTML in a "foreignObject" branch');
          } else if (!inSvg && isSvgOnlyTag(tag)) {
            this.warn(`${path}.tag`, `<${tag}> only works inside an SVG`, 'Put it inside a branch with "tag": "svg"');
          }
        }
      }
    }

    if (value.class !== undefined) {
      this.warn(`${path}.class`, '"class" is an alias', value.classes === undefined ? 'Use "classes": [ ... ] (a list)' : 'Remove "class"; "classes" is used');
    }
    const classes = value.classes ?? value.class;
    if (classes !== undefined) {
      const at = `${path}.${value.classes !== undefined ? 'classes' : 'class'}`;
      if (typeof classes === 'string') {
        if (value.classes !== undefined) this.warn(at, '"classes" should be a list', `Write it as ${JSON.stringify(classes.split(/\s+/).filter(Boolean))}`);
      } else if (!Array.isArray(classes)) {
        this.error(at, `"classes" must be a list of class names, not ${typeName(classes)}`);
      } else {
        classes.forEach((c, i) => {
          if (typeof c !== 'string') this.error(`${at}[${i}]`, `Class names must be strings, not ${typeName(c)}`);
          else if (c.startsWith('.')) this.error(`${at}[${i}]`, `Class "${c}" starts with a dot`, `Write it as "${c.slice(1)}"`);
          else if (/\s/.test(c.trim())) this.warn(`${at}[${i}]`, `"${c}" holds several classes`, 'Put each class in its own list item');
        });
      }
    }

    this.attrs(value.attrs, `${path}.attrs`);
    this.styles(value.styles, `${path}.styles`);

    if (value.children !== undefined) {
      if (!Array.isArray(value.children)) {
        this.error(`${path}.children`, `"children" must be a list, not ${typeName(value.children)}`);
      } else {
        if (!isRoot && VOID_TAGS.has(tag) && value.children.length) {
          this.error(`${path}.children`, `<${tag}> can't hold children`, tag === 'img' ? 'Use an image leaf: { "type": "image", "value": "<url>", "attrs": { "alt": "..." } }' : `Move the children out of the <${tag}>`);
        }
        const childSvg = childrenInSvg({ tag }, inSvg);
        value.children.forEach((c, i) => this.node(c, `${path}.children[${i}]`, false, childSvg));
      }
    }
  }

  leaf(value: Obj, path: string, inSvg = false) {
    this.counts.leaves++;
    this.unknownKeys(value, LEAF_KEYS, path, 'leaf', { text: 'value', src: 'value' });
    this.id(value, path);
    if (value.type !== undefined && value.type !== 'text' && value.type !== 'image' && value.type !== 'shape') {
      this.error(`${path}.type`, `Unknown leaf type "${String(value.type)}"; it will be read as text`, 'Use "text", "image" or "shape"');
    }
    if (value.type === 'shape' && typeof value.value === 'string') {
      if (!isShapeTag(value.value)) {
        this.error(`${path}.value`, `"${value.value}" is not an SVG shape; it will render as an empty group`, `Use one of: ${SHAPES.join(', ')}, stop, or a filter primitive such as feGaussianBlur`);
      } else if (canonicalTag(value.value) !== value.value) {
        this.warn(`${path}.value`, `"${value.value}" will be read as "${canonicalTag(value.value)}"`);
      }
      if (!inSvg) this.warn(path, 'A shape is only drawn inside an SVG', 'Put it inside a branch with "tag": "svg"');
    }
    for (const alias of ['text', 'src'] as const) {
      if (value[alias] !== undefined) this.warn(`${path}.${alias}`, `"${alias}" is an alias`, value.value === undefined ? 'Use "value"' : `Remove "${alias}"; "value" is used`);
    }
    const content = value.value ?? value.text ?? value.src;
    if (content === undefined) {
      this.error(path, 'The leaf has no "value"; it will be empty', 'Add "value": the text, or the image URL');
    } else if (typeof content !== 'string') {
      if (typeof content === 'number' || typeof content === 'boolean') this.warn(`${path}.value`, '"value" should be a string', `Write it as "${String(content)}"`);
      else this.error(`${path}.value`, `"value" must be a string, not ${typeName(content)}`);
    }
    if (value.children !== undefined) this.error(`${path}.children`, 'A leaf has no children', 'Make it a branch with "kind": "branch" and a "tag"');
    this.attrs(value.attrs, `${path}.attrs`, value.type === 'shape');
    if (value.type === 'image') {
      const alt = isObj(value.attrs) ? value.attrs.alt : undefined;
      if (alt === undefined && !inSvg) this.warn(`${path}.attrs`, 'The image has no alt text', 'Add "attrs": { "alt": "what the image shows" } (use "" for decorative images)');
      if (typeof content === 'string' && /^\s*(javascript|vbscript|data:text\/html)/i.test(content)) {
        this.error(`${path}.value`, 'The image URL is not allowed', 'Use an http(s) URL, a relative path or a data:image URL');
      }
    }
  }

  /** `classAllowed`: shapes are leaves with no class list, so they carry `class` as an attribute. */
  attrs(value: unknown, path: string, classAllowed = false) {
    if (value === undefined) return;
    if (!isObj(value)) return this.error(path, `"attrs" must be an object of attribute names to values, not ${typeName(value)}`);
    for (const [name, v] of Object.entries(value)) {
      const at = `${path}.${name}`;
      if (v === null || (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean')) {
        this.error(at, `Attribute values must be strings, not ${typeName(v)}`);
        continue;
      }
      if (typeof v !== 'string') this.warn(at, 'Attribute values should be strings', `Write it as "${String(v)}"`);
      const lower = name.toLowerCase();
      if (lower === 'style') this.error(at, 'The style attribute is not rendered', 'Move the declarations into "styles": { "lg": { ... } }');
      else if (lower === 'class' && !classAllowed) this.error(at, 'class is not an attribute here', 'Use "classes": [ ... ] on the branch');
      else if (lower.startsWith('on')) this.error(at, `Event handler "${name}" is not rendered`, 'Trees are static markup; add behaviour in the app that uses the exported HTML');
      else if (!isSafeAttr(name, String(v))) this.error(at, `Attribute "${name}" is not rendered`, /^\s*(javascript|vbscript)/i.test(String(v)) ? 'Script URLs are not allowed' : 'Use a plain attribute name such as "href", "aria-label" or "data-id"');
    }
  }

  styles(value: unknown, path: string) {
    if (value === undefined) return;
    if (!isObj(value)) {
      this.error(path, `"styles" must be an object keyed by display, not ${typeName(value)}`, 'Write { "lg": { "padding": "16px" }, "tablet": { ... } }');
      return;
    }
    const keys = Object.keys(value);
    for (const display of keys) {
      const at = `${path}.${display}`;
      const map = value[display];
      if (display === 'base') {
        this.warn(at, '"base" is an alias of "lg"', keys.includes('lg') ? 'Merge it into "lg"' : 'Rename it to "lg"');
      } else if (!isDisplayId(display)) {
        if (isObj(map) || typeof map !== 'string') {
          this.error(at, `Unknown display "${display}"; these styles are dropped`, `Use one of: ${DISPLAY_LIST}`);
        } else {
          this.error(at, `Styles go under a display; "${display}" is dropped`, `Write "styles": { "lg": { "${kebab(display)}": ${JSON.stringify(map)} } }`);
        }
        continue;
      }
      this.styleMap(map, at);
    }
  }

  styleMap(value: unknown, path: string) {
    if (!isObj(value)) return this.error(path, `Expected CSS declarations, not ${typeName(value)}`, 'Write { "display": "grid", "gap": "16px" }');
    for (const [prop, v] of Object.entries(value)) {
      const at = `${path}.${prop}`;
      if (!prop.startsWith('--') && /[A-Z]/.test(prop)) {
        this.error(at, `"${prop}" is camelCase; CSS properties are kebab-case`, `Use "${kebab(prop)}"`);
      } else if (!isSafeCssProp(prop)) {
        this.error(at, `"${prop}" is not a CSS property name; it is dropped`);
      }
      if (v === null || v === undefined) continue;
      if (typeof v === 'number') {
        this.warn(at, 'CSS values should be strings', v === 0 || /^(opacity|z-index|flex-grow|flex-shrink|order|font-weight|line-height)$/.test(prop) ? `Write it as "${v}"` : `Write it with a unit, e.g. "${v}px"`);
      } else if (typeof v !== 'string') {
        this.error(at, `CSS values must be strings, not ${typeName(v)}`);
      } else if (/[{};]/.test(v)) {
        this.warn(at, 'Braces and semicolons are stripped from CSS values', 'Give one value per property, without a trailing ";"');
      } else if (v.trim() === '') {
        this.warn(at, 'Empty value; the declaration is skipped');
      }
    }
  }

  kits(value: unknown, path: string) {
    if (value === undefined) return;
    if (!Array.isArray(value)) return this.error(path, `"kits" must be a list, not ${typeName(value)}`);
    value.forEach((kit, i) => this.kit(kit, `${path}[${i}]`));
  }

  kit(value: unknown, path: string) {
    if (!isObj(value)) return this.error(path, `Expected a design kit object, got ${typeName(value)}`);
    this.unknownKeys(value, KIT_KEYS, path, 'kit', { editable: 'rules' });
    for (const key of ['id', 'name', 'css', 'source'] as const) this.optionalString(value, key, path);
    if (value.enabled !== undefined && typeof value.enabled !== 'boolean') this.warn(`${path}.enabled`, '"enabled" should be true or false');
    if (value.href !== undefined && !(typeof value.href === 'string' && /^https?:\/\/[^\s"'<>]+$/i.test(value.href.trim()))) {
      this.error(`${path}.href`, '"href" must be an absolute http(s) URL; the link is dropped', 'Use e.g. "https://cdn.example.com/kit.css", or inline the CSS in "css"');
    }
    if (value.css === undefined && value.href === undefined && value.rules === undefined) {
      this.warn(path, 'The kit has no "css", "href" or "rules"; it is empty');
    }
    if (value.rules !== undefined) {
      if (!Array.isArray(value.rules)) return this.error(`${path}.rules`, `"rules" must be a list, not ${typeName(value.rules)}`);
      if (value.href !== undefined) this.warn(`${path}.rules`, 'Rules are ignored on a linked kit (one with "href")');
      value.rules.forEach((r, i) => {
        const at = `${path}.rules[${i}]`;
        if (!isObj(r)) return this.error(at, `Expected a style rule object, got ${typeName(r)}`);
        this.unknownKeys(r, RULE_KEYS, at, 'rule');
        if (typeof r.selector !== 'string' || !r.selector.trim()) this.error(`${at}.selector`, 'The rule has no selector', 'Add e.g. "selector": ".card"');
        else if (/[{};@]/.test(r.selector) || /<\/?(style|script)/i.test(r.selector)) this.error(`${at}.selector`, 'Selectors may not contain braces, semicolons, @ or tags', 'Write only the selector, e.g. ".card:hover"');
        this.styles(r.styles, `${at}.styles`);
      });
    }
  }
}

/**
 * Check a parsed Tree Weaver document (an envelope, or a bare forest, tree or branch) and
 * report every problem with its path and a hint.
 */
export function validateDocument(value: unknown): ValidationResult {
  const checker = new Checker();
  const kind = checker.document(value, '$');
  return { valid: checker.errors.length === 0, kind, errors: checker.errors, warnings: checker.warnings, counts: checker.counts };
}

/** Errors, then warnings, one per line: `error forest.trees[0].root.tag: <script> is not allowed. Fix: ...`. */
export function formatIssues(result: Pick<ValidationResult, 'errors' | 'warnings'>): string {
  return [...result.errors, ...result.warnings]
    .map((i) => `${i.severity} ${i.path}: ${i.message}${i.hint ? `. Fix: ${i.hint}` : ''}`)
    .join('\n');
}
