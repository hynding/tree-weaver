/**
 * Embed the Tree Weaver editor in any page.
 *
 * ```html
 * <script type="module" src="https://hynding.github.io/tree-weaver/embed.js"></script>
 * <tree-weaver-editor src="https://example.com/home.tree.json" style="height: 80vh"></tree-weaver-editor>
 * <script type="module">
 *   const editor = document.querySelector('tree-weaver-editor');
 *   editor.addEventListener('change', (e) => console.log(e.detail.forest));
 *   const json = await editor.getDocument({ format: 'json' });
 * </script>
 * ```
 *
 * The element hosts the editor in an iframe, so its styles and state stay apart from the
 * page, and talks to it with `postMessage` (the protocol is below, for hosts that want to
 * use an iframe directly). In embed mode the editor keeps nothing in the browser: the page
 * owns the document.
 *
 * This file has no imports, so it also works as a plain `<script type="module">`.
 */

/* ------------------------------------------------------------------ protocol */

/** Formats the editor reads and writes. */
export type EmbedFormat = 'json' | 'yaml' | 'xml' | 'html' | 'markdown' | 'svg';

/** Display ids: `lg` is the base. */
export type EmbedDisplay = 'lg' | 'xl' | 'tablet' | 'mobile-landscape' | 'mobile-portrait';

/** Messages a host page sends to the editor. `id` comes back on the response. */
export type HostMessage = { source: 'tree-weaver-host'; id?: string } & (
  | { type: 'load'; document: string | object; format?: EmbedFormat }
  | { type: 'getDocument'; format?: EmbedFormat; scope?: 'forest' | 'tree' }
  | { type: 'setDisplay'; display: EmbedDisplay }
  | { type: 'selectTree'; tree: string }
  | { type: 'ping' }
);

/** A forest as plain JSON (see the Tree Weaver JSON Schema). */
export type ForestData = { id: string; name: string; trees: { id: string; name: string; root: object }[]; kits: object[] } & Record<string, unknown>;

/** Messages the editor sends to its host page. */
export type EditorMessage = { source: 'tree-weaver-editor' } & (
  /** The editor is listening. Sent to any origin, and carries no document. */
  | { type: 'ready'; version: string }
  /** The document changed (debounced). Only sent to the host's origin. */
  | { type: 'change'; forest: ForestData; treeId: string }
  | { type: 'response'; id: string; ok: true; result: unknown }
  | { type: 'response'; id: string; ok: false; error: string }
);

export const HOST_SOURCE = 'tree-weaver-host';
export const EDITOR_SOURCE = 'tree-weaver-editor';

/** Where the hosted editor lives. Point the `editor` attribute at your own deployment to use that instead. */
export const DEFAULT_EDITOR_URL = 'https://hynding.github.io/tree-weaver/';

/* ------------------------------------------------------------------- element */

type Pending = { resolve: (value: unknown) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> };

const Base: typeof HTMLElement = typeof HTMLElement === 'undefined' ? (class {} as typeof HTMLElement) : HTMLElement;

/**
 * `<tree-weaver-editor>`: the Tree Weaver editor as an element.
 *
 * Attributes: `src` (a document URL to open), `editor` (the editor's URL; default the hosted
 * editor), `title` (the iframe's accessible name).
 *
 * Events: `ready`, `change` (`detail: { forest, treeId }`), `error` (`detail: { message }`).
 */
export class TreeWeaverEditor extends Base {
  static get observedAttributes(): string[] {
    return ['src', 'editor'];
  }

  /** The latest forest the editor reported, as plain JSON. */
  forest: ForestData | null = null;
  /** Resolves when the editor is ready for calls. */
  ready: Promise<void>;

  private frame: HTMLIFrameElement | null = null;
  private seq = 0;
  private pending = new Map<string, Pending>();
  private markReady: () => void = () => undefined;
  private isReady = false;
  private readonly onMessage = (ev: MessageEvent) => this.receive(ev);

  constructor() {
    super();
    this.ready = this.freshReady();
  }

  connectedCallback(): void {
    if (!this.shadowRoot) {
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = '<style>:host{display:block;height:640px;min-height:320px;border:1px solid #d0d7de;border-radius:8px;overflow:hidden}iframe{display:block;width:100%;height:100%;border:0}</style>';
      this.frame = document.createElement('iframe');
      this.frame.title = this.getAttribute('title') ?? 'Tree Weaver editor';
      this.frame.allow = 'clipboard-read; clipboard-write';
      root.append(this.frame);
    }
    window.addEventListener('message', this.onMessage);
    this.navigate();
  }

