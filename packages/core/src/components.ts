import { cloneNode, createId } from './create';
import { DISPLAY_IDS, getDisplay, resolveStyles } from './displays';
import type { Branch, DisplayId, DisplayStyles, Forest, StyleMap, Tree, TreeNode } from './model';
import { isBranch } from './model';
import { isSvgOnly } from './svg';
import { VOID_TAGS } from './ops';

/**
 * Reusable components: a branch saved once in the forest, with props and variants, and used
 * as linked instances in any tree.
 *
 * - **Props** are placeholders in the template: `{{title}}` in a text leaf, an attribute value
 *   (`href="{{link}}"`), an image leaf's URL or a class name (`btn-{{tone}}`). A branch with
 *   `data-show-if="badge"` shows only when the `badge` prop is set (`!badge` for the opposite).
 * - **Variants** are named style overrides for the template's branches, per display, like a
 *   branch's own styles (`compact` makes the padding smaller on every display; `stacked` turns
 *   a row into a column).
 * - An **instance** is a branch with `instance: { component, props, variants }`. `variants` picks
 *   a variant per display (`{ lg: 'row', 'mobile-portrait': 'stacked' }`); displays without one
 *   inherit, as styles do. The instance's tag, classes, styles and children are the expanded
 *   template, kept in sync by `syncInstances`, so every renderer and export reads plain
 *   branches and needs to know nothing about components.
 */

export type ComponentPropType = 'text' | 'url' | 'image' | 'boolean' | 'enum';
export const COMPONENT_PROP_TYPES: readonly ComponentPropType[] = ['text', 'url', 'image', 'boolean', 'enum'];

export interface ComponentProp {
  /** A placeholder name: letters, digits and `_`, starting with a letter. */
  name: string;
  type: ComponentPropType;
  /** Value used when an instance leaves the prop out. Booleans: `'true'` or `''`. */
  default: string;
  /** Choices of an `enum` prop. */
  options?: string[];
  description?: string;
}

export interface ComponentVariant {
  name: string;
  description?: string;
  /** Style overrides per template branch id, per display. */
  styles: Record<string, DisplayStyles>;
}

export interface ComponentDef {
  id: string;
  /** Shown in the palette and used as the exported component's name. */
  name: string;
  description?: string;
  /** The template. Its branch and leaf ids are stable: variants refer to them. */
  root: Branch;
  props: ComponentProp[];
  variants: ComponentVariant[];
}

export interface ComponentInstance {
  /** Id of the component in the forest's `components`. */
  component: string;
  /** Prop values; props left out use their defaults. */
  props?: Record<string, string>;
  /** The variant per display; displays left out inherit. No entry means the base styles. */
  variants?: Partial<Record<DisplayId, string>>;
}

const PROP_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
export const isPropName = (name: string): boolean => PROP_NAME.test(name);

/** Placeholder syntax: `{{ name }}`. */
const PLACEHOLDER = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g;
/** Attribute that shows a branch only when a prop is set. */
export const IF_ATTR = 'data-show-if';

/** Placeholder names used in a string, in order. */
export function placeholdersIn(value: string): string[] {
  return [...value.matchAll(PLACEHOLDER)].map((m) => m[1]);
}

/** Every prop a template uses, with how it is used: the inferred type and the first value seen. */
export function templateProps(root: Branch): ComponentProp[] {
  const found = new Map<string, ComponentPropType>();
  const add = (name: string, type: ComponentPropType) => {
    const prev = found.get(name);
    // Text is the weakest guess: a later, more specific use wins.
    if (!prev || prev === 'text') found.set(name, type);
  };
  const visit = (node: TreeNode) => {
    if (!isBranch(node)) {
      for (const n of placeholdersIn(node.value)) add(n, node.type === 'image' ? 'image' : 'text');
      for (const v of Object.values(node.attrs ?? {})) for (const n of placeholdersIn(v)) add(n, 'text');
      return;
    }
    for (const [attr, v] of Object.entries(node.attrs)) {
      if (attr === IF_ATTR) {
        const n = v.trim().replace(/^!/, '');
        if (isPropName(n)) add(n, 'boolean');
        continue;
      }
      for (const n of placeholdersIn(v)) add(n, attr === 'href' ? 'url' : attr === 'src' ? 'image' : 'text');
    }
    for (const c of node.classes) for (const n of placeholdersIn(c)) add(n, 'enum');
    node.children.forEach(visit);
  };
  visit(root);
  return [...found].map(([name, type]) => ({ name, type, default: '' }));
}

