import { Component, State, h } from '@stencil/core';
import { createKit } from '@tree-weaver/core';
import { analyzeKit, createStarterKit, kitFromFile, kitFromUrl } from '@tree-weaver/kits';
import { addKit, moveKit, removeKit, toast, updateKit } from '../../store/actions';
import { state } from '../../store/editor';
import { Icon } from '../../utils/icons';

/** Design kits: imported CSS that styles every tree in the forest. */
@Component({ tag: 'tw-kits-panel' })
export class TwKitsPanel {
  @State() open: string | null = null;
  @State() url = '';
  @State() pasted = '';
  @State() busy = false;
  private fileInput?: HTMLInputElement;

  private async onFiles(files: FileList | null) {
    for (const file of Array.from(files ?? [])) addKit(kitFromFile(file.name, await file.text()));
    if (this.fileInput) this.fileInput.value = '';
  }

  private async addFromUrl() {
    const url = this.url.trim();
    if (!/^https?:\/\//i.test(url)) {
      toast('Enter a full http(s) URL to a stylesheet', 'error');
      return;
    }
    this.busy = true;
    try {
      const kit = await kitFromUrl(url);
      addKit(kit);
      if (kit.css.startsWith('@import')) toast('That server does not share its CSS, so the kit loads it with @import (classes are not listed)');
      this.url = '';
    } finally {
      this.busy = false;
    }
  }

  private addPasted() {
    if (!this.pasted.trim()) return;
    addKit(createKit(`Pasted kit ${(state.forest?.kits.length ?? 0) + 1}`, this.pasted, 'pasted'));
    this.pasted = '';
  }

  render() {
    const kits = state.forest?.kits ?? [];
    return [
      <section class="panel-section">
        <h3 class="panel-title">Design kits in this forest</h3>
        {kits.length === 0 ? <p class="hint">No kits yet. Import a CSS file, link a stylesheet, or add the starter kit.</p> : null}
        {kits.map((kit, i) => {
          const info = this.open === kit.id ? analyzeKit(kit.css) : null;
          return [
            <div class="list-item" key={kit.id}>
              <label class="switch" title={kit.enabled ? 'Disable kit' : 'Enable kit'}>
                <input type="checkbox" checked={kit.enabled} aria-label={`Use ${kit.name}`} onChange={(e) => updateKit(kit.id, { enabled: (e.target as HTMLInputElement).checked })} />
                <span />
              </label>
              <span class="title" title={kit.source ?? kit.name} onClick={() => (this.open = this.open === kit.id ? null : kit.id)}>
                {kit.name}
              </span>
              <button class="icon-btn" title="Load earlier" disabled={i === 0} onClick={() => moveKit(kit.id, -1)}>
                <Icon name="up" />
              </button>
              <button class="icon-btn" title="Details" aria-expanded={String(this.open === kit.id)} onClick={() => (this.open = this.open === kit.id ? null : kit.id)}>
                <Icon name="eye" />
              </button>
              <button class="icon-btn danger" title="Remove kit" onClick={() => removeKit(kit.id)}>
                <Icon name="trash" />
              </button>
            </div>,
            info ? (
              <div class="kit-details">
                <div class="field">
                  <label htmlFor={`kit-name-${kit.id}`}>Name</label>
                  <input id={`kit-name-${kit.id}`} class="input" value={kit.name} onChange={(e) => updateKit(kit.id, { name: (e.target as HTMLInputElement).value || kit.name })} />
                </div>
                <p class="hint">
                  {info.classes.length} classes · {info.tokens.length} tokens · {info.ruleCount} rules
                  {info.imports.length ? ` · imports ${info.imports.join(', ')}` : ''}
                </p>
                {info.classes.length ? (
                  <div class="class-cloud">
                    {info.classes.slice(0, 200).map((c) => (
                      <code>.{c}</code>
                    ))}
                  </div>
                ) : null}
                <details>
                  <summary class="hint">Edit CSS</summary>
                  <textarea class="textarea" rows={10} aria-label={`${kit.name} CSS`} onChange={(e) => updateKit(kit.id, { css: (e.target as HTMLTextAreaElement).value })}>
                    {kit.css}
                  </textarea>
                </details>
              </div>
            ) : null,
          ];
        })}
      </section>,
      <section class="panel-section">
        <h3 class="panel-title">Add a kit</h3>
        <div class="row wrap" style={{ marginBottom: '8px' }}>
          <button class="btn" onClick={() => this.fileInput?.click()}>
            <Icon name="upload" /> CSS file
          </button>
          <button class="btn" disabled={kits.some((k) => k.source === 'builtin')} onClick={() => addKit(createStarterKit())}>
            Starter kit
          </button>
          <input ref={(el) => (this.fileInput = el)} type="file" accept=".css,text/css" multiple hidden onChange={(e) => this.onFiles((e.target as HTMLInputElement).files)} />
        </div>
        <div class="row" style={{ marginBottom: '8px' }}>
          <input
            class="input grow"
            type="url"
            placeholder="https://cdn…/kit.css"
            aria-label="Stylesheet URL"
            value={this.url}
            onInput={(e) => (this.url = (e.target as HTMLInputElement).value)}
            onKeyDown={(e) => e.key === 'Enter' && this.addFromUrl()}
          />
          <button class="btn" disabled={this.busy || !this.url.trim()} onClick={() => this.addFromUrl()}>
            Link
          </button>
        </div>
        <textarea class="textarea" rows={4} placeholder="…or paste CSS here" aria-label="Paste CSS" value={this.pasted} onInput={(e) => (this.pasted = (e.target as HTMLTextAreaElement).value)} />
        <div class="row" style={{ justifyContent: 'flex-end', marginTop: '6px' }}>
          <button class="btn small" disabled={!this.pasted.trim()} onClick={() => this.addPasted()}>
            Add pasted CSS
          </button>
        </div>
        <p class="hint">Kits load in order, so later kits override earlier ones. Their classes are suggested in the inspector.</p>
      </section>,
    ];
  }
}
