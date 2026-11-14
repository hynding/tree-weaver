/** Where a change came from, so a history can show who made it. */
export type ChangeSource = 'editor' | 'host' | 'agent' | 'import' | 'restore' | 'collab';

/** Describes one change: who made it, when, and an optional label (else one is worked out from a diff). */
export interface ChangeMeta {
  source?: ChangeSource;
  /** ISO time of the change. */
  at?: string;
  label?: string;
}

/** One state in a history's timeline. */
export interface TimelineEntry<T> {
  state: T;
  /** The change that led to this state. Missing for the oldest state kept. */
  change?: ChangeMeta;
  /** Steps from the current state: negative for undo steps, positive for redo steps, 0 for the current state. */
  offset: number;
}

interface Step<T> {
  state: T;
  /** The change between this step's state and the one after it. */
  meta: ChangeMeta;
}

/** A bounded undo/redo stack of immutable snapshots, each labelled with the change that left it. */
export class History<T> {
  private past: Step<T>[] = [];
  /** Newest redo step last. Each holds a later state and the change that led to it. */
  private future: Step<T>[] = [];

  constructor(private readonly limit = 100) {}

  /** Record `previous` as an undo step before moving to a new state, described by `meta`. */
  push(previous: T, meta: ChangeMeta = {}): void {
    this.past.push({ state: previous, meta: { at: new Date().toISOString(), ...meta } });
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  undo(current: T): T | undefined {
    const step = this.past.pop();
    if (!step) return undefined;
    this.future.push({ state: current, meta: step.meta });
    return step.state;
  }

  redo(current: T): T | undefined {
    const step = this.future.pop();
    if (!step) return undefined;
    this.past.push({ state: current, meta: step.meta });
    return step.state;
  }

  /** Move `offset` steps from `current` (negative undoes). Returns the state reached, or undefined when it can't move that far. */
  go(current: T, offset: number): T | undefined {
    if (offset === 0 || (offset < 0 ? -offset > this.past.length : offset > this.future.length)) return undefined;
    let state = current;
    for (let i = 0; i < Math.abs(offset); i++) state = (offset < 0 ? this.undo(state) : this.redo(state)) as T;
    return state;
  }

  /** Every state kept, oldest first, with `current` at offset 0. */
  timeline(current: T): TimelineEntry<T>[] {
    const out: TimelineEntry<T>[] = [];
    const n = this.past.length;
    this.past.forEach((step, i) => out.push({ state: step.state, change: i > 0 ? this.past[i - 1].meta : undefined, offset: i - n }));
    out.push({ state: current, change: n ? this.past[n - 1].meta : undefined, offset: 0 });
    [...this.future].reverse().forEach((step, i) => out.push({ state: step.state, change: step.meta, offset: i + 1 }));
    return out;
  }

  clear(): void {
    this.past = [];
    this.future = [];
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }
}
