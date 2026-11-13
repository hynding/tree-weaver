import { Component, State, h } from '@stencil/core';
import { createKit } from '@tree-weaver/core';
import { filterStories, groupStories, type StoryEntry } from '@tree-weaver/formats';
import { ENV_STORYBOOK_INCLUDE, ENV_STORYBOOK_URLS } from '../../config';
import { addKit, newKits, toast } from '../../store/actions';
import { state } from '../../store/editor';
import { importStories, storybookName } from '../../store/storybook';
import { isSameOrigin, linkedStylesheets, loadCatalog, storybookBase } from '../../utils/storybook';
import { canUploadStorybook, filesFromDrop, filesFromInput, filesFromZip, saveUploadedStorybook, type UploadedFile } from '../../utils/storybook-upload';
import { Icon } from '../../utils/icons';

type Stage = 'source' | 'pick' | 'running' | 'done';
type Status = 'waiting' | 'ok' | 'failed';

/**
 * Import stories from a compiled Storybook as static snapshots: as branches in the palette,
 * as new trees, or both, with the Storybook's styles as design kits.
 */
@Component({ tag: 'tw-storybook-import' })
export class TwStorybookImport {
  @State() stage: Stage = 'source';
  @State() url = ENV_STORYBOOK_URLS[0] ?? '';
  @State() busy = '';
  @State() error = '';
  @State() over = false;

  /** The Storybook being imported. */
  @State() base = '';
  @State() name = '';
  @State() uploaded = false;
  @State() stories: StoryEntry[] = [];
  /** Stylesheets of a Storybook on another site, which can be linked but not rendered. */
  @State() remoteSheets: string[] | null = null;

  @State() selected = new Set<string>();
  @State() query = '';
  @State() as: 'palette' | 'trees' | 'both' = 'palette';
  @State() styles: 'link' | 'copy' = 'link';
  @State() viewports = false;

  @State() status = new Map<string, { status: Status; error?: string }>();
  @State() summary = '';

  private folderInput?: HTMLInputElement;
  private zipInput?: HTMLInputElement;
  private dialogEl?: HTMLElement;

  componentDidLoad() {
    this.dialogEl?.querySelector<HTMLElement>('input, button')?.focus();
  }

  private close = () => {
    if (this.stage === 'running') return;
    state.dialog = null;
  };

  private fail(err: unknown) {
    this.error = (err as Error).message;
    this.busy = '';
  }

  /* --------------------------------------------------------------- sources */

  private async openUrl(raw: string) {
    this.error = '';
    let base: string;
    try {
      base = storybookBase(raw);
    } catch {
      this.error = 'That doesn’t look like a URL';
      return;
    }
    this.busy = 'Reading the story list…';
    this.remoteSheets = null;
    const sameOrigin = isSameOrigin(base);
    try {
      if (!sameOrigin) {
        // Stories on another site can't be rendered here; offer the stylesheets instead.
        this.remoteSheets = await linkedStylesheets(base).catch(() => []);
        const catalog = await loadCatalog(base).catch(() => null);
        this.base = base;
        this.name = storybookName(base);
        this.stories = catalog ? catalog.stories : [];
        this.busy = '';
        return;
      }
      const catalog = await loadCatalog(base);
      this.showCatalog(base, storybookName(base), catalog.stories, false);
    } catch (err) {
      this.fail(err);
    }
  }

  private async openUpload(name: string, files: UploadedFile[] | (() => Promise<UploadedFile[]>)) {
    this.error = '';
    this.remoteSheets = null;
    try {
      this.busy = 'Unpacking…';
      const list = typeof files === 'function' ? await files() : files;
      this.busy = `Saving ${list.length} files in this browser…`;
      const clean = name.replace(/\.zip$/i, '').replace(/^storybook-static$/i, 'Storybook');
      const base = await saveUploadedStorybook(clean, list);
      this.busy = 'Reading the story list…';
      const catalog = await loadCatalog(base);
      this.showCatalog(base, clean, catalog.stories, true);
    } catch (err) {
      this.fail(err);
    }
  }

  private onFolder(list: FileList | null) {
    if (!list?.length) return;
    const files = filesFromInput(list);
    const top = files[0].path.split('/')[0] || 'Storybook';
    void this.openUpload(top, files);
  }

