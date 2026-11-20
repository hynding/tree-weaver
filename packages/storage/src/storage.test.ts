import { createForest, createTree } from '@tree-weaver/core';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { IndexedDbForestStore, IndexedDbRecordStore, LocalStorageForestStore, MemoryForestStore, MemoryRecordStore, Preferences, type ForestStore } from './index';

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

describe('record stores', () => {
  for (const [label, make] of [
    ['memory', () => new MemoryRecordStore<{ id: string; n: number }>()],
    ['indexeddb', () => new IndexedDbRecordStore<{ id: string; n: number }>('tw-test-records', new IDBFactory())],
  ] as const) {
    it(`${label}: puts, lists, gets and removes`, async () => {
      const store = make();
      await store.put({ id: 'a', n: 1 });
      await store.put({ id: 'b', n: 2 });
      await store.put({ id: 'a', n: 3 });
      expect((await store.list()).sort((x, y) => x.id.localeCompare(y.id))).toEqual([
        { id: 'a', n: 3 },
        { id: 'b', n: 2 },
      ]);
      expect(await store.get('b')).toEqual({ id: 'b', n: 2 });
      await store.remove('b');
      expect(await store.get('b')).toBeNull();
    });
  }
});

describe('IndexedDB writes', () => {
  it('rejects a save whose transaction aborts at commit', async () => {
    const factory = new IDBFactory();
    const store = new IndexedDbForestStore(factory, 'abort-test');
    const forest = createForest('F', [createTree('T')]);
    await store.save(forest);
    // Abort every write transaction right after its request succeeds, as a full quota does.
    const db = await (store as unknown as { open(): Promise<IDBDatabase> }).open();
    const tx = db.transaction.bind(db);
    db.transaction = ((...args: Parameters<IDBDatabase['transaction']>) => {
      const t = tx(...args);
      if (args[1] === 'readwrite') {
        const objectStore = t.objectStore.bind(t);
        t.objectStore = (name: string) => {
          const os = objectStore(name);
          const put = os.put.bind(os);
          os.put = (...a: Parameters<IDBObjectStore['put']>) => {
            const req = put(...a);
            req.addEventListener('success', () => t.abort());
            return req;
          };
          return os;
        };
      }
      return t;
    }) as IDBDatabase['transaction'];
    await expect(store.save({ ...forest, name: 'G' })).rejects.toBeTruthy();
    db.transaction = tx;
    expect((await store.load(forest.id))!.name).toBe('F');
  });

  it('retries opening after a failed open', async () => {
    const factory = new IDBFactory();
    let fail = true;
    const flaky = new Proxy(factory, {
      get(target, prop) {
        if (prop === 'open' && fail) {
          fail = false;
          return () => {
            const req = { onerror: null as null | (() => void), error: new Error('nope') } as unknown as IDBOpenDBRequest;
            setTimeout(() => (req as unknown as { onerror: () => void }).onerror());
            return req;
          };
        }
        const v = Reflect.get(target, prop);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    const store = new IndexedDbForestStore(flaky, 'retry-test');
    await expect(store.list()).rejects.toThrow('nope');
    expect(await store.list()).toEqual([]);
  });
});
