import { Component, Event, EventEmitter, h } from '@stencil/core';
import { componentTreeId, DISPLAYS } from '@tree-weaver/core';
import { redo, renameForest, setDisplay, switchTree, undo } from '../../store/actions';
import { state } from '../../store/editor';
import { isEmbedded } from '../../store/embed-flags';
import { COLLAB_ENABLED } from '../../config';
import { PEER_COLORS } from '../../utils/peers';
import { BrandMark, DisplayIcon, Icon } from '../../utils/icons';

const SAVE_LABEL = { saved: 'Saved locally', saving: 'Saving…', unsaved: 'Unsaved changes', error: 'Save failed' } as const;

@Component({ tag: 'tw-toolbar' })
export class TwToolbar {
  @Event() twTogglePanel!: EventEmitter<'left' | 'right'>;

  render() {
    const forest = state.forest!;
    void state.displaysVersion;
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
          {forest.components?.length ? (
            <optgroup label="Components">
              {forest.components.map((c) => (
                <option value={componentTreeId(c.id)} selected={componentTreeId(c.id) === state.treeId}>
                  {c.name}
                </option>
              ))}
            </optgroup>
          ) : null}
        </select>
      </div>,
      <div class="displays" role="group" aria-label="Display type">
        {DISPLAYS.map((d) => (
          <button aria-pressed={String(state.display === d.id)} title={`${d.label} · ${d.width}×${d.height}`} onClick={() => setDisplay(d.id)}>
            <DisplayIcon display={d.id} />
            <span class="label">{d.label}</span>
          </button>
        ))}
        <button class="displays-settings" title="Display settings: sizes and breakpoints" aria-label="Display settings" onClick={() => (state.dialog = 'displays')}>
          <Icon name="settings" />
        </button>
      </div>,
      <div class="bar-actions">
        <button class="bar-btn" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!state.canUndo} onClick={undo}>
          <Icon name="undo" />
        </button>
        <button class="bar-btn" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" disabled={!state.canRedo} onClick={redo}>
          <Icon name="redo" />
        </button>
        {isEmbedded() ? (
          <span class="save-state hide-narrow" title="Embedded: the page around the editor keeps the document">
            Embedded
          </span>
        ) : (
          <span class={{ 'save-state': true, 'hide-narrow': true, error: state.saveState === 'error' }} title={`Storage: ${state.storageKind}`}>
            {SAVE_LABEL[state.saveState]}
          </span>
        )}
        {COLLAB_ENABLED && !isEmbedded() && (
          <button
            class={{ 'bar-btn': true, sharing: state.collabStatus !== 'off' }}
            title={state.collabStatus === 'live' ? `Shared live · ${state.collabPeers.length + 1} here` : state.collabStatus === 'joining' ? 'Joining…' : 'Edit this forest together with others'}
            onClick={() => (state.dialog = 'share')}
          >
            {state.collabStatus === 'off' ? (
              <Icon name="users" />
            ) : (
              <span class="peer-stack" aria-hidden="true">
                <span class="peer-dot" style={{ background: PEER_COLORS[state.collabColor] }} />
                {state.collabPeers.slice(0, 4).map((p) => (
                  <span class="peer-dot" style={{ background: PEER_COLORS[p.color] }} title={p.name} />
                ))}
              </span>
            )}
            <span class="hide-narrow">{state.collabStatus === 'joining' ? 'Joining…' : state.collabStatus === 'live' ? `Live · ${state.collabPeers.length + 1}` : 'Share'}</span>
          </button>
        )}
        <button class="bar-btn" title="See the tree as it ships, without the editor" onClick={() => (state.preview = true)}>
          <Icon name="eye" />
          <span class="hide-narrow">Preview</span>
        </button>
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