  private onZip(list: FileList | null) {
    const file = list?.[0];
    if (file) void this.openUpload(file.name, () => filesFromZip(file));
  }

  private async onDrop(e: DragEvent) {
    e.preventDefault();
    this.over = false;
    const items = e.dataTransfer?.items;
    if (!items) return;
    try {
      const { files, zip } = await filesFromDrop(items);
      if (zip) void this.openUpload(zip.name, () => filesFromZip(zip));
      else if (files.length) void this.openUpload(files[0].path.split('/')[0] || 'Storybook', files);
    } catch (err) {
      this.fail(err);
    }
  }

  private showCatalog(base: string, name: string, stories: StoryEntry[], uploaded: boolean) {
    this.base = base;
    this.name = name;
    this.uploaded = uploaded;
    this.stories = filterStories(stories, ENV_STORYBOOK_INCLUDE);
    // Uploaded files are only served in this browser, so their CSS is copied, never linked.
    if (uploaded) this.styles = 'copy';
    this.selected = new Set(this.stories.map((s) => s.id));
    this.busy = '';
    this.stage = 'pick';
    if (!this.stories.length) this.error = stories.length ? 'No stories match this deployment’s TW_STORYBOOK_INCLUDE.' : 'This Storybook has no stories.';
  }

  private linkRemoteSheets() {
    const kits = newKits((this.remoteSheets ?? []).map((href) => ({ ...createKit(`${this.name}: ${href.split('/').pop()}`, '', href), href })));
    kits.forEach(addKit);
    toast(kits.length ? `Linked ${kits.length} stylesheet${kits.length === 1 ? '' : 's'} from “${this.name}”` : 'The forest already links these stylesheets', 'success');
    state.dialog = null;
  }

  /* ---------------------------------------------------------------- import */

  private async run() {
    const chosen = this.stories.filter((s) => this.selected.has(s.id));
    this.status = new Map(chosen.map((s) => [s.id, { status: 'waiting' as Status }]));
    this.stage = 'running';
    this.error = '';
    try {
      this.summary = await importStories(
        { base: this.base, name: this.name, stories: chosen, as: this.as, styles: this.styles, viewports: this.viewports, uploaded: this.uploaded },
        (story, result) => {
          this.status = new Map(this.status).set(story.id, result.error ? { status: 'failed', error: result.error } : { status: 'ok' });
        },
      );
      toast(this.summary, 'success');
    } catch (err) {
      this.error = (err as Error).message;
    }
    this.stage = 'done';
  }

  private toggle(ids: string[], on: boolean) {
    const next = new Set(this.selected);
    ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
    this.selected = next;
  }

  /* ---------------------------------------------------------------- render */

