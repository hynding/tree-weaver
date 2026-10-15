import { Component, Prop, State, h } from '@stencil/core';
import { detectFormat, FORMATS, type FormatId } from '@tree-weaver/formats';
import { currentTree, download, exportCurrent, importText, toast, type ExportOutput } from '../../store/actions';
import { state } from '../../store/editor';
import { Icon } from '../../utils/icons';

const ACCEPT = FORMATS.flatMap((f) => f.extensions.map((e) => `.${e}`)).join(',');

/** Upload and download trees and forests in JSON, YAML, XML, HTML and Markdown. */
@Component({ tag: 'tw-io-dialog' })
export class TwIoDialog {
  @Prop() mode: 'import' | 'export' = 'export';

  @State() format: FormatId = 'json';
  @State() scope: 'tree' | 'forest' = 'tree';
  @State() pasted = '';
  @State() pasteFormat: FormatId | 'auto' = 'auto';
  @State() error = '';
  @State() over = false;
  @State() busy = false;

  private fileInput?: HTMLInputElement;
  private dialogEl?: HTMLElement;

  componentDidLoad() {
    this.dialogEl?.querySelector<HTMLElement>('button, input, textarea')?.focus();
  }

  private close = () => {
    state.dialog = null;
  };

  private output(): ExportOutput | null {
    try {
      return exportCurrent(this.format, this.scope);
    } catch (err) {
      return { text: `Error: ${(err as Error).message}`, fileName: '', mime: 'text/plain' };
    }
  }

  private async run(text: string, format?: FormatId, fileName?: string) {
    this.error = '';
    this.busy = true;
    try {
      const { summary } = await importText(text, format, fileName);
      toast(summary, 'success');
      this.close();
    } catch (err) {
      this.error = `${fileName ? `${fileName}: ` : ''}${(err as Error).message}`;
    } finally {
      this.busy = false;
    }
  }

  private async onFiles(files: FileList | null) {
    const list = Array.from(files ?? []);
    for (const file of list) {
      const text = await file.text();
      await this.run(text, undefined, file.name);
      if (this.error) break;
    }
  }

  private renderExport() {
    const forestOnly = (id: FormatId) => this.scope === 'forest' && !FORMATS.find((f) => f.id === id)!.forest;
    if (forestOnly(this.format)) this.format = 'json';
    const out = this.output();
    const tree = currentTree();
    return [
      <div class="dialog-body">
        <div class="row wrap">
          <span class="hint" style={{ margin: '0' }}>
            Export
          </span>
          <div class="segmented" role="group" aria-label="What to export">
            <button aria-pressed={String(this.scope === 'tree')} onClick={() => (this.scope = 'tree')}>
              This tree ({tree?.name})
            </button>
            <button aria-pressed={String(this.scope === 'forest')} onClick={() => (this.scope = 'forest')}>
              Whole forest
            </button>
          </div>
        </div>
        <div class="format-grid" role="group" aria-label="Format">
          {FORMATS.map((f) => (
            <button
              class="format-option"
              aria-pressed={String(this.format === f.id)}
              disabled={forestOnly(f.id)}
              title={forestOnly(f.id) ? `${f.label} holds a single tree` : undefined}
              onClick={() => (this.format = f.id)}
            >
              <strong>{f.label}</strong>
              <small>{f.id === 'html' ? 'Web page' : f.id === 'markdown' ? 'Readable, layout kept' : f.forest ? 'Tree or forest' : 'Single tree'}</small>
            </button>
          ))}
        </div>
        <textarea class="preview" readOnly aria-label="Export preview">
          {out?.text}
        </textarea>
        <p class="hint" style={{ margin: '0' }}>
          {this.format === 'html'
            ? 'A standalone page with your kits and responsive CSS inlined. It imports back with every branch and style.'
            : this.format === 'markdown'
              ? 'Content as Markdown. Layout branches and responsive styles ride along in front matter and HTML comments, so it imports back intact.'
              : 'Lossless: imports back exactly, including ids, kits and every display’s styles.'}
        </p>
      </div>,
      <footer>
        <button
          class="btn"
          disabled={!out?.fileName}
          onClick={async () => {
            await navigator.clipboard.writeText(out!.text);
            toast('Copied to the clipboard', 'success');
          }}
        >
          <Icon name="copy" /> Copy
        </button>
        <button
          class="btn primary"
          disabled={!out?.fileName}
          onClick={() => {
            download(out!);
            this.close();
          }}
        >
          <Icon name="download" /> Download {out?.fileName}
        </button>
      </footer>,
    ];
  }