/** The component's props: declared ones first, then any placeholder the template uses that isn't declared. */
export function componentProps(def: ComponentDef): ComponentProp[] {
  const declared = new Map(def.props.map((p) => [p.name, p]));
  const out = [...def.props];
  for (const p of templateProps(def.root)) if (!declared.has(p.name)) out.push(p);
  return out;
}

/** Fill `{{name}}` placeholders. Unknown names become empty. */
export function fillPlaceholders(value: string, values: Record<string, string>): string {
  return value.replace(PLACEHOLDER, (_m, name: string) => (Object.hasOwn(values, name) ? values[name] : '') ?? '');
}

const truthy = (v: string | undefined) => !!v && v !== 'false' && v !== '0';

/** HTML attributes that are on when present, whatever their value. */
export const BOOLEAN_ATTRS: ReadonlySet<string> = new Set([
  'allowfullscreen', 'async', 'autofocus', 'autoplay', 'checked', 'controls', 'default', 'defer', 'disabled', 'formnovalidate', 'hidden', 'inert',
  'ismap', 'itemscope', 'loop', 'multiple', 'muted', 'nomodule', 'novalidate', 'open', 'playsinline', 'readonly', 'required', 'reversed', 'selected',
]);

/** Prop values for an instance: its own, then the defaults. */
export function instanceValues(def: ComponentDef, instance: ComponentInstance | undefined): Record<string, string> {
  const values: Record<string, string> = {};
  for (const p of componentProps(def)) values[p.name] = p.default;
  for (const [k, v] of Object.entries(instance?.props ?? {})) values[k] = v;
  return values;
}

/** The variant each display uses: its own pick, else the nearest display it inherits from. */
export function variantPerDisplay(def: ComponentDef, picks: ComponentInstance['variants']): Record<DisplayId, ComponentVariant | undefined> {
  const out = {} as Record<DisplayId, ComponentVariant | undefined>;
  // `-` is the pick for the base styles on a display (no variant), never a variant's name. A pick
  // naming a variant that no longer exists counts as no pick, so the display inherits.
  const pickOn = (d: DisplayId): string | undefined => {
    const name = picks?.[d];
    return name === '-' || (name !== undefined && def.variants.some((v) => v.name === name)) ? name : undefined;
  };
  for (const d of DISPLAY_IDS) {
    let name = pickOn(d);
    if (name === undefined) {
      const chain = getDisplay(d).inherits;
      for (let i = chain.length - 1; i >= 0 && name === undefined; i--) name = pickOn(chain[i]);
    }
    out[d] = name && name !== '-' ? def.variants.find((v) => v.name === name) : undefined;
  }
  return out;
}

/**
 * A template branch's styles with the chosen variants laid over them: each display gets the
 * base styles plus its variant's styles, both cascaded, written back as the smallest set of
 * per-display styles that cascades to the same result.
 */
