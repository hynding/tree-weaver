import { cloneNode, createLeaf } from './create';
import { isDisplayId } from './displays';
import type { Branch, DisplayId, Leaf, Tree, TreeNode } from './model';
import { isBranch } from './model';
import { normalizeNode, TreeDataError } from './normalize';
import { canHaveChildren, findNode, walk, VOID_TAGS, findParent, insertNode, isDescendant, removeNode, setStyles, updateNode } from './ops';
import { canonicalTag, inSvgContext, placementProblem } from './svg';
import { formatIssues, validateDocument, type ValidationIssue } from './validate';

/**
 * Patches: small, named edits to a tree, so an agent can change a layout without
 * writing the whole tree again. A patch is a list of operations applied in order, all
 * or nothing. Branches and leaves are named by id, or by a child-index path such as
 * `/2/0` (`/` is the root), which is what `tree-weaver outline` prints.
 *
 * ```json
 * [
 *   { "op": "insert", "parent": "/1", "node": { "tag": "h2", "children": ["Pricing"] } },
 *   { "op": "setStyles", "target": "b_hero", "styles": { "padding": "4rem 0", "tablet": { "padding": "2rem 0" } } },
 *   { "op": "move", "target": "b_cta", "parent": "/0", "index": 0 },
 *   { "op": "remove", "target": "/3" }
 * ]
 * ```
 */

/** A branch or leaf: its id, or a child-index path from the root (`/0/2`; `/` is the root). */
export type NodeRef = string;

/** Style changes: flat properties go on `display` (default `lg`); display keys hold their own maps. `null` removes a property. */
export type StylePatch = Record<string, string | null | Record<string, string | null>>;

export type PatchOp =
  /** Add `node` (a branch, a leaf, or a plain string for text) to `parent`, at `index` (default: last; negative counts from the end). */
  | { op: 'insert'; parent?: NodeRef; index?: number; node: unknown }
  /** Put `node` in place of `target`. */
  | { op: 'replace'; target: NodeRef; node: unknown }
  | { op: 'remove'; target: NodeRef }
  /** Move `target` into `parent` at `index` (default: last), counted as the children are after the move. */
  | { op: 'move'; target: NodeRef; parent: NodeRef; index?: number }
  /** Copy `target` (with fresh ids) right after itself. */
  | { op: 'duplicate'; target: NodeRef }
  /** Wrap `target` in `node`, a new branch that takes its place. */
  | { op: 'wrap'; target: NodeRef; node: unknown }
  /**
   * Change a branch's fields, or a leaf's `value` and `attrs`. `classes` replaces the list;
   * `addClasses` / `removeClasses` edit it. In `attrs`, `null` removes an attribute.
   */
  | {
      op: 'update';
      target: NodeRef;
      tag?: string;
      name?: string | null;
      type?: string | null;
      classes?: string[] | string;
      addClasses?: string[] | string;
      removeClasses?: string[] | string;
      attrs?: Record<string, string | null>;
      value?: string;
    }
  | { op: 'setStyles'; target: NodeRef; display?: DisplayId; styles: StylePatch }
  /** Set a leaf's text, or make `value` a branch's only content. */
  | { op: 'setText'; target: NodeRef; value: string };

export const PATCH_OPS = ['insert', 'replace', 'remove', 'move', 'duplicate', 'wrap', 'update', 'setStyles', 'setText'] as const;

export interface PatchOptions {
  /**
   * Turn a `node` value into a branch or leaf. The default accepts the canonical format
   * (ids optional). `@tree-weaver/branches` passes `expandShorthand` so patches can use
   * the compact shorthand and blueprints.
   */
  expandNode?: (value: unknown, path: string) => TreeNode;
  /**
   * Ids already used elsewhere in the forest (its other trees). Node ids are unique across
   * a forest, so an inserted node reusing one gets fresh ids. See `idsOutside`.
   */
  takenIds?: ReadonlySet<string>;
}