  private renderSource() {
    const upload = canUploadStorybook();
    const remote = this.remoteSheets !== null;
    return [
      <div class="dialog-body">
        <div>
          <label class="field-label" htmlFor="sb-url">
            <strong>Storybook URL</strong>
          </label>
          <form
            class="row"
            onSubmit={(e) => {
              e.preventDefault();
              void this.openUrl(this.url);
            }}
          >
            <input
              id="sb-url"
              class="input grow"
              type="url"
              placeholder="https://example.com/storybook/"
              list="sb-presets"
              value={this.url}
              onInput={(e) => (this.url = (e.target as HTMLInputElement).value)}
            />
            <button class="btn primary" type="submit" disabled={!this.url.trim() || !!this.busy}>
              Read stories
            </button>
          </form>
          {ENV_STORYBOOK_URLS.length ? (
            <datalist id="sb-presets">
              {ENV_STORYBOOK_URLS.map((u) => (
                <option value={u} />
              ))}
            </datalist>
          ) : null}
          <p class="hint">A built Storybook (from storybook build). Stories can be rendered and read when it’s on this site; for any other Storybook, upload its folder.</p>
        </div>
        {remote ? (
          <div class="notice" role="status">
            <Icon name="info" />
            <div>
              <p style={{ margin: '0 0 6px' }}>
                <strong>{this.name}</strong> is on another site{this.stories.length ? ` (${this.stories.length} stories)` : ''}, so its stories can’t be rendered from here. Upload its <code>storybook-static</code> folder or zip to bring the stories in.
              </p>
              {this.remoteSheets!.length ? (
                <button class="btn" onClick={() => this.linkRemoteSheets()}>
                  <Icon name="link" /> Link its {this.remoteSheets!.length} stylesheet{this.remoteSheets!.length === 1 ? '' : 's'} as design kits
                </button>
              ) : (
                <p class="hint" style={{ margin: '0' }}>
                  Its stylesheets couldn’t be read either (the site doesn’t allow cross-origin requests).
                </p>
              )}
            </div>
          </div>
        ) : null}
        <div
          class={{ dropzone: true, over: this.over }}
          onDragOver={(e) => {
            e.preventDefault();
            this.over = true;
          }}
          onDragLeave={() => (this.over = false)}
          onDrop={(e) => void this.onDrop(e)}
        >
          <p style={{ margin: '0 0 10px' }}>Or upload the storybook-static folder, or a zip of it.</p>
          <div class="row" style={{ justifyContent: 'center' }}>
            <button class="btn" disabled={!upload || !!this.busy} onClick={() => this.folderInput?.click()}>
              <Icon name="upload" /> Choose folder
            </button>
            <button class="btn" disabled={!upload || !!this.busy} onClick={() => this.zipInput?.click()}>
              <Icon name="upload" /> Choose zip
            </button>
          </div>
          <input
            ref={(el) => {
              this.folderInput = el;
              el?.setAttribute('webkitdirectory', '');
            }}
            type="file"
            multiple
            hidden
            onChange={(e) => this.onFolder((e.target as HTMLInputElement).files)}
          />
          <input ref={(el) => (this.zipInput = el)} type="file" accept=".zip,application/zip" hidden onChange={(e) => this.onZip((e.target as HTMLInputElement).files)} />
          <p class="hint">
            {upload
              ? 'The files stay in this browser and are served to the editor from here, so its stories can be read. Nothing is uploaded to a server.'
              : 'Uploading needs a browser with service workers, over HTTPS.'}
          </p>
        </div>
        {this.busy ? <p class="hint">{this.busy}</p> : null}
        {this.error ? (
          <div class="error-box" role="alert">
            {this.error}
          </div>
        ) : null}
      </div>,
      <footer>
        <button class="btn" onClick={this.close}>
          Cancel
        </button>
      </footer>,
    ];
  }