export function variantStyles(base: DisplayStyles, nodeId: string, perDisplay: Record<DisplayId, ComponentVariant | undefined>): DisplayStyles {
  if (DISPLAY_IDS.every((d) => !perDisplay[d]?.styles[nodeId])) return base;
  const full = {} as Record<DisplayId, StyleMap>;
  for (const d of DISPLAY_IDS) {
    const over = perDisplay[d]?.styles[nodeId];
    full[d] = { ...resolveStyles(base, d), ...(over ? resolveStyles(over, d) : {}) };
  }
  const out: DisplayStyles = {};
  for (const d of DISPLAY_IDS) {
    const chain = getDisplay(d).inherits;
    const parent: StyleMap = chain.length ? full[chain[chain.length - 1]] : {};
    const own: StyleMap = {};
    for (const [k, v] of Object.entries(full[d])) if (parent[k] !== v) own[k] = v;
    // A property the wider display's variant set that this display's doesn't: undo it.
    for (const k of Object.keys(parent)) if (!(k in full[d])) own[k] = 'unset';
    if (Object.keys(own).length) out[d] = own;
  }
  return out;
}

/** Ids of an instance's expanded nodes: stable across re-expansions, unique per instance. */
const expandedId = (instanceId: string, templateId: string) => `${instanceId}~${templateId}`;

/** The template expanded for an instance: props filled, `data-show-if` applied, variants laid over. */
export function expandComponent(def: ComponentDef, instance: ComponentInstance, instanceId: string): Branch {
  const values = instanceValues(def, instance);
  const perDisplay = variantPerDisplay(def, instance.variants);
  const boolProps = new Set(componentProps(def).filter((p) => p.type === 'boolean').map((p) => p.name));
  const visit = (node: TreeNode, isRoot: boolean): TreeNode | null => {
    if (!isBranch(node)) {
      const leaf = { ...node, id: expandedId(instanceId, node.id), value: fillPlaceholders(node.value, values) };
      if (node.attrs) leaf.attrs = Object.fromEntries(Object.entries(node.attrs).map(([k, v]) => [k, fillPlaceholders(v, values)]));
      return leaf;
    }
    const cond = node.attrs[IF_ATTR]?.trim();
    if (cond && !isRoot) {
      const negate = cond.startsWith('!');
      const prop = cond.replace(/^!/, '');
      const on = Object.hasOwn(values, prop) && truthy(values[prop]);
      if (negate ? on : !on) return null;
    }
    const attrs: Record<string, string> = {};
    for (const [k, v] of Object.entries(node.attrs)) {
      if (k === IF_ATTR) continue;
      // A boolean attribute bound to a prop is left off when the prop is off: a boolean prop that
      // isn't truthy, or any other prop set to "false". The component exports follow the same rule.
      const bound = BOOLEAN_ATTRS.has(k.toLowerCase()) ? /^\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}$/.exec(v.trim()) : null;
      if (bound) {
        const value = Object.hasOwn(values, bound[1]) ? values[bound[1]] : '';
        // The inferred types too (a prop only `data-show-if` uses is boolean), as the exports and prop panel see them.
        const isBool = boolProps.has(bound[1]);
        if (isBool ? !truthy(value) : value === 'false') continue;
      }
      attrs[k] = fillPlaceholders(v, values);
    }
    const branch: Branch = {
      ...node,
      id: isRoot ? instanceId : expandedId(instanceId, node.id),
      classes: [...new Set(node.classes.map((c) => fillPlaceholders(c, values).trim()).filter(Boolean))],
      attrs,
      styles: variantStyles(node.styles, node.id, perDisplay),
      children: node.children.map((c) => visit(c, false)).filter((c): c is TreeNode => c !== null),
    };
    delete branch.instance;
    return branch;
  };
  const root = visit(def.root, true) as Branch;
  return { ...root, name: root.name ?? def.name, instance: { ...instance } };
}

/** A new instance of a component, expanded. */
export function instantiateComponent(def: ComponentDef, props?: Record<string, string>, variants?: ComponentInstance['variants']): Branch {
  const instance: ComponentInstance = { component: def.id };
  if (props && Object.keys(props).length) instance.props = { ...props };
  if (variants && Object.keys(variants).length) instance.variants = { ...variants };
  return expandComponent(def, instance, createId('b'));
}