/** Whether a node is a component instance (`root`), inside one (`inside`), or neither. */
export function instanceRoleIn(root: Branch, id: string): 'root' | 'inside' | null {
  let role: 'root' | 'inside' | null = null;
  const visit = (n: TreeNode, inInstance: boolean): boolean => {
    if (n.id === id) {
      role = inInstance ? 'inside' : isBranch(n) && n.instance ? 'root' : null;
      return true;
    }
    return isBranch(n) && n.children.some((c) => visit(c, inInstance || !!n.instance));
  };
  visit(root, false);
  return role;
}

const INSTANCE_EDIT = 'is part of a component instance, whose content comes from the component; edit the component, or detach the instance first';

/**
 * Why `node` can't go into `parentId`, or null: the parent is (or is inside) a component instance,
 * or the node, or anything it holds, would break the SVG/HTML placement rules there. For callers
 * that insert outside a patch (a new component instance).
 */
export function insertionProblem(root: Branch, parentId: string, node: TreeNode): string | null {
  if (instanceRoleIn(root, parentId)) return `The parent ${INSTANCE_EDIT}`;
  const own = placementProblem(root, parentId, node);
  if (own) return own;
  const placed = insertNode(root, parentId, node);
  let problem: string | null = null;
  const visit = (parent: Branch): boolean =>
    parent.children.some((child) => {
      problem = placementProblem(placed, parent.id, child);
      return problem !== null || (isBranch(child) && visit(child));
    });
  if (isBranch(node)) visit(node);
  return problem;
}

/** Every node id in the forest's trees other than `treeId`, for `PatchOptions.takenIds`. */
export function idsOutside(trees: readonly Tree[], treeId: string): Set<string> {
  const ids = new Set<string>();
  for (const tree of trees) if (tree.id !== treeId) walk(tree.root, (n) => void ids.add(n.id));
  return ids;
}

export interface PatchChange {
  /** Index of the operation in the patch. */
  op: number;
  kind: PatchOp['op'];
  /** Id of the node the operation created or changed. */
  id: string;
  /** Its path after the whole patch, or null when it was removed later. */
  path: string | null;
}

export interface PatchResult {
  root: Branch;
  changes: PatchChange[];
  /** Validator warnings about inserted or changed nodes. */
  warnings: ValidationIssue[];
}

