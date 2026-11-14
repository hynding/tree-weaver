import { Component, Prop, State, h } from '@stencil/core';
import { COMPONENT_FRAMEWORKS, detectFormat, FORMATS, hasDrawing, type ComponentFramework, type ComponentStyling, type FormatId } from '@tree-weaver/formats';
import { currentTree, download, exportComponentCurrent, exportCurrent, exportStorybookCurrent, importText, toast, type ExportOutput } from '../../store/actions';
import { state } from '../../store/editor';
import { STORYBOOK_IMPORT_ENABLED } from '../../config';
import { Icon } from '../../utils/icons';

const ACCEPT = FORMATS.flatMap((f) => f.extensions.map((e) => `.${e}`)).join(',');

/** Export targets: every data format, a Storybook project, or a component for a codebase. */
type ExportTarget = FormatId | 'storybook' | 'component';

/** Upload and download trees and forests in JSON, YAML, XML, HTML and Markdown, or download them as a Storybook project. */
@Component({ tag: 'tw-io-dialog' })
export class TwIoDialog {
  @Prop() mode: 'import' | 'export' = 'export';

  @State() format: ExportTarget = 'json';
  @State() scope: 'tree' | 'forest' = 'tree';
  @State() framework: ComponentFramework = 'react';
  @State() styling: ComponentStyling = 'css';
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
      if (this.format === 'storybook') return exportStorybookCurrent(this.scope);
      if (this.format === 'component') return exportComponentCurrent(this.framework, this.styling);
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
    const tree = currentTree();
    const drawing = !!tree && hasDrawing(tree);
    const forestOnly = (id: ExportTarget) =>
      id === 'component' ? this.scope === 'forest' : id !== 'storybook' && this.scope === 'forest' && !FORMATS.find((f) => f.id === id)!.forest;
    const unavailable = (id: ExportTarget) => forestOnly(id) || (id === 'svg' && !drawing);
    if (unavailable(this.format)) this.format = 'json';
    const storybook = this.format === 'storybook';
    const component = this.format === 'component';
    const out = this.output();
    const zipped = !!out?.bytes;
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
              disabled={unavailable(f.id)}
              title={forestOnly(f.id) ? `${f.label} holds a single tree` : unavailable(f.id) ? 'This tree has no SVG to export' : undefined}
              onClick={() => (this.format = f.id)}
            >
              <strong>{f.label}</strong>
              <small>{f.id === 'html' ? 'Web page' : f.id === 'markdown' ? 'Readable, layout kept' : f.id === 'svg' ? 'Drawing' : f.forest ? 'Tree or forest' : 'Single tree'}</small>
            </button>
          ))}
          <button class="format-option" aria-pressed={String(storybook)} onClick={() => (this.format = 'storybook')}>
            <strong>Storybook</strong>
            <small>Stories project (zip)</small>
          </button>
          <button
            class="format-option"
            aria-pressed={String(component)}
            disabled={forestOnly('component')}
            title={forestOnly('component') ? 'A component holds a single tree' : undefined}
            onClick={() => (this.format = 'component')}
          >
            <strong>Component</strong>
            <small>React, Vue, Svelte</small>
          </button>
        </div>
        {component ? (
          <div class="row wrap">
            <div class="segmented" role="group" aria-label="Framework">
              {COMPONENT_FRAMEWORKS.map((f) => (
                <button aria-pressed={String(this.framework === f.id)} title={f.label} onClick={() => (this.framework = f.id)}>
                  {f.id === 'html' ? 'HTML + CSS' : f.label.split(' ')[0]}
                </button>
              ))}
            </div>
            <div class="segmented" role="group" aria-label="Styles">
              <button aria-pressed={String(this.styling === 'css')} onClick={() => (this.styling = 'css')}>
                CSS file
              </button>
              <button aria-pressed={String(this.styling === 'tailwind')} onClick={() => (this.styling = 'tailwind')}>
                Tailwind
              </button>
            </div>
          </div>
        ) : null}
        <textarea class="preview" readOnly aria-label="Export preview">
          {out?.text}
        </textarea>
        <p class="hint" style={{ margin: '0' }}>
          {component
            ? this.styling === 'tailwind'
              ? 'Source code for your app, with Tailwind classes (v3.4+ or v4) and each display as a responsive variant. Design kits come along in kits.css.'
              : 'Source code for your app, with a stylesheet of readable, namespaced class names and a media query per display. Design kits come along in kits.css.'
            : storybook
            ? 'A Storybook project: a story for each tree, each display type and each named branch, with text and images editable as controls. Unzip it, then run npm install and npm run storybook.'
            : this.format === 'html'
              ? 'A standalone page with your kits and responsive CSS inlined. It imports back with every branch and style.'
              : this.format === 'markdown'
                ? 'Content as Markdown. Layout branches and responsive styles ride along in front matter and HTML comments, so it imports back intact.'
                : this.format === 'svg'
                  ? 'A standalone SVG file of this tree’s drawing, with your kits and responsive styles inside. It imports back as an SVG tree.'
                  : 'Lossless: imports back exactly, including ids, kits and every display’s styles.'}
        </p>
      </div>,
      <footer>
        <button
          class="btn"
          disabled={!out?.fileName || storybook || zipped}
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
        {STORYBOOK_IMPORT_ENABLED ? (
          <div class="row">
            <span class="grow hint" style={{ margin: '0' }}>
              Have a component library in Storybook? Bring its stories in as branches or trees.
            </span>
            <button class="btn" onClick={() => (state.dialog = 'storybook')}>
              Import from Storybook…
            </button>
          </div>
        ) : null}
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