/** Expand every instance under `root` again, from the forest's components. Unknown components are left as they are. */
export function syncBranch(root: Branch, components: readonly ComponentDef[]): Branch {
  const byId = new Map(components.map((c) => [c.id, c]));
  const visit = (node: TreeNode): TreeNode => {
    if (!isBranch(node)) return node;
    if (node.instance) {
      const def = byId.get(node.instance.component);
      if (!def) return node;
      const expanded = expandComponent(def, node.instance, node.id);
      // Keep the same object when nothing changed, so callers can tell.
      return JSON.stringify(expanded) === JSON.stringify(node) ? node : expanded;
    }
    const children = node.children.map(visit);
    return children.some((c, i) => c !== node.children[i]) ? { ...node, children } : node;
  };
  return visit(root) as Branch;
}

/** The forest with every instance in every tree re-expanded from its component. */
export function syncInstances(forest: Forest): Forest {
  const components = forest.components ?? [];
  if (!components.length) return forest;
  const trees = forest.trees.map((t) => {
    const root = syncBranch(t.root, components);
    return root === t.root ? t : { ...t, root };
  });
  return trees.some((t, i) => t !== forest.trees[i]) ? { ...forest, trees } : forest;
}

/** Unlink an instance: it keeps its current content and stops following the component. */
export function detachInstance(branch: Branch): Branch {
  const out = { ...branch };
  delete out.instance;
  return out;
}

/** Instances of a component across the forest's trees. */
export function instancesOf(forest: Forest, componentId: string): { tree: Tree; branch: Branch }[] {
  const out: { tree: Tree; branch: Branch }[] = [];
  for (const tree of forest.trees) {
    const visit = (node: TreeNode) => {
      if (!isBranch(node)) return;
      if (node.instance?.component === componentId) out.push({ tree, branch: node });
      node.children.forEach(visit);
    };
    visit(tree.root);
  }
  return out;
}

/**
 * A component from a branch (or a tree's root): the branch becomes the template, keeping its ids
 * so variants can refer to them. A tree's `<body>` root becomes a `<div>`. Nested instances are
 * flattened into plain branches, so a component never depends on another.
 */
export function createComponent(name: string, branch: Branch, init: { description?: string; props?: ComponentProp[]; variants?: ComponentVariant[] } = {}): ComponentDef {
  const flatten = (node: TreeNode): TreeNode => (isBranch(node) ? { ...detachInstance(node), children: node.children.map(flatten) } : node);
  const root = flatten(cloneNode(branch)) as Branch;
  if (root.tag === 'body') root.tag = 'div';
  if (root.type === 'root') delete root.type;
  const def: ComponentDef = { id: createId('c'), name: name.trim() || branch.name || 'Component', root, props: [], variants: init.variants ?? [] };
  if (init.description) def.description = init.description;
  // Declared props win; placeholders found in the template are added with inferred types.
  const declared = init.props ?? [];
  def.props = [...declared, ...templateProps(root).filter((p) => !declared.some((d) => d.name === p.name))];
  return def;
}

/**
 * Save a branch of a tree as a new component. Unless the branch is the tree's root, it becomes
 * the first instance in its place (keeping its id), so it follows the component from then on.
 */
