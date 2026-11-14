import { Component, State, h } from '@stencil/core';
import { describeDiff, diffForests, diffLines, type ChangeSource, type Forest, type ForestDiff } from '@tree-weaver/core';
import { goToHistory, historyTimeline } from '../../store/actions';
import { state, type ForestVersion } from '../../store/editor';
import { compareWithCurrent, deleteVersion, renameVersion, restoreVersion, saveVersion } from '../../store/versions';
import { Icon } from '../../utils/icons';

const SOURCE_LABEL: Record<ChangeSource, string> = {
  editor: 'You',
  host: 'Host page',
  agent: 'Agent',
  import: 'Import',
  restore: 'Restore',
  collab: 'Collaborator',
};

const time = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString(undefined, { timeStyle: 'short' }) : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

/** Labels worked out from diffs, keyed by the state a change led to. States never change, so the cache never goes stale. */
const labels = new WeakMap<Forest, string>();

function labelFor(prev: Forest | undefined, next: Forest, given?: string): string {
  if (given) return given;
  if (!prev) return 'Opened';
  let label = labels.get(next);
  if (label === undefined) {
    label = describeDiff(diffForests(prev, next));
    labels.set(next, label);
  }
  return label;
}

const marker = (line: string) => (line.startsWith('Added') ? 'added' : line.startsWith('Removed') ? 'removed' : line.startsWith('Moved') ? 'moved' : 'changed');

function DiffList({ diff }: { diff: ForestDiff }) {
  if (diff.empty) return <p class="hint">Same as the open forest.</p>;
  const lines = diffLines(diff);
  return (
    <ul class="diff-list" aria-label="Changes since this version">
      {lines.slice(0, 60).map((l) => (
        <li class={`diff-${marker(l)}`}>{l}</li>
      ))}
      {lines.length > 60 && <li class="hint">…and {lines.length - 60} more</li>}
    </ul>
  );
}

/**
 * The open forest's history: every undo step this session (with who made it: you, the host
 * page, an agent), and versions saved in this browser, which can be compared and restored.
 */
@Component({ tag: 'tw-history-panel' })
export class TwHistoryPanel {
  @State() name = '';
  @State() comparing: string | null = null;
  @State() renaming: string | null = null;
  @State() confirmDelete: string | null = null;

  private async save(ev: Event) {
    ev.preventDefault();
    const v = await saveVersion(this.name);
    if (v) this.name = '';
  }

  private renderVersion(v: ForestVersion) {
    const diff = this.comparing === v.id ? compareWithCurrent(v.id) : null;
    return (
      <div class="version" key={v.id}>
        <div class="list-item">
          {this.renaming === v.id ? (
            <input
              class="input grow"
              value={v.name}
              aria-label="Version name"
              ref={(el) => el?.focus()}
              onChange={(e) => void renameVersion(v.id, (e.target as HTMLInputElement).value)}
              onBlur={() => (this.renaming = null)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === 'Escape') && (this.renaming = null)}
            />
          ) : (
            <span class="title" title="Double-click to rename" onDblClick={() => (this.renaming = v.id)}>
              {v.name}
              <div class="meta">
                {time(v.createdAt)} · {v.auto ? `automatic, before ${SOURCE_LABEL[v.source].toLowerCase()} changes` : SOURCE_LABEL[v.source]}
              </div>
            </span>
          )}
          <button class={{ 'icon-btn': true, active: this.comparing === v.id }} title="Compare with the open forest" aria-pressed={String(this.comparing === v.id)} onClick={() => (this.comparing = this.comparing === v.id ? null : v.id)}>
            <Icon name="eye" />
          </button>
          <button class="icon-btn" title="Restore this version (undoable)" onClick={() => restoreVersion(v.id)}>
            <Icon name="undo" />
          </button>
          <button class="icon-btn danger" title="Delete version" onClick={() => (this.confirmDelete = v.id)}>
            <Icon name="trash" />
          </button>
        </div>
        {this.confirmDelete === v.id && (
          <div class="confirm-row">
            Delete “{v.name}”?
            <button class="btn small danger" onClick={() => ((this.confirmDelete = null), void deleteVersion(v.id))}>
              Delete
            </button>
            <button class="btn small" onClick={() => (this.confirmDelete = null)}>
              Keep
            </button>
          </div>
        )}
        {diff && <DiffList diff={diff} />}
      </div>
    );
  }

  render() {
    const timeline = historyTimeline();
    const named = state.versions.filter((v) => !v.auto);
    const auto = state.versions.filter((v) => v.auto);
    return [
      <section class="panel-section">
        <h3 class="panel-title">Saved versions</h3>
        <form class="row" onSubmit={(e) => void this.save(e)}>
          <input class="input grow" placeholder="Name this version" aria-label="Version name" value={this.name} onInput={(e) => (this.name = (e.target as HTMLInputElement).value)} />
          <button class="btn primary" type="submit">
            <Icon name="plus" /> Save
          </button>
        </form>
        <div style={{ marginTop: '8px' }}>
          {named.length ? named.map((v) => this.renderVersion(v)) : <p class="hint">Save a version before a big change to come back to it later.</p>}
        </div>
        {auto.length > 0 && [
          <h4 class="sub-title">Automatic</h4>,
          <p class="hint">Taken before a host page or an agent changed this forest.</p>,
          auto.map((v) => this.renderVersion(v)),
        ]}
      </section>,
      <section class="panel-section">
        <h3 class="panel-title">This session</h3>
        <ol class="history-list" aria-label="Undo history, newest first">
          {[...timeline].reverse().map((entry) => {
            const i = timeline.indexOf(entry);
            const label = labelFor(timeline[i - 1]?.state, entry.state, entry.change?.label);
            const source = entry.change?.source;
            return (
              <li key={String(entry.offset)} class={{ current: entry.offset === 0, future: entry.offset > 0 }}>
                <button class="history-step" aria-current={entry.offset === 0 ? 'step' : undefined} disabled={entry.offset === 0} onClick={() => goToHistory(entry.offset)} title={entry.offset < 0 ? 'Go back to here' : entry.offset > 0 ? 'Redo up to here' : 'Where you are'}>
                  <span class="history-label">{label}</span>
                  <span class="meta">
                    {source && source !== 'editor' && <span class={`source-badge source-${source}`}>{SOURCE_LABEL[source]}</span>}
                    {time(entry.change?.at)}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        {timeline.length <= 1 && <p class="hint">Your changes show here as you make them. Click one to go back to it.</p>}
      </section>,
    ];
  }
}
