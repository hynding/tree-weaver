import { createKit, isStylesheetUrl, parseCss, type CssNode, type DesignKit } from '@tree-weaver/core';

export interface KitToken {
  name: string;
  value: string;
}

export interface KitAnalysis {
  /** Class names the kit styles, ready to put on branches. */
  classes: string[];
  /** CSS custom properties (design tokens) the kit defines. */
  tokens: KitToken[];
  /** Stylesheets the kit pulls in with `@import`. */
  imports: string[];
  /** Media queries the kit uses. */
  media: string[];
  ruleCount: number;
}

const CLASS = /\.(-?[_a-zA-Z][_a-zA-Z0-9-]*(?:\\.[_a-zA-Z0-9-]*)*)/g;
const IMPORT_URL = /^(?:url\(\s*)?["']?([^"')\s]+)["']?\s*\)?/;

/** List what a design kit offers: classes, tokens, imports and breakpoints. */
export function analyzeKit(css: string): KitAnalysis {
  const classes = new Set<string>();
  const tokens = new Map<string, string>();
  const imports: string[] = [];
  const media = new Set<string>();
  let ruleCount = 0;

  const visit = (nodes: CssNode[]) => {
    for (const node of nodes) {
      if (node.type === 'rule') {
        ruleCount++;
        // Ignore attribute selectors and strings so `[href$=".pdf"]` doesn't yield a class.
        const selector = node.selector.replace(/\[[^\]]*\]/g, '').replace(/(["'])(?:\\.|(?!\1).)*\1/g, '');
        for (const m of selector.matchAll(CLASS)) classes.add(m[1].replace(/\\/g, ''));
        for (const [prop, value] of Object.entries(node.declarations)) if (prop.startsWith('--')) tokens.set(prop, value);
      } else {
        if (node.name === 'import') {
          const m = IMPORT_URL.exec(node.prelude);
          if (m) imports.push(m[1]);
        }
        if (node.name === 'media' && node.prelude) media.add(node.prelude);
        if (node.children) visit(node.children);
      }
    }
  };
  visit(parseCss(css));

  return {
    classes: [...classes].sort((a, b) => a.localeCompare(b)),
    tokens: [...tokens].map(([name, value]) => ({ name, value })),
    imports,
    media: [...media],
    ruleCount,
  };
}

/** Classes offered by every enabled kit, de-duplicated and sorted. */
export function kitClasses(kits: DesignKit[]): string[] {
  const all = new Set<string>();
  for (const kit of kits) if (kit.enabled) for (const c of analyzeKit(kit.css).classes) all.add(c);
  return [...all].sort((a, b) => a.localeCompare(b));
}

const baseName = (path: string) => (path.split(/[?#]/)[0].split('/').pop() || path).replace(/\.css$/i, '');

/** A kit from an uploaded `.css` file. */
export function kitFromFile(fileName: string, css: string): DesignKit {
  return createKit(baseName(fileName) || 'Design kit', css, fileName);
}

/** Fetch a stylesheet's CSS so its classes and tokens can be listed; empty when the server doesn't allow it (CORS). */
export async function fetchKitCss(url: string, fetchImpl: typeof fetch = globalThis.fetch): Promise<string> {
  try {
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch {
    return '';
  }
}

/** A linked kit for a stylesheet URL, without fetching anything yet. */
export function linkedKit(url: string, name = baseName(url) || 'Linked stylesheet'): DesignKit {
  return { ...createKit(name, '', url), href: url };
}

/**
 * A linked kit from a stylesheet URL. The stylesheet loads from the URL in its place in
 * the kit order; its CSS is fetched once so its classes and tokens can be listed.
 */
export async function kitFromUrl(url: string, fetchImpl: typeof fetch = globalThis.fetch): Promise<DesignKit> {
  return { ...linkedKit(url), css: await fetchKitCss(url, fetchImpl) };
}

/**
 * Stylesheet URLs from a setting such as `TW_CSS_URLS`: separated by commas, spaces or
 * new lines, kept in their given order, with duplicates and non-http(s) entries dropped.
 */
export function parseCssUrls(value: string | undefined | null): string[] {
  const urls: string[] = [];
  for (const part of (value ?? '').split(/[\s,]+/)) if (part && isStylesheetUrl(part) && !urls.includes(part)) urls.push(part);
  return urls;
}

/** Kits for stylesheets the deployment always loads first. They are not part of any forest. */
export function createEnvKits(urls: string[]): DesignKit[] {
  return urls.map((url, i) => ({ ...linkedKit(url), id: `env-${i + 1}`, source: 'env' }));
}

export const isEnvKit = (kit: DesignKit): boolean => kit.source === 'env';

/** A small starter kit so new forests have tokens and classes to work with. */
export const WEAVER_BASIC_CSS = `/* Weaver Basic: a starter design kit for Tree Weaver */
:root {
  --tw-color-text: #1f2328;
  --tw-color-muted: #59636e;
  --tw-color-surface: #ffffff;
  --tw-color-canvas: #f6f8fa;
  --tw-color-border: #d1d9e0;
  --tw-color-accent: #2f6f4f;
  --tw-color-accent-contrast: #ffffff;
  --tw-radius: 10px;
  --tw-space-1: 0.25rem;
  --tw-space-2: 0.5rem;
  --tw-space-3: 1rem;
  --tw-space-4: 1.5rem;
  --tw-space-5: 3rem;
  --tw-font-body: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --tw-font-display: Georgia, "Times New Roman", serif;
}

body { color: var(--tw-color-text); background: var(--tw-color-canvas); font-family: var(--tw-font-body); }
h1, h2, h3 { font-family: var(--tw-font-display); line-height: 1.2; margin: 0 0 var(--tw-space-2); }
p { margin: 0 0 var(--tw-space-3); }

.container { width: min(100% - 2 * var(--tw-space-3), 1200px); margin-inline: auto; }
.section { padding-block: var(--tw-space-5); }
.stack { display: flex; flex-direction: column; gap: var(--tw-space-3); }
.cluster { display: flex; flex-wrap: wrap; gap: var(--tw-space-2); align-items: center; }
.grid-auto { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: var(--tw-space-3); }
.card { background: var(--tw-color-surface); border: 1px solid var(--tw-color-border); border-radius: var(--tw-radius); padding: var(--tw-space-4); }
.surface { background: var(--tw-color-surface); }
.muted { color: var(--tw-color-muted); }
.center { text-align: center; }
.btn { display: inline-block; padding: var(--tw-space-2) var(--tw-space-3); border-radius: var(--tw-radius); border: 1px solid var(--tw-color-border); background: var(--tw-color-surface); color: inherit; text-decoration: none; cursor: pointer; font: inherit; }
.btn-primary { background: var(--tw-color-accent); border-color: var(--tw-color-accent); color: var(--tw-color-accent-contrast); }
.table { width: 100%; border-collapse: collapse; background: var(--tw-color-surface); }
.table th, .table td { border: 1px solid var(--tw-color-border); padding: var(--tw-space-2) var(--tw-space-3); text-align: left; }
.table th { background: var(--tw-color-canvas); }
.hero { padding-block: var(--tw-space-5); background: linear-gradient(135deg, #e7f3ec, #f6f8fa); }
.nav { display: flex; justify-content: space-between; align-items: center; padding-block: var(--tw-space-3); }

@media (max-width: 600px) {
  .section { padding-block: var(--tw-space-4); }
}
`;

export function createStarterKit(): DesignKit {
  return createKit('Weaver Basic', WEAVER_BASIC_CSS, 'builtin');
}