export function saveComponent(forest: Forest, treeId: string, branchId: string, name: string, init: Parameters<typeof createComponent>[2] = {}): { forest: Forest; component: ComponentDef } | null {
  const tree = forest.trees.find((t) => t.id === treeId);
  if (!tree) return null;
  let found: Branch | undefined;
  const replace = (node: TreeNode, make: (b: Branch) => Branch): TreeNode => {
    if (!isBranch(node)) return node;
    if (node.id === branchId) return make(node);
    const children = node.children.map((c) => replace(c, make));
    return children.some((c, i) => c !== node.children[i]) ? { ...node, children } : node;
  };
  replace(tree.root, (b) => ((found = b), b));
  if (!found) return null;
  let component = createComponent(name, found, init);
  if (found.id !== tree.root.id) {
    // The instance keeps the branch's id, so the template's root takes a new one: ids stay unique
    // across the forest. Variant styles keyed by the old id follow it.
    const rootId = createId('b');
    const rekey = (styles: ComponentVariant['styles']) => Object.fromEntries(Object.entries(styles).map(([id, st]) => [id === found!.id ? rootId : id, st]));
    component = { ...component, root: { ...component.root, id: rootId }, variants: component.variants.map((v) => ({ ...v, styles: rekey(v.styles) })) };
  } else {
    // The tree's root stays in the tree with all its branches, so the template gets new ids throughout.
    const ids = new Map<string, string>();
    const fresh = (node: TreeNode): TreeNode => {
      const id = createId(isBranch(node) ? 'b' : 'l');
      ids.set(node.id, id);
      return isBranch(node) ? { ...node, id, children: node.children.map(fresh) } : { ...node, id };
    };
    const root = fresh(component.root) as Branch;
    const rekey = (styles: ComponentVariant['styles']) => Object.fromEntries(Object.entries(styles).map(([id, st]) => [ids.get(id) ?? id, st]));
    component = { ...component, root, variants: component.variants.map((v) => ({ ...v, styles: rekey(v.styles) })) };
  }
  let next: Forest = { ...forest, components: [...(forest.components ?? []), component] };
  if (found.id !== tree.root.id) {
    const root = replace(tree.root, () => ({ ...instantiateComponent(component), id: branchId })) as Branch;
    next = { ...next, trees: next.trees.map((t) => (t.id === treeId ? { ...t, root } : t)) };
  }
  return { forest: syncInstances(next), component };
}

/** Look a component up by id or name (any case). */
export function findComponent(components: readonly ComponentDef[] | undefined, ref: string): ComponentDef | undefined {
  const list = components ?? [];
  return list.find((c) => c.id === ref) ?? list.find((c) => c.name.toLowerCase() === ref.toLowerCase());
}

/* ------------------------------------------------------------ editing as a tree */

/** Tree ids that open a component's template in the editor: `component:<id>`. */
export const COMPONENT_TREE_PREFIX = 'component:';
export const componentTreeId = (componentId: string): string => `${COMPONENT_TREE_PREFIX}${componentId}`;
export const isComponentTreeId = (treeId: string): boolean => treeId.startsWith(COMPONENT_TREE_PREFIX);
const BODY_PREFIX = 'cbody:';

/** Apply one variant to every display of the template, for previewing and editing it. */
function withVariant(def: ComponentDef, variantName: string | null | undefined): Branch {
  const variant = variantName ? def.variants.find((v) => v.name === variantName) : undefined;
  if (!variant) return def.root;
  const per = Object.fromEntries(DISPLAY_IDS.map((d) => [d, variant])) as Record<DisplayId, ComponentVariant>;
  const visit = (node: TreeNode): TreeNode => (isBranch(node) ? { ...node, styles: variantStyles(node.styles, node.id, per), children: node.children.map(visit) } : node);
  return visit(def.root) as Branch;
}

/** A template that only works inside an SVG: SVG-only itself, or (an `<a>`, a `<title>`) holding SVG-only content. */
function drawsInSvg(root: Branch): boolean {
  let svg = false;
  const visit = (n: TreeNode): void => {
    if (svg) return;
    if (isSvgOnly(n)) svg = true;
    else if (isBranch(n) && n.tag !== 'foreignObject') n.children.forEach(visit);
  };
  visit(root);
  return svg;
}

