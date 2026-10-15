import { normalizeForest, type Forest, type ForestSummary } from '@tree-weaver/core';

/** Local persistence for forests. Every implementation stores whole forests by id. */
export interface ForestStore {
  readonly kind: 'indexeddb' | 'localstorage' | 'memory';
  list(): Promise<ForestSummary[]>;
  load(id: string): Promise<Forest | null>;
  save(forest: Forest): Promise<void>;
  remove(id: string): Promise<void>;
}

export const summarize = (forest: Forest): ForestSummary => ({
  id: forest.id,
  name: forest.name,
  treeCount: forest.trees.length,
  updatedAt: forest.updatedAt,
});

const newestFirst = (a: ForestSummary, b: ForestSummary) => b.updatedAt.localeCompare(a.updatedAt);

/** Stored data is re-validated on the way out, so a damaged record can't break the editor. */
function revive(value: unknown): Forest | null {
  if (!value) return null;
  try {
    return normalizeForest(value);
  } catch {
    return null;
  }
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export class MemoryForestStore implements ForestStore {
  readonly kind = 'memory' as const;
  private readonly forests = new Map<string, Forest>();

  async list() {
    return [...this.forests.values()].map(summarize).sort(newestFirst);
  }
  async load(id: string) {
    const f = this.forests.get(id);
    return f ? clone(f) : null;
  }
  async save(forest: Forest) {
    this.forests.set(forest.id, clone(forest));
  }
  async remove(id: string) {
    this.forests.delete(id);
  }
}

/** Stores each forest under `<prefix>forest:<id>` and keeps an index of summaries. */
export class LocalStorageForestStore implements ForestStore {
  readonly kind = 'localstorage' as const;

  constructor(
    private readonly storage: Storage,
    private readonly prefix = 'tree-weaver:',
  ) {}

  private key = (id: string) => `${this.prefix}forest:${id}`;
  private get indexKey() {
    return `${this.prefix}forests`;
  }

  private readIndex(): ForestSummary[] {
    try {
      const raw = JSON.parse(this.storage.getItem(this.indexKey) ?? '[]') as unknown;
      return Array.isArray(raw) ? (raw as ForestSummary[]) : [];
    } catch {
      return [];
    }
  }

  private writeIndex(index: ForestSummary[]) {
    this.storage.setItem(this.indexKey, JSON.stringify(index));
  }

  async list() {
    return this.readIndex().sort(newestFirst);
  }

  async load(id: string) {
    const raw = this.storage.getItem(this.key(id));
    if (!raw) return null;
    try {
      return revive(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  async save(forest: Forest) {
    this.storage.setItem(this.key(forest.id), JSON.stringify(forest));
    this.writeIndex([...this.readIndex().filter((s) => s.id !== forest.id), summarize(forest)]);
  }

  async remove(id: string) {
    this.storage.removeItem(this.key(id));
    this.writeIndex(this.readIndex().filter((s) => s.id !== id));
  }
}

const STORE = 'forests';

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class IndexedDbForestStore implements ForestStore {
  readonly kind = 'indexeddb' as const;
  private db: Promise<IDBDatabase> | null = null;

  constructor(
    private readonly factory: IDBFactory = globalThis.indexedDB,
    private readonly name = 'tree-weaver',
  ) {}

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const req = this.factory.open(this.name, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('The Tree Weaver database is blocked by another tab'));
    });
    return this.db;
  }

  private async store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    return (await this.open()).transaction(STORE, mode).objectStore(STORE);
  }

  async list() {
    const all = (await request((await this.store('readonly')).getAll())) as unknown[];
    return all
      .map(revive)
      .filter((f): f is Forest => f !== null)
      .map(summarize)
      .sort(newestFirst);
  }

  async load(id: string) {
    return revive(await request((await this.store('readonly')).get(id)));
  }

  async save(forest: Forest) {
    await request((await this.store('readwrite')).put(clone(forest)));
  }

  async remove(id: string) {
    await request((await this.store('readwrite')).delete(id));
  }

  close(): void {
    void this.db?.then((db) => db.close());
    this.db = null;
  }
}

/** IndexedDB when the browser has it, else localStorage, else memory (nothing persists). */
export async function createForestStore(): Promise<ForestStore> {
  if (typeof globalThis.indexedDB !== 'undefined') {
    const store = new IndexedDbForestStore();
    try {
      await store.list();
      return store;
    } catch {
      // Private browsing modes can refuse IndexedDB; fall through.
    }
  }
  try {
    if (typeof globalThis.localStorage !== 'undefined') {
      const probe = '__tree-weaver-probe__';
      globalThis.localStorage.setItem(probe, '1');
      globalThis.localStorage.removeItem(probe);
      return new LocalStorageForestStore(globalThis.localStorage);
    }
  } catch {
    // Storage disabled.
  }
  return new MemoryForestStore();
}

/** Small per-browser preferences (last open forest, selected display, panel widths...). */
export class Preferences<T extends Record<string, unknown>> {
  constructor(
    private readonly defaults: T,
    private readonly key = 'tree-weaver:prefs',
    private readonly storage: Storage | undefined = typeof localStorage === 'undefined' ? undefined : localStorage,
  ) {}

  read(): T {
    try {
      const raw = this.storage?.getItem(this.key);
      return raw ? { ...this.defaults, ...(JSON.parse(raw) as Partial<T>) } : { ...this.defaults };
    } catch {
      return { ...this.defaults };
    }
  }

  write(patch: Partial<T>): T {
    const next = { ...this.read(), ...patch };
    try {
      this.storage?.setItem(this.key, JSON.stringify(next));
    } catch {
      // Quota exceeded or storage disabled: preferences are best effort.
    }
    return next;
  }
}