  private renderPick() {
    const q = this.query.trim().toLowerCase();
    const visible = this.stories.filter((s) => !q || `${s.title} ${s.name}`.toLowerCase().includes(q));
    const groups = groupStories(visible);
    const count = this.selected.size;
    return [
      <div class="dialog-body">
        <div class="row wrap">
          <strong class="grow">
            {this.name} · {this.stories.length} stor{this.stories.length === 1 ? 'y' : 'ies'}
          </strong>
          <button class="btn" onClick={() => this.toggle(visible.map((s) => s.id), true)}>
            Select all
          </button>
          <button class="btn" onClick={() => this.toggle(visible.map((s) => s.id), false)}>
            Select none
          </button>
        </div>
        <input class="input" type="search" placeholder="Find a story…" aria-label="Find a story" value={this.query} onInput={(e) => (this.query = (e.target as HTMLInputElement).value)} />
        <div class="story-list" role="group" aria-label="Stories">
          {groups.map((g) => {
            const ids = g.stories.map((s) => s.id);
            const on = ids.filter((id) => this.selected.has(id)).length;
            return (
              <div class="story-group">
                <label class="story-row group">
                  <input
                    type="checkbox"
                    checked={on === ids.length}
                    indeterminate={on > 0 && on < ids.length}
                    onChange={(e) => this.toggle(ids, (e.target as HTMLInputElement).checked)}
                  />
                  <span>{g.title}</span>
                </label>
                {g.stories.map((s) => (
                  <label class="story-row">
                    <input type="checkbox" checked={this.selected.has(s.id)} onChange={(e) => this.toggle([s.id], (e.target as HTMLInputElement).checked)} />
                    <span>{s.name}</span>
                  </label>
                ))}
              </div>
            );
          })}
          {!groups.length ? <p class="empty">No stories match “{this.query}”.</p> : null}
        </div>
        <div class="story-options">
          <div class="row wrap">
            <span class="option-label">Bring in as</span>
            <div class="segmented" role="group" aria-label="Bring in as">
              {(
                [
                  ['palette', 'Palette branches'],
                  ['trees', 'New trees'],
                  ['both', 'Both'],
                ] as const
              ).map(([id, label]) => (
                <button aria-pressed={String(this.as === id)} onClick={() => (this.as = id)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div class="row wrap">
            <span class="option-label">Stylesheets</span>
            <div class="segmented" role="group" aria-label="Stylesheets">
              <button aria-pressed={String(this.styles === 'link')} disabled={this.uploaded} title={this.uploaded ? 'An uploaded Storybook is only served in this browser, so its CSS is copied' : undefined} onClick={() => (this.styles = 'link')}>
                Link files
              </button>
              <button aria-pressed={String(this.styles === 'copy')} onClick={() => (this.styles = 'copy')}>
                Copy CSS
              </button>
            </div>
          </div>
          <label class="row">
            <input type="checkbox" checked={this.viewports} onChange={(e) => (this.viewports = (e.target as HTMLInputElement).checked)} />
            <span>Use the Storybook’s viewport sizes for the display types (in this browser)</span>
          </label>
          <p class="hint" style={{ margin: '0' }}>
            Each story comes in as a snapshot of what it rendered: markup, styles and text. Interactive behavior (state, events, data loading) doesn’t come along. Palette branches are kept in this browser and work in every forest; trees get one per component, with a section per story.
          </p>
        </div>
        {this.error ? (
          <div class="error-box" role="alert">
            {this.error}
          </div>
        ) : null}
      </div>,
      <footer>
        <button
          class="btn"
          onClick={() => {
            this.stage = 'source';
            this.error = '';
          }}
        >
          Back
        </button>
        <button class="btn primary" disabled={!count} onClick={() => void this.run()}>
          Import {count} stor{count === 1 ? 'y' : 'ies'}
        </button>
      </footer>,
    ];
  }

  private renderProgress() {
    const entries = this.stories.filter((s) => this.status.has(s.id));
    const finished = [...this.status.values()].filter((s) => s.status !== 'waiting').length;
    const failed = entries.filter((s) => this.status.get(s.id)!.status === 'failed');
    const running = this.stage === 'running';
    return [
      <div class="dialog-body">
        <p style={{ margin: '0' }}>
          {running ? `Rendering stories… ${finished} of ${entries.length}` : this.summary || 'Nothing was imported.'}
        </p>
        <progress max={entries.length} value={finished} style={{ width: '100%' }} />
        <ul class="story-progress">
          {(running ? entries : failed).map((s) => {
            const st = this.status.get(s.id)!;
            return (
              <li class={st.status}>
                <span class="mark" aria-hidden="true">
                  {st.status === 'ok' ? '✓' : st.status === 'failed' ? '✕' : '…'}
                </span>
                <span>
                  {s.title} / {s.name}
                  {st.error ? <small> {st.error}</small> : null}
                </span>
              </li>
            );
          })}
        </ul>
        {!running && failed.length ? <p class="hint">Stories that need a network call, a user action or a portal to show content may fail or come in empty.</p> : null}
        {this.error ? (
          <div class="error-box" role="alert">
            {this.error}
          </div>
        ) : null}
      </div>,
      <footer>
        <button class="btn primary" disabled={running} onClick={this.close}>
          Done
        </button>
      </footer>,
    ];
  }

  render() {
    return (
      <div class="dialog-backdrop" onClick={(e) => e.target === e.currentTarget && this.close()} onKeyDown={(e) => e.key === 'Escape' && this.close()}>
        <div class="dialog storybook-import" role="dialog" aria-modal="true" aria-labelledby="sb-title" ref={(el) => (this.dialogEl = el)}>
          <header>
            <h2 id="sb-title">Import from Storybook</h2>
            <button class="icon-btn" aria-label="Close" onClick={this.close} disabled={this.stage === 'running'}>
              <Icon name="x" />
            </button>
          </header>
          {this.stage === 'source' ? this.renderSource() : this.stage === 'pick' ? this.renderPick() : this.renderProgress()}
        </div>
      </div>
    );
  }
}
