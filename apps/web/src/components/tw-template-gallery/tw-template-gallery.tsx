import { Component, h } from '@stencil/core';
import { STARTERS, type StarterForest } from '@tree-weaver/branches';
import { renderDocument, type Forest } from '@tree-weaver/core';
import { newForest, newForestFromStarter } from '../../store/actions';
import { state } from '../../store/editor';
import { Icon } from '../../utils/icons';

/** Preview size each thumbnail is rendered at (Desktop large), scaled down to fit the card. */
const THUMB_W = 1280;
const THUMB_H = 800;

/** The template gallery: start a new forest blank or from a starter forest. */
@Component({ tag: 'tw-template-gallery' })
export class TwTemplateGallery {
  private dialogEl?: HTMLElement;
  /** Thumbnails are rendered once per dialog: the starters are fixed. */
  private previews = new Map<string, { forest: Forest; html: string }>();

  componentWillLoad() {
    for (const s of STARTERS) {
      const forest = s.create();
      this.previews.set(s.id, { forest, html: renderDocument(forest.trees[0], { kits: forest.kits }) });
    }
  }

  private resize = new ResizeObserver((entries) => {
    for (const e of entries) (e.target as HTMLElement).style.setProperty('--thumb-scale', String(e.contentRect.width / THUMB_W));
  });

  disconnectedCallback() {
    this.resize.disconnect();
  }

  componentDidLoad() {
    this.dialogEl?.querySelector<HTMLElement>('.gallery-card button')?.focus();
  }

  private close = () => {
    state.dialog = null;
  };

  private renderStarter(s: StarterForest) {
    const preview = this.previews.get(s.id)!;
    return (
      <li class="gallery-card">
        <div class="gallery-thumb" aria-hidden="true" ref={(el) => el && this.resize.observe(el)}>
          <iframe sandbox="" tabIndex={-1} title={`${s.label} preview`} srcdoc={preview.html} style={{ width: `${THUMB_W}px`, height: `${THUMB_H}px` }} />
        </div>
        <div class="gallery-info">
          <h3>
            <span class="swatch" aria-hidden="true">
              {s.swatch.map((c) => (
                <span style={{ background: c }} />
              ))}
            </span>
            {s.label}
          </h3>
          <p class="hint">{s.description}</p>
          <p class="gallery-meta">
            <span>
              <Icon name="tree" /> {s.trees.join(', ')}
            </span>
            <span>
              <Icon name="component" /> {s.components.join(', ')}
            </span>
          </p>
        </div>
        <button class="btn primary" onClick={() => newForestFromStarter(s.id)}>
          Use {s.label.toLowerCase()}
        </button>
      </li>
    );
  }

  render() {
    return (
      <div class="dialog-backdrop" onClick={(e) => e.target === e.currentTarget && this.close()} onKeyDown={(e) => e.key === 'Escape' && this.close()}>
        <div class="dialog wide" role="dialog" aria-modal="true" aria-labelledby="gallery-title" ref={(el) => (this.dialogEl = el)}>
          <header>
            <h2 id="gallery-title">New forest</h2>
            <button class="icon-btn" aria-label="Close" onClick={this.close}>
              <Icon name="x" />
            </button>
          </header>
          <div class="dialog-body">
            <p class="hint" style={{ margin: '0' }}>
              Start from a template: each one comes with its own design tokens and components that switch variants per display. Change a token in the Tokens tab to restyle
              the whole forest, or edit a component to change every place it is used.
            </p>
            <ul class="gallery">
              {STARTERS.map((s) => this.renderStarter(s))}
              <li class="gallery-card blank">
                <div class="gallery-info">
                  <h3>Blank forest</h3>
                  <p class="hint">One landing page tree and the Weaver Basic starter kit, no components.</p>
                </div>
                <button class="btn" onClick={() => ((state.dialog = null), newForest())}>
                  <Icon name="plus" /> Start blank
                </button>
              </li>
            </ul>
          </div>
        </div>
      </div>
    );
  }
}
