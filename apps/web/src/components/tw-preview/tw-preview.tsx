import { Component, Listen, State, h } from '@stencil/core';
import { DISPLAYS, getDisplay, type DisplayId } from '@tree-weaver/core';
import { openForestInTab, openTreeInTab, treePage } from '../../store/actions';
import { state } from '../../store/editor';
import { isTypingTarget } from '../../utils/shortcuts';
import { DisplayIcon, Icon } from '../../utils/icons';

/** `fit` sizes the page to the window, so the display media queries respond to its real width. */
type PreviewSize = DisplayId | 'fit';

/** A full-window view of a tree as it ships: no outlines, handles or panels. */
@Component({ tag: 'tw-preview' })
export class TwPreview {
  @State() treeId = state.treeId;
  @State() size: PreviewSize = 'fit';
  @State() stageWidth = 0;
  @State() stageHeight = 0;

  private stage?: HTMLElement;
  private closeBtn?: HTMLButtonElement;
  private observer?: ResizeObserver;

  componentDidLoad() {
    this.observer = new ResizeObserver(([entry]) => {
      this.stageWidth = entry.contentRect.width;
      this.stageHeight = entry.contentRect.height;
    });
    if (this.stage) this.observer.observe(this.stage);
    this.closeBtn?.focus();
  }

  disconnectedCallback() {
    this.observer?.disconnect();
  }

  @Listen('keydown', { target: 'window' })
  onKey(ev: KeyboardEvent) {
    if (ev.key === 'Escape' && !isTypingTarget(ev.target)) this.close();
  }

  private close = () => {
    state.preview = false;
  };

  private renderFrame(html: string, title: string) {
    if (this.size === 'fit') {
      return <iframe class="preview-fit" title={title} sandbox="allow-popups allow-popups-to-escape-sandbox" srcdoc={html} />;
    }
    const display = getDisplay(this.size);
    const pad = 40;
    const scale = this.stageWidth ? Math.min(1, (this.stageWidth - pad) / display.width) : 1;
    const isDesktop = display.id === 'lg' || display.id === 'xl';
    const height = isDesktop ? Math.max(display.height, (this.stageHeight - pad) / scale) : display.height;
    const framed = display.id === 'tablet' ? 'tablet' : display.id.startsWith('mobile') ? 'mobile' : '';
    const bezel = framed ? 20 : 0;
    return (
      <div class="stage-inner" style={{ width: `${(display.width + bezel) * scale}px`, height: `${(height + bezel) * scale}px` }}>
        <div class={`device ${framed}`} style={{ width: `${display.width + bezel}px`, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
          <iframe
            title={title}
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            srcdoc={html}
            style={{ width: `${display.width}px`, height: `${height}px` }}
          />
        </div>
      </div>
    );
  }

  render() {
    const forest = state.forest!;
    const tree = forest.trees.find((t) => t.id === this.treeId) ?? forest.trees[0];
    const fitLabel = this.stageWidth ? `${Math.round(this.stageWidth)}×${Math.round(this.stageHeight)}` : '';
    return (
      <div class="preview-screen" role="dialog" aria-modal="true" aria-label={`Preview of ${tree.name}`}>
        <header class="preview-bar">
          <span class="preview-title hide-narrow">
            <Icon name="eye" />
            Preview
          </span>
          {forest.trees.length > 1 ? (
            <select class="bar-select" aria-label="Tree to preview" onChange={(e) => (this.treeId = (e.target as HTMLSelectElement).value)}>
              {forest.trees.map((t) => (
                <option value={t.id} selected={t.id === tree.id}>
                  {t.name}
                </option>
              ))}
            </select>
          ) : (
            <span class="preview-name">{tree.name}</span>
          )}
          <div class="displays" role="group" aria-label="Preview size">
            <button aria-pressed={String(this.size === 'fit')} title={`Fit to window${fitLabel ? ` · ${fitLabel}` : ''}`} onClick={() => (this.size = 'fit')}>
              <Icon name="wrap" />
              <span class="label">Fit window</span>
            </button>
            {DISPLAYS.map((d) => (
              <button aria-pressed={String(this.size === d.id)} title={`${d.label} · ${d.width}×${d.height}`} onClick={() => (this.size = d.id)}>
                <DisplayIcon display={d.id} />
                <span class="label">{d.label}</span>
              </button>
            ))}
          </div>
          <div class="bar-actions">
            <button class="bar-btn" title="Open this tree in a new browser tab" onClick={() => openTreeInTab(tree.id)}>
              <Icon name="external" />
              <span class="hide-narrow">New tab</span>
            </button>
            {forest.trees.length > 1 ? (
              <button class="bar-btn" title="Open every tree in a new tab, starting from a list of the forest's trees" onClick={openForestInTab}>
                <Icon name="tree" />
                <span class="hide-narrow">Forest in new tab</span>
              </button>
            ) : null}
            <button class="bar-btn primary" ref={(el) => (this.closeBtn = el)} title="Back to the editor (Esc)" onClick={this.close}>
              <Icon name="x" />
              <span class="hide-narrow">Close</span>
            </button>
          </div>
        </header>
        <div class={{ 'preview-stage': true, stage: this.size !== 'fit' }} ref={(el) => (this.stage = el)}>
          {this.renderFrame(treePage(tree), `Preview: ${tree.name}`)}
        </div>
      </div>
    );
  }
}