/** A patch that can't be applied. `op` is the index of the failing operation. */
export class PatchError extends Error {
  constructor(
    message: string,
    readonly op: number,
  ) {
    super(op >= 0 ? `ops[${op}]: ${message}` : message);
    this.name = 'PatchError';
  }
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Find a branch or leaf by id or child-index path. Throws an `Error` that says what is there instead. */
export function resolveRef(root: Branch, ref: NodeRef | undefined): { node: TreeNode; path: string } {
  if (ref === undefined || ref === '/' || ref === '') return { node: root, path: '/' };
  if (typeof ref !== 'string') throw new Error(`A node reference must be an id or a path such as "/0/2", not ${JSON.stringify(ref)}`);
  if (ref.startsWith('/')) {
    let node: TreeNode = root;
    const steps = ref.split('/').filter(Boolean);
    for (const [depth, step] of steps.entries()) {
      const at = `/${steps.slice(0, depth + 1).join('/')}`;
      if (!/^\d+$/.test(step)) throw new Error(`Bad path "${ref}": "${step}" is not a child index`);
      if (!isBranch(node)) throw new Error(`Path "${at}" goes inside a leaf`);
      const child: TreeNode | undefined = node.children[Number(step)];
      if (!child) throw new Error(`Path "${at}" does not exist; there are ${node.children.length} children there`);
      node = child;
    }
    return { node, path: `/${steps.join('/')}` };
  }
  const node = findNode(root, ref);
  if (!node) throw new Error(`No branch or leaf with id "${ref}"; list ids with "tree-weaver outline"`);
  return { node, path: pathOf(root, ref) ?? '?' };
}

/** A node's child-index path (`/2/0`), `/` for the root, or null when it isn't in the tree. */
export function pathOf(root: Branch, id: string, prefix = ''): string | null {
  if (root.id === id) return prefix || '/';
  for (const [i, child] of root.children.entries()) {
    const here = `${prefix}/${i}`;
    if (child.id === id) return here;
    if (isBranch(child)) {
      const found = pathOf(child, id, here);
      if (found) return found;
    }
  }
  return null;
}

const classList = (v: unknown, field: string): string[] => {
  if (typeof v === 'string') return v.split(/\s+/).filter(Boolean);
  if (Array.isArray(v) && v.every((c) => typeof c === 'string')) return v.flatMap((c) => c.split(/\s+/)).filter(Boolean);
  throw new Error(`"${field}" must be a list of class names or a space-separated string`);
};

/** Split a style patch into per-display maps: flat properties go to `display`. */
export function stylePatchByDisplay(styles: unknown, display: DisplayId = 'lg'): Partial<Record<DisplayId, Record<string, string | null>>> {
  if (!isObj(styles)) throw new Error('"styles" must be an object of CSS properties, or of displays holding them');
  const out: Partial<Record<DisplayId, Record<string, string | null>>> = {};
  const put = (d: DisplayId, prop: string, value: unknown) => {
    if (value !== null && typeof value !== 'string' && typeof value !== 'number') throw new Error(`Style "${prop}" must be a string, or null to remove it`);
    // Custom properties are case-sensitive, so `--brandColor` stays as written.
    const kebab = prop.startsWith('--') ? prop : prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
    (out[d] ??= {})[kebab] = value === null ? null : String(value);
  };
  for (const [key, value] of Object.entries(styles)) {
    const d = key === 'base' ? 'lg' : key;
    if (isDisplayId(d)) {
      if (!isObj(value)) throw new Error(`"styles.${key}" must be an object of CSS properties`);
      for (const [prop, v] of Object.entries(value)) put(d, prop, v);
    } else if (isObj(value)) {
      throw new Error(`Unknown display "${key}"; use one of lg, xl, tablet, mobile-landscape, mobile-portrait`);
    } else put(display, key, value);
  }
  return out;
}

const NODE_PATH = /(?:\$|branch)\.children\[0\]/g;

/**
 * Apply a patch to a tree's root and return the new root, without changing the old one.
 * Throws `PatchError` (naming the operation) when any operation can't be applied; then
 * nothing is applied.
 */
export function applyPatch(root: Branch, ops: unknown, options: PatchOptions = {}): PatchResult {
  if (!Array.isArray(ops)) {
    if (isObj(ops) && Array.isArray(ops.ops)) ops = ops.ops;
    else if (isObj(ops) && typeof ops.op === 'string') ops = [ops];
    else throw new PatchError('A patch is a list of operations: [{ "op": "insert", ... }, ...]', -1);
  }
  const expand = options.expandNode ?? ((value: unknown, path: string) => normalizeNode(value, path));
  const changed: { op: number; kind: PatchOp['op']; id: string }[] = [];
  const warnings: ValidationIssue[] = [];
  let current = root;

  /**
   * Strictly check a node, throwing on errors. It is checked as the only child of a
   * `div` (or an `svg` when `parentId` is inside a drawing); a changed branch is checked
   * without its children, which didn't change.
   */
  const check = (node: TreeNode, at: string, parentId: string | null) => {
    if (isBranch(node) && node.id === current.id) node = { ...node, tag: node.tag === 'svg' ? 'svg' : 'div' };
    const inSvg = parentId !== null && inSvgContext(current, parentId);
    const result = validateDocument({ kind: 'branch', tag: inSvg ? 'svg' : 'div', children: [node] });
    const rename = (i: ValidationIssue): ValidationIssue => ({ ...i, path: i.path.replace(NODE_PATH, at) });
    if (!result.valid) throw new Error(`the node has errors:\n${formatIssues({ errors: result.errors.map(rename), warnings: [] })}`);
    warnings.push(...result.warnings.map(rename));
  };
  const makeNode = (value: unknown, at: string, parentId: string | null, asRoot = false): TreeNode => {
    if (value === undefined) throw new Error('"node" is missing');
    let node: TreeNode;
    try {
      node = expand(value, at);
    } catch (err) {
      throw new Error(err instanceof TreeDataError ? err.message : (err as Error).message);
    }
    // An instance's content is its component's, expanded on every load: a node a patch writes can't
    // be one (or hold one), or the next load would replace what it holds.
    let instance = false;
    walk(node, (n) => {
      if (isBranch(n) && n.instance) instance = true;
    });
    if (instance) throw new Error('A patch can\u2019t create a component instance; insert one with `tree-weaver components insert` (or the MCP insert_component tool)');
    // A new root keeps the tree's root id, tag and type, so its children are checked where they will live.
    if (asRoot) {
      if (!isBranch(node)) throw new Error('The root must stay a branch');
      node = { ...node, id: current.id, tag: current.tag, type: current.type ?? node.type };
    }
    // Ids must stay unique: a node that reuses an id already in the tree (or the forest) gets fresh ones.
    let clash = false;
    const walkIds = (n: TreeNode) => {
      if (findNode(current, n.id) || options.takenIds?.has(n.id)) clash = true;
      if (isBranch(n)) n.children.forEach(walkIds);
    };
    if (asRoot && isBranch(node)) {
      const children = node.children.map((c) => {
        clash = false;
        walkIds(c);
        return clash ? cloneNode(c, true) : c;
      });
      node = { ...node, children };
    } else {
      walkIds(node);
      if (clash) node = cloneNode(node, true);
    }
    check(node, at, parentId);
    return node;
  };
  const branchAt = (ref: NodeRef | undefined, field: string): Branch => {
    const { node, path } = resolveRef(current, ref);
    if (!canHaveChildren(node)) throw new Error(`"${field}" ${path} is ${isBranch(node) ? `a <${(node as Branch).tag}>` : "a leaf"}, which can't hold children`);
    return node;
  };
  const placeable = (parent: Branch, node: TreeNode) => {
    const problem = placementProblem(current, parent.id, node);
    if (problem) throw new Error(problem);
  };
  /** Check everything inside `node` where it now sits in `tree` (an <a> or <title> works in HTML and SVG alike, so what it holds must be checked too). */
  const placedInside = (tree: Branch, node: TreeNode, prefix = '') => {
    const visit = (parent: Branch) => {
      for (const child of parent.children) {
        const problem = placementProblem(tree, parent.id, child);
        if (problem) throw new Error(`${prefix}${problem}`);
        if (isBranch(child)) visit(child);
      }
    };
    if (isBranch(node)) visit(node);
  };
  /**
   * An instance's children (and its own tag, classes, styles and attributes) are its component's
   * template, expanded again on every load, so an edit there would be silently undone.
   */
  const instanceRole = (id: string) => instanceRoleIn(current, id);
  const notInInstance = (id: string, path: string, allowRoot: boolean) => {
    const role = instanceRole(id);
    if (role === 'inside' || (role === 'root' && !allowRoot)) throw new Error(`${path} ${INSTANCE_EDIT}`);
  };
  const position = (parent: Branch, index: unknown, extra = 0): number | undefined => {
    if (index === undefined) return undefined;
    if (typeof index !== 'number' || !Number.isInteger(index)) throw new Error('"index" must be a whole number');
    return index < 0 ? Math.max(0, parent.children.length + extra + 1 + index) : index;
  };
  const notRoot = (node: TreeNode, what: string) => {
    if (node.id === current.id) throw new Error(`The root branch can't be ${what}`);
  };

  (ops as unknown[]).forEach((raw, i) => {
    try {
      if (!isObj(raw)) throw new Error('An operation is an object with an "op"');
      const op = raw as Obj;
      const kind = op.op as PatchOp['op'];
      const at = `ops[${i}].node`;
      switch (kind) {
        case 'insert': {
          const parent = branchAt(op.parent as string | undefined, 'parent');
          notInInstance(parent.id, '"parent"', false);
          const node = makeNode(op.node, at, parent.id);
          placeable(parent, node);
          current = insertNode(current, parent.id, node, position(parent, op.index));
          placedInside(current, node);
          changed.push({ op: i, kind, id: node.id });
          break;
        }
        case 'replace': {
          const { node: target } = resolveRef(current, op.target as string);
          const hit = findParent(current, target.id);
          if (hit) notInInstance(target.id, '"target"', true);
          // Replacing the root keeps it the tree's root: same id, same tag.
          const node = makeNode(op.node, at, hit?.parent.id ?? null, !hit);
          if (!hit) {
            current = node as Branch;
          } else {
            placeable(hit.parent, node);
            current = insertNode(removeNode(current, target.id), hit.parent.id, node, hit.index);
          }
          placedInside(current, node);
          changed.push({ op: i, kind, id: node.id });
          break;
        }
        case 'remove': {
          const { node } = resolveRef(current, op.target as string);
          notRoot(node, 'removed');
          notInInstance(node.id, '"target"', true);
          current = removeNode(current, node.id);
          changed.push({ op: i, kind, id: node.id });
          break;
        }
        case 'move': {
          const { node } = resolveRef(current, op.target as string);
          notRoot(node, 'moved');
          notInInstance(node.id, '"target"', true);
          const parent = branchAt(op.parent as string, 'parent');
          notInInstance(parent.id, '"parent"', false);
          if (node.id === parent.id || isDescendant(current, node.id, parent.id)) throw new Error('A branch can’t be moved inside itself');
          placeable(parent, node);
          // `index` is where the node ends up, so take it out first.
          const without = removeNode(current, node.id);
          const target = findNode(without, parent.id) as Branch;
          const index = position(target, op.index);
          current = insertNode(without, parent.id, node, index);
          placedInside(current, node);
          changed.push({ op: i, kind, id: node.id });
          break;
        }
        case 'duplicate': {
          const { node } = resolveRef(current, op.target as string);
          notRoot(node, 'duplicated');
          notInInstance(node.id, '"target"', true);
          const hit = findParent(current, node.id)!;
          const copy = cloneNode(node, true);
          current = insertNode(current, hit.parent.id, copy, hit.index + 1);
          changed.push({ op: i, kind, id: copy.id });
          break;
        }
        case 'wrap': {
          const { node } = resolveRef(current, op.target as string);
          notRoot(node, 'wrapped');
          notInInstance(node.id, '"target"', true);
          const hit = findParent(current, node.id)!;
          const wrapper = makeNode(op.node, at, hit.parent.id);
          if (!canHaveChildren(wrapper)) throw new Error('"node" must be a branch that can hold children');
          placeable(hit.parent, wrapper);
          const wrapped: Branch = { ...wrapper, children: [...wrapper.children, node] };
          const next = updateNode(current, hit.parent.id, (p) => {
            const children = [...(p as Branch).children];
            children[hit.index] = wrapped;
            return { ...(p as Branch), children };
          });
          // The wrapper's own children, and the wrapped node with everything in it, now sit in the
          // wrapper's context (an SVG shape wrapped in <foreignObject> would no longer be drawn).
          placedInside(next, wrapped, `Can't wrap it in <${wrapper.tag}>: `);
          current = next;
          changed.push({ op: i, kind, id: wrapper.id });
          break;
        }
        case 'update': {
          const { node } = resolveRef(current, op.target as string);
          notInInstance(node.id, '"target"', false);
          const known = new Set(['op', 'target', 'tag', 'name', 'type', 'classes', 'addClasses', 'removeClasses', 'attrs', 'value']);
          const unknown = Object.keys(op).filter((k) => !known.has(k));
          if (unknown.length) throw new Error(`Unknown field${unknown.length > 1 ? 's' : ''} ${unknown.map((k) => `"${k}"`).join(', ')}; use setStyles for styles and setText for text`);
          let next: TreeNode;
          if (isBranch(node)) {
            if (op.value !== undefined) throw new Error('"value" is for leaves; use setText to change a branch’s text');
            const b: Branch = { ...node, attrs: { ...node.attrs } };
            if (op.tag !== undefined) {
              if (node.id === current.id) throw new Error('The root’s tag can’t change');
              b.tag = canonicalTag(String(op.tag));
            }
            for (const field of ['name', 'type'] as const) {
              if (op[field] === null || op[field] === '') delete b[field];
              else if (op[field] !== undefined) b[field] = String(op[field]);
            }
            let classes = op.classes !== undefined ? classList(op.classes, 'classes') : [...node.classes];
            if (op.addClasses !== undefined) classes.push(...classList(op.addClasses, 'addClasses'));
            if (op.removeClasses !== undefined) {
              const drop = new Set(classList(op.removeClasses, 'removeClasses'));
              classes = classes.filter((c) => !drop.has(c));
            }
            b.classes = [...new Set(classes)];
            applyAttrs(b.attrs, op.attrs);
            next = b;
          } else {
            for (const field of ['tag', 'name', 'type', 'classes', 'addClasses', 'removeClasses'] as const) {
              if (op[field] !== undefined) throw new Error(`A leaf has no "${field}"`);
            }
            const leaf: Leaf = { ...node, attrs: { ...node.attrs } };
            if (op.value !== undefined) leaf.value = String(op.value);
            applyAttrs(leaf.attrs!, op.attrs);
            if (!Object.keys(leaf.attrs!).length) delete leaf.attrs;
            next = leaf;
          }
          // Children are left out of the check (they are already valid), but a tag that can't hold any
          // must not take over a branch that has some.
          if (isBranch(next) && isBranch(node) && node.children.length && VOID_TAGS.has(next.tag.toLowerCase()))
            throw new Error(`<${next.tag}> can't hold children, and this branch has ${node.children.length}`);
          check(isBranch(next) ? { ...next, children: [] } : next, `ops[${i}]`, findParent(current, node.id)?.parent.id ?? null);
          const updated = updateNode(current, node.id, () => next);
          // A new tag must suit its parent and everything it holds (SVG shapes need an SVG around
          // them, HTML can't go in one), checked again for the whole subtree in its new context.
          if (isBranch(next) && isBranch(node) && next.tag !== node.tag) {
            const parentId = findParent(current, node.id)?.parent.id;
            const own = parentId ? placementProblem(updated, parentId, next) : null;
            if (own) throw new Error(`Can't change the tag to <${next.tag}>: ${own}`);
            const visit = (b: Branch) => {
              for (const child of b.children) {
                const problem = placementProblem(updated, b.id, child);
                if (problem) throw new Error(`Can't change the tag to <${next.tag}>: ${problem}`);
                if (isBranch(child)) visit(child);
              }
            };
            visit(next);
          }
          current = updated;
          changed.push({ op: i, kind, id: node.id });
          break;
        }
        case 'setStyles': {
          const { node } = resolveRef(current, op.target as string);
          notInInstance(node.id, '"target"', false);
          if (!isBranch(node)) throw new Error('Only branches have styles');
          if (op.display !== undefined && !isDisplayId(String(op.display))) throw new Error(`Unknown display "${String(op.display)}"`);
          const byDisplay = stylePatchByDisplay(op.styles, (op.display as DisplayId | undefined) ?? 'lg');
          let next = current;
          for (const [display, map] of Object.entries(byDisplay)) next = setStyles(next, node.id, display as DisplayId, map as Record<string, string | null>);
          const updated = findNode(next, node.id) as Branch;
          check({ ...updated, children: [] }, `ops[${i}]`, findParent(current, node.id)?.parent.id ?? null);
          current = next;
          changed.push({ op: i, kind, id: node.id });
          break;
        }
        case 'setText': {
          const { node } = resolveRef(current, op.target as string);
          notInInstance(node.id, '"target"', false);
          if (typeof op.value !== 'string') throw new Error('"value" must be a string');
          if (isBranch(node)) {
            if (!canHaveChildren(node)) throw new Error(`A <${(node as Branch).tag}> can’t hold text`);
            const leaf = node.children.length === 1 && !isBranch(node.children[0]) && node.children[0].type === 'text' ? node.children[0] : null;
            const text = leaf ? { ...leaf, value: op.value } : createLeaf(op.value);
            current = updateNode(current, node.id, (b) => ({ ...(b as Branch), children: [text] }));
          } else {
            if (node.type !== 'text') throw new Error(`This is ${node.type === 'image' ? 'an image' : 'a shape'} leaf; use update with "value"`);
            const value = op.value;
            current = updateNode(current, node.id, (l) => ({ ...(l as Leaf), value }));
          }
          changed.push({ op: i, kind, id: node.id });
          break;
        }
        default:
          throw new Error(`Unknown op ${JSON.stringify(op.op)}; use one of ${PATCH_OPS.join(', ')}`);
      }
    } catch (err) {
      if (err instanceof PatchError) throw err;
      throw new PatchError((err as Error).message, i);
    }
  });

  return {
    root: current,
    changes: changed.map((c) => ({ ...c, path: pathOf(current, c.id) })),
    warnings,
  };
}

function applyAttrs(attrs: Record<string, string>, patch: unknown) {
  if (patch === undefined) return;
  if (!isObj(patch)) throw new Error('"attrs" must be an object of attribute names to values (null removes one)');
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete attrs[k];
    else attrs[k] = String(v);
  }
}

