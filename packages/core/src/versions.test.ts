import { describe, expect, it } from 'vitest';
import {
  addVersion,
  createBranch,
  createForest,
  createKit,
  createTree,
  describeDiff,
  diffForests,
  diffTrees,
  emptyVersionLog,
  findVersion,
  formatDiff,
  History,
  insertNode,
  moveNode,
  parseVersionLog,
  removeNode,
  setStyle,
  text,
  versionLogPath,
  type Branch,
  type Tree,
} from './index';

const b = (id: string, init: Parameters<typeof createBranch>[0]): Branch => ({ ...createBranch(init), id });

function sample(): Tree {
  const root = b('root', { tag: 'body' });
  root.children = [
    b('h', { tag: 'header', name: 'Header' }),
    b('m', { tag: 'main', name: 'Main', children: [text('Hello')] }),
    b('f', { tag: 'footer', name: 'Footer' }),
  ];
  return { ...createTree('Home', root), id: 't1' };
}

const withRoot = (t: Tree, root: Branch): Tree => ({ ...t, root });

describe('diffTrees', () => {
  it('finds added, removed, changed and moved nodes', () => {
    const a = sample();
    let root = insertNode(a.root, 'm', b('card', { tag: 'section', name: 'Card', children: [text('inside')] }));
    root = removeNode(root, 'f');
    root = setStyle(root, 'h', 'tablet', 'color', 'red');
    root = moveNode(root, 'h', 'm');
    const d = diffTrees(a, withRoot(a, root));
    expect(d.status).toBe('changed');
    const kinds = d.changes.map((c) => `${c.kind}:${c.id}`).sort();
    // The card's text is part of the card's addition, not its own entry.
    expect(kinds).toEqual(['added:card', 'changed:h', 'moved:h', 'removed:f'].sort());
    expect(d.changes.find((c) => c.kind === 'changed')).toMatchObject({ fields: ['styles'], displays: ['tablet'] });
  });

  it('reports only the node that moved, not the siblings it passed', () => {
    const a = sample();
    const root = moveNode(a.root, 'f', 'root', 0);
    const d = diffTrees(a, withRoot(a, root));
    expect(d.changes).toEqual([{ kind: 'moved', id: 'f', label: 'Footer' }]);
  });

  it('sees text edits and renames', () => {
    const a = sample();
    const b = structuredClone(a);
    b.name = 'Start';
    ((b.root.children[1] as Branch).children[0] as { value: string }).value = 'Hi there';
    const d = diffTrees(a, b);
    expect(d.renamed).toEqual({ from: 'Home', to: 'Start' });
    expect(d.changes).toEqual([{ kind: 'changed', id: expect.any(String), label: '“Hi there”', fields: ['value'] }]);
  });

  it('calls identical trees unchanged', () => {
    const a = sample();
    expect(diffTrees(a, structuredClone(a))).toMatchObject({ status: 'unchanged', changes: [] });
  });
});

describe('diffForests', () => {
  it('covers trees and kits, and describes the change', () => {
    const t = sample();
    const before = createForest('Site', [t]);
    before.kits = [createKit('Base', 'body{}')];
    const extra = { ...createTree('About'), id: 't2' };
    const after = { ...before, trees: [t, extra], kits: [{ ...before.kits[0], css: 'body{margin:0}' }] };
    const d = diffForests(before, after);
    expect(d.empty).toBe(false);
    expect(d.trees).toMatchObject([{ id: 't2', status: 'added' }]);
    expect(d.kits).toMatchObject([{ status: 'changed', name: 'Base' }]);
    expect(formatDiff(d)).toBe('+ Added tree “About”\n~ Changed kit “Base”');
    expect(describeDiff(diffForests(before, before))).toBe('No changes');
  });

  it('summarises one node change in words, and many as counts', () => {
    const t = sample();
    const before = createForest('Site', [t]);
    const one = { ...before, trees: [withRoot(t, removeNode(t.root, 'f'))] };
    expect(describeDiff(diffForests(before, one))).toBe('Removed Footer');
    const many = { ...before, trees: [withRoot(t, removeNode(removeNode(t.root, 'f'), 'h'))] };
    expect(describeDiff(diffForests(before, many))).toBe('Removed 2 nodes');
  });
});