/** Whether an instance of the component sits inside an SVG, in a tree or in an SVG component's template. */
function usedInSvg(forest: Forest, componentId: string): boolean {
  const visit = (node: TreeNode, inSvg: boolean): boolean => {
    if (!isBranch(node)) return false;
    if (node.instance?.component === componentId && inSvg) return true;
    const inner = node.tag === 'foreignObject' ? false : inSvg || node.tag === 'svg';
    return node.children.some((c) => visit(c, inner));
  };
  return (
    forest.trees.some((t) => visit(t.root, false)) ||
    (forest.components ?? []).some((c) => c.id !== componentId && drawsInSvg(c.root) && visit(c.root, true))
  );
}

/**
 * A component's template as a tree, so the editor can open it like any other: a `<body>`
 * holding the template, with `variant`'s styles laid over when one is given.
 */
export function componentAsTree(def: ComponentDef, variant?: string | null, forest?: Forest): Tree {
  const ts = new Date(0).toISOString();
  return {
    id: componentTreeId(def.id),
    name: def.name,
    // An SVG-only template (a `<g>`, a shape group), or one with an instance inside an SVG, is
    // edited inside an `<svg>`, so it is drawn and the SVG placement rules apply to it.
    root: { kind: 'branch', id: `${BODY_PREFIX}${def.id}`, tag: drawsInSvg(def.root) || (forest && usedInSvg(forest, def.id)) ? 'svg' : 'body', type: 'root', name: def.name, classes: [], attrs: {}, styles: {}, children: [withVariant(def, variant)] },
    createdAt: ts,
    updatedAt: ts,
  };
}

/** A tree of the forest by id: a real tree, or a component's template opened as one. */
export function findTree(forest: Forest, treeId: string, variant?: string | null): Tree | undefined {
  if (isComponentTreeId(treeId)) {
    const def = forest.components?.find((c) => componentTreeId(c.id) === treeId);
    return def ? componentAsTree(def, variant, forest) : undefined;
  }
  return forest.trees.find((t) => t.id === treeId);
}

function stylesDiff(before: DisplayStyles, after: DisplayStyles): DisplayStyles {
  const out: DisplayStyles = {};
  for (const d of DISPLAY_IDS) {
    const a = before[d] ?? {};
    const b = after[d] ?? {};
    const changed: StyleMap = {};
    for (const [k, v] of Object.entries(b)) if (a[k] !== v) changed[k] = v;
    for (const k of Object.keys(a)) if (!(k in b)) changed[k] = 'unset';
    if (Object.keys(changed).length) out[d] = changed;
  }
  return out;
}

/**
 * Write an edited component tree back into its component. With `variant`, style changes go
 * into that variant's overrides and everything else (text, structure, attributes) into the
 * template; without, everything goes into the template. Instances are re-expanded.
 */
