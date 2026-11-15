import { describe, expect, it } from 'vitest';
import {
  componentProps,
  createComponent,
  detachInstance,
  expandComponent,
  instancesOf,
  instantiateComponent,
  saveComponent,
  syncInstances,
  variantStyles,
  variantPerDisplay,
  type ComponentDef,
} from './components';
import { createBranch, createForest, createLeaf, createTree, text } from './create';
import { resolveStyles } from './displays';
import { setStyle, updateNode, updateTreeRoot } from './ops';
import { componentTreeId, findTree } from './components';
import type { Branch, Leaf } from './model';
import { normalizeForest } from './normalize';
import { validateDocument } from './validate';

/** A card: a title, an optional badge, a link and a row layout that variants change. */
function cardDef(): ComponentDef {
  const title = createBranch({ tag: 'h3', children: [text('{{title}}')] });
  title.id = 'b_title';
  const badge = createBranch({ tag: 'span', classes: ['badge'], attrs: { 'data-show-if': 'badge' }, children: [text('New')] });
  const link = createBranch({ tag: 'a', attrs: { href: '{{link}}' }, children: [text('Read more')] });
  const img = createLeaf('{{image}}', 'image', { alt: '{{title}}' });
  const root = createBranch({
    tag: 'article',
    name: 'Card',
    classes: ['card', 'card-{{tone}}'],
    styles: { lg: { display: 'flex', gap: '16px', padding: '24px' } },
    children: [img, title, badge, link],
  });
  root.id = 'b_root';
  return createComponent('Card', root, {
    props: [{ name: 'title', type: 'text', default: 'Card title' }],
    variants: [
      { name: 'stacked', styles: { b_root: { lg: { 'flex-direction': 'column', gap: '8px' } } } },
      { name: 'compact', styles: { b_root: { lg: { padding: '8px' }, 'mobile-portrait': { padding: '4px' } }, b_title: { lg: { 'font-size': '14px' } } } },
    ],
  });
}

const textOf = (b: Branch): string =>
  b.children
    .map((c) => (c.kind === 'leaf' ? c.value : textOf(c)))
    .join('|');