describe('History timeline', () => {
  it('labels each state with the change that led to it and jumps between them', () => {
    const h = new History<string>();
    h.push('a', { source: 'editor' });
    h.push('b', { source: 'agent', label: 'patch' });
    // a -> b (editor) -> c (agent) is current
    let line = h.timeline('c');
    expect(line[0].start).toBe(true);
    expect(line.map((e) => [e.state, e.offset, e.change?.source])).toEqual([
      ['a', -2, undefined],
      ['b', -1, 'editor'],
      ['c', 0, 'agent'],
    ]);
    expect(h.go('c', -2)).toBe('a');
    line = h.timeline('a');
    expect(line.map((e) => [e.state, e.offset, e.change?.source])).toEqual([
      ['a', 0, undefined],
      ['b', 1, 'editor'],
      ['c', 2, 'agent'],
    ]);
    expect(h.go('a', 3)).toBeUndefined();
    expect(h.go('a', 2)).toBe('c');
    expect(h.canRedo).toBe(false);
  });
});

describe('History limit', () => {
  it('stops calling the oldest state the start once older ones are dropped', () => {
    const h = new History<number>(1);
    h.push(1);
    h.push(2);
    expect(h.timeline(3)[0]).toMatchObject({ state: 2 });
    expect(h.timeline(3)[0].start).toBeUndefined();
  });
});

describe('wraps', () => {
  it('reports nodes moved into a new branch, and their edits', () => {
    const a = sample();
    const wrapper = b('w', { tag: 'div', name: 'Wrapper' });
    const header = { ...(a.root.children[0] as Branch), name: 'Top' };
    wrapper.children = [header, a.root.children[1]];
    const after = withRoot(a, { ...a.root, children: [wrapper, a.root.children[2]] });
    const kinds = diffTrees(a, after).changes.map((c) => `${c.kind}:${c.id}`).sort();
    expect(kinds).toEqual(['added:w', 'changed:h', 'moved:h', 'moved:m']);
  });

  it('mentions tree-level changes next to node counts', () => {
    const t = sample();
    const before = createForest('Site', [t]);
    const after = { ...before, name: 'Shop', trees: [withRoot(t, removeNode(removeNode(t.root, 'f'), 'h'))] };
    expect(describeDiff(diffForests(before, after))).toBe('Removed 2 nodes, and 1 other change');
  });
});

describe('version logs', () => {
  it('adds, finds and caps automatic versions', () => {
    let log = emptyVersionLog();
    log = addVersion(log, { name: 'Named', document: '{}', format: 'json' }).log;
    for (let i = 0; i < 4; i++) log = addVersion(log, { document: `{"n":${i}}`, format: 'json', auto: true }, 2).log;
    expect(log.versions.map((v) => v.name)).toEqual(['Named', 'Automatic', 'Automatic']);
    expect(findVersion(log, 'named')?.document).toBe('{}');
    expect(findVersion(log, 'latest')?.document).toBe('{"n":3}');
    expect(findVersion(log, '-2')?.document).toBe('{"n":2}');
    expect(findVersion(log, '1')?.name).toBe('Named');
    expect(findVersion(log, log.versions[1].id)).toBe(log.versions[1]);
    expect(parseVersionLog(JSON.stringify(log))).toEqual(log);
    expect(parseVersionLog('not json')).toEqual(emptyVersionLog());
    expect(() => parseVersionLog('not json', true)).toThrow(/damaged/);
    expect(() => parseVersionLog('{"versions": 3}', true)).toThrow(/damaged/);
  });

  it('puts the log in a .tree-weaver folder next to the document', () => {
    expect(versionLogPath('site/home.tree.json')).toBe('site/.tree-weaver/home.tree.json.versions.json');
    expect(versionLogPath('home.yaml')).toBe('.tree-weaver/home.yaml.versions.json');
    expect(versionLogPath('C:\\work\\a.json')).toBe('C:\\work\\.tree-weaver\\a.json.versions.json');
  });
});
