import { Component, Event, EventEmitter, h } from '@stencil/core';
import { DISPLAYS } from '@tree-weaver/core';
import { redo, renameForest, setDisplay, switchTree, undo } from '../../store/actions';
import { state } from '../../store/editor';
import { BrandMark, DisplayIcon, Icon } from '../../utils/icons';

const SAVE_LABEL = { saved: 'Saved locally', saving: 'Saving…', unsaved: 'Unsaved changes', error: 'Save failed' } as const;

@Component({ tag: 'tw-toolbar' })
export class TwToolbar {
  @Event() twTogglePanel!: EventEmitter<'left' | 'right'>;

  render() {
    const forest = state.forest!;
    return [
      <button class="bar-btn only-narrow" aria-label="Show panels" onClick={() => this.twTogglePanel.emit('left')}>
        <Icon name="menu" />
      </button>,
      <div class="brand">
        <BrandMark />
        <span class="hide-narrow">Tree Weaver</span>
      </div>,
      <div class="bar-sep hide-narrow" />,
      <div class="bar-field hide-narrow">
        <label htmlFor="forest-name">Forest</label>
        <input
          id="forest-name"
          class="bar-input"
          value={forest.name}
          aria-label="Forest name"
          onChange={(e) => renameForest((e.target as HTMLInputElement).value)}
        />
      </div>,
      <div class="bar-field">
        <label htmlFor="tree-select" class="hide-narrow">
          Tree
        </label>
        <select id="tree-select" class="bar-select" aria-label="Current tree" onChange={(e) => switchTree((e.target as HTMLSelectElement).value)}>
          {forest.trees.map((t) => (
            <option value={t.id} selected={t.id === state.treeId}>
              {t.name}
            </option>
          ))}
        </select>
      </div>,
      <div class="displays" role="group" aria-label="Display type">
        {DISPLAYS.map((d) => (
          <button aria-pressed={String(state.display === d.id)} title={`${d.label} · ${d.width}×${d.height}`} onClick={() => setDisplay(d.id)}>
            <DisplayIcon display={d.id} />
            <span class="label">{d.label}</span>
          </button>
        ))}
      </div>,
      <div class="bar-actions">
        <button class="bar-btn" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!state.canUndo} onClick={undo}>
          <Icon name="undo" />
        </button>
        <button class="bar-btn" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" disabled={!state.canRedo} onClick={redo}>
          <Icon name="redo" />
        </button>
        <span class={{ 'save-state': true, 'hide-narrow': true, error: state.saveState === 'error' }} title={`Storage: ${state.storageKind}`}>
          {SAVE_LABEL[state.saveState]}
        </span>
        <button class="bar-btn" onClick={() => (state.dialog = 'import')}>
          <Icon name="upload" />
          <span class="hide-narrow">Import</span>
        </button>
        <button class="bar-btn primary" onClick={() => (state.dialog = 'export')}>
          <Icon name="download" />
          <span class="hide-narrow">Export</span>
        </button>
        <button class="bar-btn only-narrow" aria-label="Show inspector" onClick={() => this.twTogglePanel.emit('right')}>
          <Icon name="sliders" />
        </button>
      </div>,
    ];
  }
}