describe('reusable components', () => {
  it('infers props from placeholders, keeping declared ones first', () => {
    const def = cardDef();
    expect(def.root.tag).toBe('article');
    expect(componentProps(def).map((p) => `${p.name}:${p.type}`)).toEqual(['title:text', 'tone:enum', 'image:image', 'badge:boolean', 'link:url']);
  });

  it('fills props, applies data-show-if and uses defaults', () => {
    const def = cardDef();
    const plain = instantiateComponent(def);
    expect(plain.instance).toEqual({ component: def.id });
    expect(plain.classes).toEqual(['card', 'card-']);
    expect(textOf(plain)).toBe('|Card title|Read more');
    const full = instantiateComponent(def, { title: 'Hello', badge: 'true', link: 'https://x.dev', tone: 'warm', image: 'https://x.dev/a.png' });
    expect(full.classes).toEqual(['card', 'card-warm']);
    expect(textOf(full)).toBe('https://x.dev/a.png|Hello|New|Read more');
    const link = full.children[3] as Branch;
    expect(link.attrs.href).toBe('https://x.dev');
    expect(link.attrs['data-show-if']).toBeUndefined();
    expect((full.children[0] as Leaf).attrs?.alt).toBe('Hello');
    // Expanded ids are stable and unique per instance.
    expect(full.children[1].id).toBe(`${full.id}~b_title`);
  });

  it('lays variants over the base styles, per display', () => {
    const def = cardDef();
    const compact = expandComponent(def, { component: def.id, variants: { lg: 'compact' } }, 'b_i');
    expect(compact.styles.lg).toEqual({ display: 'flex', gap: '16px', padding: '8px' });
    expect(compact.styles['mobile-portrait']).toEqual({ padding: '4px' });
    expect((compact.children[1] as Branch).styles.lg).toEqual({ 'font-size': '14px' });
  });

  it('switches variants at a breakpoint, undoing what the wider variant set', () => {
    const def = cardDef();
    const perDisplay = variantPerDisplay(def, { lg: 'stacked', tablet: 'compact' });
    expect(perDisplay['mobile-portrait']?.name).toBe('compact');
    expect(perDisplay.xl?.name).toBe('stacked');
    const styles = variantStyles(def.root.styles, 'b_root', perDisplay);
    expect(resolveStyles(styles, 'lg')).toEqual({ display: 'flex', gap: '8px', padding: '24px', 'flex-direction': 'column' });
    // On a tablet the stacked direction is undone and the base gap comes back.
    expect(resolveStyles(styles, 'tablet')).toEqual({ display: 'flex', gap: '16px', padding: '8px', 'flex-direction': 'unset' });
    expect(resolveStyles(styles, 'mobile-portrait')).toMatchObject({ padding: '4px', gap: '16px' });
  });

  it('keeps instances in sync with their component and can detach them', () => {
    const def = cardDef();
    const inst = instantiateComponent(def, { title: 'One' });
    const forest = { ...createForest('F', [createTree('Home', createBranch({ tag: 'body', children: [inst] }))]), components: [def] };
    const edited: ComponentDef = { ...def, root: { ...def.root, styles: { lg: { display: 'grid' } } } };
    const synced = syncInstances({ ...forest, components: [edited] });
    const again = synced.trees[0].root.children[0] as Branch;
    expect(again.id).toBe(inst.id);
    expect(again.styles.lg).toEqual({ display: 'grid' });
    expect(textOf(again)).toContain('One');
    expect(instancesOf(synced, def.id)).toHaveLength(1);
    expect(detachInstance(again).instance).toBeUndefined();
    // Nothing to sync: the same object comes back.
    expect(syncInstances(synced)).toBe(synced);
  });

  it('turns a tree root into a div and flattens nested instances', () => {
    const def = cardDef();
    const body = createBranch({ tag: 'body', type: 'root', children: [instantiateComponent(def)] });
    const page = createComponent('Page', body);
    expect(page.root.tag).toBe('div');
    expect(page.root.type).toBeUndefined();
    expect((page.root.children[0] as Branch).instance).toBeUndefined();
  });

  it('round-trips through normalize and validates', () => {
    const def = cardDef();
    const inst = instantiateComponent(def, { title: 'One' }, { lg: 'stacked', 'mobile-portrait': 'compact' });
    const forest = { ...createForest('F', [createTree('Home', createBranch({ tag: 'body', children: [inst] }))]), components: [def] };
    const data = JSON.parse(JSON.stringify(forest));
    const back = normalizeForest(data);
    expect(back.components?.[0]).toEqual(def);
    expect((back.trees[0].root.children[0] as Branch).instance).toEqual({ component: def.id, props: { title: 'One' }, variants: { lg: 'stacked', 'mobile-portrait': 'compact' } });
    const report = validateDocument({ format: 'tree-weaver', version: 1, forest: data });
    expect(report.errors).toEqual([]);
    expect(report.warnings.filter((w) => /unknown|Unknown/.test(w.message))).toEqual([]);
  });

  it('re-expands instances on import, so a stale copy is corrected', () => {
    const def = cardDef();
    const inst = instantiateComponent(def, { title: 'One' });
    inst.children = [text('stale')];
    const forest = { ...createForest('F', [createTree('Home', createBranch({ tag: 'body', children: [inst] }))]), components: [def] };
    const back = normalizeForest(JSON.parse(JSON.stringify(forest)));
    expect(textOf(back.trees[0].root.children[0] as Branch)).toBe('|One|Read more');
  });

  it('edits a component as a tree: the template, or a variant\'s overrides', () => {
    const def = cardDef();
    const inst = instantiateComponent(def, { title: 'One' }, { lg: 'compact' });
    let forest = { ...createForest('F', [createTree('Home', createBranch({ tag: 'body', children: [inst] }))]), components: [def] };
    const treeId = componentTreeId(def.id);
    expect(findTree(forest, treeId)?.root.children[0].id).toBe('b_root');
    // Base edit: the instance follows.
    forest = updateTreeRoot(forest, treeId, (root) => setStyle(root, 'b_root', 'lg', 'background', 'red'));
    expect(forest.components![0].root.styles.lg).toMatchObject({ background: 'red' });
    expect((forest.trees[0].root.children[0] as Branch).styles.lg).toMatchObject({ background: 'red', padding: '8px' });
    // Variant edit: shown with the variant laid over; the change lands in the variant only.
    expect(findTree(forest, treeId, 'compact')?.root.children[0]).toMatchObject({ styles: { lg: { padding: '8px' } } });
    forest = updateTreeRoot(forest, treeId, (root) => setStyle(root, 'b_root', 'lg', 'padding', '2px'), 'compact');
    expect(forest.components![0].root.styles.lg).toMatchObject({ padding: '24px' });
    expect(forest.components![0].variants[1].styles.b_root.lg).toMatchObject({ padding: '2px' });
    expect((forest.trees[0].root.children[0] as Branch).styles.lg).toMatchObject({ padding: '2px' });
  });

  it('keeps branches inside an instance following the component', () => {
    const def = cardDef();
    const inst = instantiateComponent(def, { title: 'One' });
    const forest = { ...createForest('F', [createTree('Home', createBranch({ tag: 'body', children: [inst] }))]), components: [def] };
    const tree = forest.trees[0];
    const edited = updateTreeRoot(forest, tree.id, (root) => setStyle(root, `${inst.id}~b_title`, 'lg', 'color', 'red'));
    expect(edited).toBe(forest);
  });

  it('keeps the old text as the default when it becomes a placeholder', () => {
    const def = createComponent('Note', createBranch({ tag: 'div', children: [createBranch({ tag: 'p', children: [text('Hello')] })] }));
    const leafId = ((def.root.children[0] as Branch).children[0] as Leaf).id;
    let forest = { ...createForest('F', [createTree('Home', createBranch({ tag: 'body', children: [instantiateComponent(def)] }))]), components: [def] };
    forest = updateTreeRoot(forest, componentTreeId(def.id), (root) => updateNode(root, leafId, (n) => ({ ...n, value: '{{message}}' }) as Leaf));
    expect(forest.components![0].props).toEqual([{ name: 'message', type: 'text', default: 'Hello' }]);
    expect(textOf(forest.trees[0].root.children[0] as Branch)).toBe('Hello');
  });

  it('saves a branch as a component and puts the first instance in its place', () => {
    const card = createBranch({ tag: 'article', children: [createBranch({ tag: 'h3', children: [text('{{title}}')] })] });
    const tree = createTree('Home', createBranch({ tag: 'body', children: [card] }));
    const forest = createForest('F', [tree]);
    const saved = saveComponent(forest, tree.id, card.id, 'Card')!;
    expect(saved.component.props.map((p) => p.name)).toEqual(['title']);
    const inst = saved.forest.trees[0].root.children[0] as Branch;
    expect(inst.id).toBe(card.id);
    expect(inst.instance).toEqual({ component: saved.component.id });
    expect(saveComponent(forest, tree.id, 'missing', 'X')).toBeNull();
    // Saving a tree's root leaves the tree as it is.
    const whole = saveComponent(forest, tree.id, tree.root.id, 'Page')!;
    expect(whole.forest.trees[0]).toBe(forest.trees[0]);
    expect(whole.component.root.tag).toBe('div');
  });
});