export function updateComponentTree(forest: Forest, treeId: string, fn: (root: Branch) => Branch, variant?: string | null): Forest {
  const def = forest.components?.find((c) => componentTreeId(c.id) === treeId);
  if (!def) return forest;
  const tree = componentAsTree(def, variant, forest);
  const nextBody = fn(tree.root);
  if (nextBody === tree.root) return forest;
  const kids = nextBody.children;
  // The body must hold exactly the template; anything else is wrapped into it.
  let nextRoot: Branch;
  const rootAt = kids.findIndex((k) => isBranch(k) && k.id === def.root.id);
  if (kids.length === 1 && isBranch(kids[0])) nextRoot = kids[0];
  else if (rootAt >= 0) {
    // Something added beside the template root goes inside it, before or after what it holds.
    const r = kids[rootAt] as Branch;
    // A void root (`<hr>`, `<input>`) can't hold them: they would never render.
    if (VOID_TAGS.has(r.tag.toLowerCase())) throw new Error(`The component's <${r.tag}> can't hold other branches`);
    nextRoot = { ...r, children: [...kids.slice(0, rootAt), ...r.children, ...kids.slice(rootAt + 1)] };
  } else {
    if (kids.length && VOID_TAGS.has(def.root.tag.toLowerCase())) throw new Error(`The component's <${def.root.tag}> can't hold other branches`);
    nextRoot = { ...def.root, children: kids };
  }
  const v = variant ? def.variants.find((x) => x.name === variant) : undefined;
  let next: ComponentDef;
  if (v) {
    // Style edits are relative to the variant's view; record them as overrides.
    const shown = new Map<string, DisplayStyles>();
    const collect = (node: TreeNode, into: Map<string, DisplayStyles>) => {
      if (!isBranch(node)) return;
      into.set(node.id, node.styles);
      node.children.forEach((c) => collect(c, into));
    };
    collect(tree.root.children[0], shown);
    const base = new Map<string, DisplayStyles>();
    collect(def.root, base);
    const overrides: Record<string, DisplayStyles> = { ...v.styles };
    const restore = (node: TreeNode): TreeNode => {
      if (!isBranch(node)) return node;
      const before = shown.get(node.id);
      let styles = node.styles;
      if (before) {
        const diff = stylesDiff(before, node.styles);
        if (Object.keys(diff).length) {
          const merged: DisplayStyles = { ...overrides[node.id] };
          for (const [d, map] of Object.entries(diff) as [DisplayId, StyleMap][]) merged[d] = { ...merged[d], ...map };
          overrides[node.id] = merged;
        }
        styles = base.get(node.id) ?? {};
      }
      return { ...node, styles, children: node.children.map(restore) };
    };
    nextRoot = restore(nextRoot) as Branch;
    next = { ...def, root: nextRoot, variants: def.variants.map((x) => (x === v ? { ...x, styles: overrides } : x)) };
  } else next = { ...def, root: nextRoot };
  return updateComponent(forest, { ...next, props: capturePropDefaults(def, next) });
}

/**
 * When a literal text or attribute becomes a placeholder (`Fast` → `{{title}}`), keep the old
 * value as the new prop's default, so instances keep showing it.
 */
function capturePropDefaults(before: ComponentDef, after: ComponentDef): ComponentProp[] {
  const known = new Set(componentProps(before).map((p) => p.name));
  const values = new Map<string, string>();
  const collect = (node: TreeNode) => {
    if (!isBranch(node)) {
      values.set(`${node.id}`, node.value);
      for (const [k, v] of Object.entries(node.attrs ?? {})) values.set(`${node.id}@${k}`, v);
      return;
    }
    for (const [k, v] of Object.entries(node.attrs)) values.set(`${node.id}@${k}`, v);
    node.children.forEach(collect);
  };
  collect(before.root);
  const props = [...after.props];
  const consider = (key: string, value: string) => {
    const old = values.get(key);
    if (old === undefined || placeholdersIn(old).length) return;
    const names = placeholdersIn(value);
    // Only a whole-value placeholder can take the old value as its default.
    if (names.length !== 1 || !new RegExp(`^\\{\\{\\s*${names[0]}\\s*\\}\\}$`).test(value.trim()) || known.has(names[0]) || props.some((p) => p.name === names[0])) return;
    const inferred = templateProps(after.root).find((p) => p.name === names[0]);
    props.push({ name: names[0], type: inferred?.type ?? 'text', default: old });
  };
  const visit = (node: TreeNode) => {
    if (!isBranch(node)) {
      consider(node.id, node.value);
      for (const [k, v] of Object.entries(node.attrs ?? {})) consider(`${node.id}@${k}`, v);
      return;
    }
    for (const [k, v] of Object.entries(node.attrs)) consider(`${node.id}@${k}`, v);
    node.children.forEach(visit);
  };
  visit(after.root);
  return props;
}

/** Replace a component and re-expand its instances. */
export function updateComponent(forest: Forest, def: ComponentDef): Forest {
  const components = (forest.components ?? []).map((c) => (c.id === def.id ? def : c));
  return syncInstances({ ...forest, components, updatedAt: new Date().toISOString() });
}
