import { createForest, createTree } from '@tree-weaver/core';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { IndexedDbForestStore, LocalStorageForestStore, MemoryForestStore, Preferences, type ForestStore } from './index';

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  clear() {
    this.data.clear();
  }
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  setItem(key: string, value: string) {
    this.data.set(key, String(value));
  }
}

const stores: [string, () => ForestStore][] = [
  ['memory', () => new MemoryForestStore()],
  ['localStorage', () => new LocalStorageForestStore(new MemoryStorage())],
  ['IndexedDB', () => new IndexedDbForestStore(new IDBFactory())],
];

describe.each(stores)('%s store', (_name, make) => {
  it('saves, lists newest first, loads and removes forests', async () => {
    const store = make();
    const older = { ...createForest('Older'), updatedAt: '2020-01-01T00:00:00.000Z' };
    const newer = createForest('Newer', [createTree('A'), createTree('B')]);
    await store.save(older);
    await store.save(newer);
    expect((await store.list()).map((s) => [s.name, s.treeCount])).toEqual([
      ['Newer', 2],
      ['Older', 1],
    ]);
    expect(await store.load(newer.id)).toEqual(newer);
    await store.save({ ...newer, name: 'Renamed' });
    expect((await store.list()).map((s) => s.name)).toEqual(['Renamed', 'Older']);
    await store.remove(older.id);
    expect(await store.load(older.id)).toBeNull();
    expect(await store.list()).toHaveLength(1);
  });

  it('returns copies, not live references', async () => {
    const store = make();
    const forest = createForest('F');
    await store.save(forest);
    const loaded = (await store.load(forest.id))!;
    loaded.name = 'changed';
    expect((await store.load(forest.id))!.name).toBe('F');
  });
});

describe('Preferences', () => {
  it('merges defaults with stored values', () => {
    const storage = new MemoryStorage();
    const prefs = new Preferences({ display: 'lg', forestId: '' }, 'k', storage);
    expect(prefs.read()).toEqual({ display: 'lg', forestId: '' });
    prefs.write({ forestId: 'f_1' });
    expect(new Preferences({ display: 'lg', forestId: '' }, 'k', storage).read()).toEqual({ display: 'lg', forestId: 'f_1' });
  });
});