  private renderImport() {
    return [
      <div class="dialog-body">
        <div
          class={{ dropzone: true, over: this.over }}
          onDragOver={(e) => {
            e.preventDefault();
            this.over = true;
          }}
          onDragLeave={() => (this.over = false)}
          onDrop={(e) => {
            e.preventDefault();
            this.over = false;
            void this.onFiles(e.dataTransfer?.files ?? null);
          }}
        >
          <p style={{ margin: '0 0 10px' }}>Drop a file here: JSON, YAML, XML, HTML or Markdown.</p>
          <button class="btn primary" onClick={() => this.fileInput?.click()} disabled={this.busy}>
            <Icon name="upload" /> Choose file
          </button>
          <input ref={(el) => (this.fileInput = el)} type="file" accept={ACCEPT} multiple hidden onChange={(e) => this.onFiles((e.target as HTMLInputElement).files)} />
          <p class="hint">Forests open as a new forest. Trees, web pages and Markdown join the current forest as a new tree, bringing their styles along as design kits.</p>
        </div>
        <div>
          <div class="row" style={{ marginBottom: '6px' }}>
            <strong class="grow">Or paste</strong>
            <select class="select" style={{ width: 'auto' }} aria-label="Pasted format" onChange={(e) => (this.pasteFormat = (e.target as HTMLSelectElement).value as FormatId | 'auto')}>
              <option value="auto" selected={this.pasteFormat === 'auto'}>
                Detect format{this.pasted.trim() ? ` (${FORMATS.find((f) => f.id === detectFormat(this.pasted))?.label})` : ''}
              </option>
              {FORMATS.map((f) => (
                <option value={f.id} selected={this.pasteFormat === f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
          <textarea class="preview" style={{ height: '160px' }} aria-label="Pasted tree data" value={this.pasted} onInput={(e) => (this.pasted = (e.target as HTMLTextAreaElement).value)} />
        </div>
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
        <button class="btn primary" disabled={!this.pasted.trim() || this.busy} onClick={() => this.run(this.pasted, this.pasteFormat === 'auto' ? undefined : this.pasteFormat)}>
          Import pasted
        </button>
      </footer>,
    ];
  }

  render() {
    const title = this.mode === 'export' ? 'Download tree data' : 'Upload tree data';
    return (
      <div
        class="dialog-backdrop"
        onClick={(e) => e.target === e.currentTarget && this.close()}
        onKeyDown={(e) => e.key === 'Escape' && this.close()}
      >
        <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="io-title" ref={(el) => (this.dialogEl = el)}>
          <header>
            <h2 id="io-title">{title}</h2>
            <div class="row">
              <div class="segmented" role="group" aria-label="Direction">
                <button aria-pressed={String(this.mode === 'import')} onClick={() => (state.dialog = 'import')}>
                  Upload
                </button>
                <button aria-pressed={String(this.mode === 'export')} onClick={() => (state.dialog = 'export')}>
                  Download
                </button>
              </div>
              <button class="icon-btn" aria-label="Close" onClick={this.close}>
                <Icon name="x" />
              </button>
            </div>
          </header>
          {this.mode === 'export' ? this.renderExport() : this.renderImport()}
        </div>
      </div>
    );
  }
}
