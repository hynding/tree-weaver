import { Component, State, h } from '@stencil/core';
import { createKit, isStylesheetUrl, type DesignKit } from '@tree-weaver/core';
import { analyzeKit, createStarterKit, kitFromFile, kitFromUrl, parseCssUrls } from '@tree-weaver/kits';
import { CSS_URL_INPUT_ENABLED } from '../../config';
import { addKit, moveKit, refreshKit, removeKit, toast, updateKit } from '../../store/actions';
import { state } from '../../store/editor';
import { Icon } from '../../utils/icons';

const host = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

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

  /** Link one or more stylesheet URLs. They join the end of the kit list in the order given. */
  private async addFromUrl() {
    const urls = parseCssUrls(this.url);
    if (!urls.length) {
      toast('Enter a full http(s) URL to a stylesheet', 'error');
      return;
    }
    this.busy = true;
    try {
      const kits = await Promise.all(urls.map((url) => kitFromUrl(url)));
      for (const kit of kits) addKit(kit);
      const unlisted = kits.filter((k) => !k.css).length;
      if (unlisted) toast(`${unlisted === 1 ? 'One server does' : `${unlisted} servers do`} not share the CSS, so those classes are not listed. The stylesheet still loads.`);
      this.url = '';
    } finally {
      this.busy = false;
    }
  }

  private changeUrl(kit: DesignKit, value: string) {
    const url = value.trim();
    if (url === kit.href) return;
    if (!isStylesheetUrl(url)) {
      toast('Enter a full http(s) URL to a stylesheet', 'error');
      return;
    }
    updateKit(kit.id, { href: url, source: url, css: '' });
    void refreshKit(kit.id, true);
  }

  private addPasted() {
    if (!this.pasted.trim()) return;
    addKit(createKit(`Pasted kit ${(state.forest?.kits.length ?? 0) + 1}`, this.pasted, 'pasted'));
    this.pasted = '';
  }

  private toggle(id: string) {
    this.open = this.open === id ? null : id;
  }

  private renderInfo(kit: DesignKit) {
    const info = analyzeKit(kit.css);
    if (kit.href && !kit.css) return <p class="hint">This server does not share its CSS, so its classes are not listed. The stylesheet still loads.</p>;
    return [
      <p class="hint">
        {info.classes.length} classes · {info.tokens.length} tokens · {info.ruleCount} rules
        {info.imports.length ? ` · imports ${info.imports.join(', ')}` : ''}
      </p>,
      info.classes.length ? (
        <div class="class-cloud">
          {info.classes.slice(0, 200).map((c) => (
            <code>.{c}</code>
          ))}
        </div>
      ) : null,
    ];
  }

  private renderEnvKits() {
    const kits = state.envKits;
    if (!kits.length) return null;
    return (
      <section class="panel-section">
        <h3 class="panel-title">Always loaded first</h3>
        <p class="hint">This site loads these stylesheets before every forest’s kits, in this order.</p>
        {kits.map((kit, i) => [
          <div class="list-item" key={kit.id}>
            <span class="kit-badge" title="Set by the site">
              <Icon name="lock" />
            </span>
            <span class="title" title={kit.href} onClick={() => this.toggle(kit.id)}>
              {i + 1}. {kit.name} <span class="meta">{host(kit.href!)}</span>
            </span>
            <button class="icon-btn" title="Reload classes" onClick={() => refreshKit(kit.id)}>
              <Icon name="refresh" />
            </button>
            <button class="icon-btn" title="Details" aria-expanded={String(this.open === kit.id)} onClick={() => this.toggle(kit.id)}>
              <Icon name="eye" />
            </button>
          </div>,
          this.open === kit.id ? (
            <div class="kit-details">
              <p class="hint">
                <a href={kit.href} target="_blank" rel="noopener noreferrer">
                  {kit.href}
                </a>
              </p>
              {this.renderInfo(kit)}
            </div>
          ) : null,
        ])}
      </section>
    );
  }

  render() {
    const kits = state.forest?.kits ?? [];
    return [
      this.renderEnvKits(),
      <section class="panel-section">
        <h3 class="panel-title">Design kits in this forest</h3>
        {kits.length === 0 ? <p class="hint">No kits yet. Import a CSS file{CSS_URL_INPUT_ENABLED ? ', link a stylesheet URL' : ''}, or add the starter kit.</p> : null}
        {kits.map((kit, i) => [
          <div class="list-item" key={kit.id}>
            <label class="switch" title={kit.enabled ? 'Disable kit' : 'Enable kit'}>
              <input type="checkbox" checked={kit.enabled} aria-label={`Use ${kit.name}`} onChange={(e) => updateKit(kit.id, { enabled: (e.target as HTMLInputElement).checked })} />
              <span />
            </label>
            <span class="title" title={kit.href ?? kit.source ?? kit.name} onClick={() => this.toggle(kit.id)}>
              {kit.href ? (
                <span class="kit-badge" title="Linked stylesheet">
                  <Icon name="link" />
                </span>
              ) : null}
              {kit.name}
            </span>
            <button class="icon-btn" title="Load earlier" disabled={i === 0} onClick={() => moveKit(kit.id, -1)}>
              <Icon name="up" />
            </button>
            <button class="icon-btn" title="Load later" disabled={i === kits.length - 1} onClick={() => moveKit(kit.id, 1)}>
              <Icon name="down" />
            </button>
            <button class="icon-btn" title="Details" aria-expanded={String(this.open === kit.id)} onClick={() => this.toggle(kit.id)}>
              <Icon name="eye" />
            </button>
            <button class="icon-btn danger" title="Remove kit" onClick={() => removeKit(kit.id)}>
              <Icon name="trash" />
            </button>
          </div>,
          this.open === kit.id ? (
            <div class="kit-details">
              <div class="field">
                <label htmlFor={`kit-name-${kit.id}`}>Name</label>
                <input id={`kit-name-${kit.id}`} class="input" value={kit.name} onChange={(e) => updateKit(kit.id, { name: (e.target as HTMLInputElement).value || kit.name })} />
              </div>
              {kit.href ? (
                <div class="field">
                  <label htmlFor={`kit-url-${kit.id}`}>Stylesheet URL</label>
                  <div class="row">
                    <input
                      id={`kit-url-${kit.id}`}
                      class="input grow"
                      type="url"
                      value={kit.href}
                      readOnly={!CSS_URL_INPUT_ENABLED}
                      onChange={(e) => this.changeUrl(kit, (e.target as HTMLInputElement).value)}
                    />
                    <button class="icon-btn" title="Reload classes" onClick={() => refreshKit(kit.id)}>
                      <Icon name="refresh" />
                    </button>
                  </div>
                </div>
              ) : null}
              {this.renderInfo(kit)}
              {kit.href ? null : (
                <details>
                  <summary class="hint">Edit CSS</summary>
                  <textarea class="textarea" rows={10} aria-label={`${kit.name} CSS`} onChange={(e) => updateKit(kit.id, { css: (e.target as HTMLTextAreaElement).value })}>
                    {kit.css}
                  </textarea>
                </details>
              )}
            </div>
          ) : null,
        ])}
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
        {CSS_URL_INPUT_ENABLED ? (
          <div class="row" style={{ marginBottom: '8px' }}>
            <input
              class="input grow"
              type="text"
              inputMode="url"
              placeholder="https://cdn…/kit.css (several: separate with spaces)"
              aria-label="Stylesheet URLs"
              value={this.url}
              onInput={(e) => (this.url = (e.target as HTMLInputElement).value)}
              onKeyDown={(e) => e.key === 'Enter' && this.addFromUrl()}
            />
            <button class="btn" disabled={this.busy || !this.url.trim()} onClick={() => this.addFromUrl()}>
              <Icon name="link" /> Link
            </button>
          </div>
        ) : null}
        <textarea class="textarea" rows={4} placeholder="…or paste CSS here" aria-label="Paste CSS" value={this.pasted} onInput={(e) => (this.pasted = (e.target as HTMLTextAreaElement).value)} />
        <div class="row" style={{ justifyContent: 'flex-end', marginTop: '6px' }}>
          <button class="btn small" disabled={!this.pasted.trim()} onClick={() => this.addPasted()}>
            Add pasted CSS
          </button>
        </div>
        <p class="hint">
          Kits load top to bottom, so later kits override earlier ones. Linked stylesheets load from their URL in their place in that order. Their classes are suggested in the inspector.
        </p>
      </section>,
    ];
  }
}