/** A JSON Schema (draft 2020-12) for patches, published next to the document schema. */
export const PATCH_SCHEMA_URL = 'https://hynding.github.io/tree-weaver/schema/tree-weaver-patch-v1.schema.json';

const ref = { type: 'string', description: 'A branch or leaf id, or a child-index path such as "/0/2" ("/" is the root)' };
const node = { description: 'A branch, a leaf, or a string (a text leaf). Ids are optional; with the shorthand, also "h2: Title", "@card" or { "grid": 3, ... }' };
const oneOfTypes = (...types: string[]) => ({ anyOf: types.map((type) => ({ type })) });
const styleValue = oneOfTypes('string', 'number', 'null');
const opSchema = (name: string, required: string[], properties: Record<string, unknown>, description: string) => ({
  type: 'object',
  description,
  required: ['op', ...required],
  additionalProperties: false,
  properties: { op: { const: name }, ...properties },
});

export const TREE_WEAVER_PATCH_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: PATCH_SCHEMA_URL,
  title: 'Tree Weaver patch',
  description: 'A list of edits to one tree, applied in order, all or nothing. Nodes are named by id or by child-index path.',
  oneOf: [
    { type: 'array', items: { $ref: '#/$defs/op' } },
    { type: 'object', required: ['ops'], properties: { $schema: { type: 'string' }, ops: { type: 'array', items: { $ref: '#/$defs/op' } } } },
  ],
  $defs: {
    styles: {
      type: 'object',
      description: 'CSS properties (kebab-case) for "display" (default lg), and/or display keys (lg, xl, tablet, mobile-landscape, mobile-portrait) holding them. null removes a property.',
      additionalProperties: { anyOf: [...styleValue.anyOf, { type: 'object', additionalProperties: styleValue }] },
    },
    classes: { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
    op: {
      oneOf: [
        opSchema('insert', ['node'], { parent: ref, index: { type: 'integer', description: 'Position among the children (default: last); negative counts from the end' }, node }, 'Add a node to a branch'),
        opSchema('replace', ['target', 'node'], { target: ref, node }, 'Put a node in place of another'),
        opSchema('remove', ['target'], { target: ref }, 'Remove a node'),
        opSchema('move', ['target', 'parent'], { target: ref, parent: ref, index: { type: 'integer' } }, 'Move a node to another parent or position'),
        opSchema('duplicate', ['target'], { target: ref }, 'Copy a node right after itself'),
        opSchema('wrap', ['target', 'node'], { target: ref, node }, 'Wrap a node in a new branch'),
        opSchema(
          'update',
          ['target'],
          {
            target: ref,
            tag: { type: 'string' },
            name: oneOfTypes('string', 'null'),
            type: oneOfTypes('string', 'null'),
            classes: { $ref: '#/$defs/classes' },
            addClasses: { $ref: '#/$defs/classes' },
            removeClasses: { $ref: '#/$defs/classes' },
            attrs: { type: 'object', additionalProperties: oneOfTypes('string', 'null') },
            value: { type: 'string', description: 'A leaf’s text, image URL or shape name' },
          },
          'Change a branch’s tag, name, type, classes or attributes, or a leaf’s value and attributes',
        ),
        opSchema('setStyles', ['target', 'styles'], { target: ref, display: { enum: ['lg', 'xl', 'tablet', 'mobile-landscape', 'mobile-portrait'] }, styles: { $ref: '#/$defs/styles' } }, 'Set or remove styles on one or more displays'),
        opSchema('setText', ['target', 'value'], { target: ref, value: { type: 'string' } }, 'Set a text leaf, or make text a branch’s only content'),
      ],
    },
  },
} as const;
