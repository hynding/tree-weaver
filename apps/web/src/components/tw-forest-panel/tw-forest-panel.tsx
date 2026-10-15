import { Component, State, h } from '@stencil/core';
import { TEMPLATES } from '@tree-weaver/branches';
import { countNodes } from '@tree-weaver/core';
import { addTree, deleteForest, deleteTree, duplicateTree, moveTree, newForest, openForest, renameTree, switchTree } from '../../store/actions';
import { state } from '../../store/editor';
import { Icon } from '../../utils/icons';

const when = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

/** Trees in the open forest, and every forest saved in this browser. */
@Component({ tag: 'tw-forest-panel' })
export class TwForestPanel {
  @State() template = 'blank';
  @State() renaming: string | null = null;
  @State() confirmForest: string | null = null;

  render() {
    const forest = state.forest!;
    return [
      <section class="panel-section">
        <h3 class="panel-title">Trees in {forest.name}</h3>
        {forest.trees.map((tree, i) => {
          const { branches, leaves } = countNodes(tree.root);
          return (
            <div class={{ 'list-item': true, current: tree.id === state.treeId }} key={tree.id}>
              {this.renaming === tree.id ? (
                <input
                  class="input grow"
                  value={tree.name}
                  aria-label="Tree name"
                  ref={(el) => el?.focus()}
                  onChange={(e) => renameTree(tree.id, (e.target as HTMLInputElement).value)}
                  onBlur={() => (this.renaming = null)}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === 'Escape') && (this.renaming = null)}
                />
              ) : (
                <span class="title" onClick={() => switchTree(tree.id)} onDblClick={() => (this.renaming = tree.id)} title="Click to open, double-click to rename">
                  {tree.name}
                  <div class="meta">
                    {branches} branches · {leaves} leaves
                  </div>
                </span>
              )}
              <button class="icon-btn" title="Rename" onClick={() => (this.renaming = tree.id)}>
                <Icon name="edit" />
              </button>
              <button class="icon-btn" title="Move up" disabled={i === 0} onClick={() => moveTree(tree.id, -1)}>
                <Icon name="up" />
              </button>
              <button class="icon-btn" title="Duplicate tree" onClick={() => duplicateTree(tree.id)}>
                <Icon name="copy" />
              </button>
              <button class="icon-btn danger" title="Delete tree" disabled={forest.trees.length <= 1} onClick={() => confirm(`Delete the tree “${tree.name}”?`) && deleteTree(tree.id)}>
                <Icon name="trash" />
              </button>
            </div>
          );
        })}
        <div class="row" style={{ marginTop: '8px' }}>
          <select class="select grow" aria-label="Template for the new tree" onChange={(e) => (this.template = (e.target as HTMLSelectElement).value)}>
            {TEMPLATES.map((t) => (
              <option value={t.id} selected={t.id === this.template} title={t.description}>
                {t.label}
              </option>
            ))}
          </select>
          <button class="btn primary" onClick={() => addTree(this.template)}>
            <Icon name="plus" /> Plant tree
          </button>
        </div>
      </section>,
      <section class="panel-section">
        <h3 class="panel-title">
          Forests in this browser
          <button class="btn small" onClick={() => newForest()}>
            <Icon name="plus" /> New forest
          </button>
        </h3>
        {state.forests.map((f) => (
          <div class={{ 'list-item': true, current: f.id === forest.id }} key={f.id}>
            <span class="title" onClick={() => openForest(f.id)}>
              {f.name}
              <div class="meta">
                {f.treeCount} tree{f.treeCount === 1 ? '' : 's'} · {when(f.updatedAt)}
              </div>
            </span>
            {this.confirmForest === f.id ? (
              [
                <button class="btn small danger" onClick={() => ((this.confirmForest = null), deleteForest(f.id))}>
                  Delete
                </button>,
                <button class="btn small" onClick={() => (this.confirmForest = null)}>
                  Keep
                </button>,
              ]
            ) : (
              <button class="icon-btn danger" title="Delete forest" onClick={() => (this.confirmForest = f.id)}>
                <Icon name="trash" />
              </button>
            )}
          </div>
        ))}
        <p class="hint">
          Saved automatically in this browser ({state.storageKind === 'indexeddb' ? 'IndexedDB' : state.storageKind === 'localstorage' ? 'localStorage' : 'memory only, nothing persists'}). Export to keep a
          copy elsewhere.
        </p>
      </section>,
    ];
  }
}