  disconnectedCallback(): void {
    window.removeEventListener('message', this.onMessage);
    this.failPending('The editor was removed from the page');
  }

  attributeChangedCallback(_name: string, oldValue: string | null, value: string | null): void {
    if (oldValue !== value && this.frame) this.navigate();
  }

  /** The editor's URL, with the embed flags. */
  get editorUrl(): string {
    const base = new URL(this.getAttribute('editor') || DEFAULT_EDITOR_URL, document.baseURI);
    const url = new URL(base.href);
    url.searchParams.set('embed', '1');
    url.searchParams.set('origin', window.location.origin);
    const src = this.getAttribute('src');
    if (src) url.searchParams.set('src', new URL(src, document.baseURI).href);
    else url.searchParams.delete('src');
    return url.href;
  }

  /** Open a document: a forest or tree as JSON text, an object, or YAML, XML, HTML, Markdown or SVG text. */
  async load(document: string | object, options: { format?: EmbedFormat } = {}): Promise<{ kind: 'forest' | 'tree'; trees: number }> {
    return (await this.request({ type: 'load', document, format: options.format })) as { kind: 'forest' | 'tree'; trees: number };
  }

  /** The current forest (or just the open tree, with `scope: 'tree'`) as text in `format` (default JSON). */
  async getDocument(options: { format?: EmbedFormat; scope?: 'forest' | 'tree' } = {}): Promise<string> {
    return (await this.request({ type: 'getDocument', format: options.format, scope: options.scope })) as string;
  }

  /** The current forest as plain JSON. */
  async getForest(): Promise<ForestData> {
    return JSON.parse(await this.getDocument({ format: 'json' })).forest as ForestData;
  }

  /** Show a display: `lg`, `xl`, `tablet`, `mobile-landscape` or `mobile-portrait`. */
  async setDisplay(display: EmbedDisplay): Promise<void> {
    await this.request({ type: 'setDisplay', display });
  }

  /** Open a tree of the forest by id or name. */
  async selectTree(tree: string): Promise<void> {
    await this.request({ type: 'selectTree', tree });
  }

  /* --------------------------------------------------------------- private */

  private freshReady(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.markReady = resolve;
    });
  }

  private get editorOrigin(): string {
    return new URL(this.getAttribute('editor') || DEFAULT_EDITOR_URL, document.baseURI).origin;
  }

  private navigate(): void {
    if (!this.frame) return;
    if (this.isReady) {
      this.isReady = false;
      this.ready = this.freshReady();
      this.failPending('The editor reloaded');
    }
    this.frame.src = this.editorUrl;
  }

  private async request(message: Record<string, unknown> & { type: HostMessage['type'] }): Promise<unknown> {
    await this.ready;
    const target = this.frame?.contentWindow;
    if (!target) throw new Error('The editor is not on the page');
    const id = `tw${++this.seq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`The editor did not answer "${message.type}"`));
      }, 20000);
      this.pending.set(id, { resolve, reject, timer });
      target.postMessage({ ...message, source: HOST_SOURCE, id }, this.editorOrigin);
    });
  }

  private receive(ev: MessageEvent): void {
    if (!this.frame || ev.source !== this.frame.contentWindow || ev.origin !== this.editorOrigin) return;
    const msg = ev.data as EditorMessage;
    if (!msg || typeof msg !== 'object' || msg.source !== EDITOR_SOURCE) return;
    switch (msg.type) {
      case 'ready':
        this.isReady = true;
        this.markReady();
        this.dispatchEvent(new CustomEvent('ready', { detail: { version: msg.version } }));
        break;
      case 'change':
        this.forest = msg.forest;
        this.dispatchEvent(new CustomEvent('change', { detail: { forest: msg.forest, treeId: msg.treeId } }));
        break;
      case 'response': {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.ok) p.resolve(msg.result);
        else {
          p.reject(new Error(msg.error));
          this.dispatchEvent(new CustomEvent('error', { detail: { message: msg.error } }));
        }
        break;
      }
    }
  }

  private failPending(reason: string): void {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
      this.pending.delete(id);
    }
  }
}

/** Register `<tree-weaver-editor>` (or another tag name). Safe to call more than once. */
export function defineTreeWeaverEditor(tag = 'tree-weaver-editor'): void {
  if (typeof customElements !== 'undefined' && !customElements.get(tag)) customElements.define(tag, TreeWeaverEditor);
}

defineTreeWeaverEditor();

declare global {
  interface HTMLElementTagNameMap {
    'tree-weaver-editor': TreeWeaverEditor;
  }
}
