import {
  cloneNode,
  createBranch,
  createId,
  createTree,
  isBranch,
  type Branch,
  type DesignKit,
  type DisplayId,
  type DisplaySettings,
  type Tree,
  type TreeNode,
} from '@tree-weaver/core';
import { importHtml } from './html';
import { FormatError } from './types';

/**
 * Storybook import: read a compiled Storybook (`storybook-static`) into Tree Weaver.
 *
 * Storybook components are compiled JavaScript, so what comes in is a static snapshot of
 * each story: the markup it rendered, the styles it used, its args and the viewports it
 * was configured with. The browser side (rendering a story in a same-origin iframe and
 * reading it back) lives in the web app; this module holds the parts that need no browser:
 * reading the story catalog and turning snapshots into branches, trees and design kits.
 */

/* ------------------------------------------------------------------ catalog */

/** One story from a Storybook's `index.json`. */
export interface StoryEntry {
  /** Storybook's story id, e.g. `components-button--primary`. */
  id: string;
  /** Component title, with `/` separating groups, e.g. `Components/Button`. */
  title: string;
  /** Story name, e.g. `Primary`. */
  name: string;
  tags: string[];
}

export interface StoryCatalog {
  /** Index format version (`index.json` v4 and v5, or `stories.json` v3). */
  version: number;
  stories: StoryEntry[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * Read a Storybook story index: `index.json` (Storybook 7 and later) or `stories.json`
 * (Storybook 6). Docs pages are left out; only stories can be rendered as snapshots.
 */
export function parseStoryIndex(input: string | unknown): StoryCatalog {
  let data: unknown = input;
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input);
    } catch {
      throw new FormatError('The Storybook index is not valid JSON');
    }
  }
  if (!isObj(data)) throw new FormatError('The Storybook index is not an object');
  const raw = isObj(data.entries) ? data.entries : isObj(data.stories) ? data.stories : null;
  if (!raw) throw new FormatError('This is not a Storybook index: it has no "entries" or "stories"');
  const stories: StoryEntry[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (!isObj(value)) continue;
    const type = str(value.type) || 'story';
    if (type !== 'story') continue;
    // Storybook 6 marks docs-only pages with a parameter instead of a type.
    if (isObj(value.parameters) && value.parameters.docsOnly) continue;
    const id = str(value.id) || key;
    const title = str(value.title) || str(value.kind);
    if (!id || !title) continue;
    const tags = Array.isArray(value.tags) ? value.tags.filter((t): t is string => typeof t === 'string') : [];
    stories.push({ id, title, name: str(value.name) || str(value.story) || id, tags });
  }
  return { version: typeof data.v === 'number' ? data.v : 0, stories };
}

/** Turn a title glob such as `Components/**` or `*\/Button` into a matcher. `*` stays inside one level, `**` crosses levels. */
export function titleGlob(glob: string): (title: string) => boolean {
  const pattern = glob
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .split(/(\*\*|\*)/)
    .map((part) => (part === '**' ? '.*' : part === '*' ? '[^/]*' : part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')))
    .join('');
  const re = new RegExp(`^${pattern}$`, 'i');
  // `Components/**` also matches the `Components` title itself.
  const parent = glob.trim().endsWith('/**') ? glob.trim().slice(0, -3).toLowerCase() : null;
  return (title) => re.test(title) || (parent !== null && title.toLowerCase() === parent);
}

/** Parse a comma- or newline-separated list of title globs (`TW_STORYBOOK_INCLUDE`). Titles can hold spaces. */
export const parseTitleGlobs = (value: string | undefined | null): string[] =>
  (value ?? '')
    .split(/[,\n]+/)
    .map((g) => g.trim())
    .filter(Boolean);

/** Only the stories whose title matches one of the globs. With no globs, every story. */
export function filterStories(stories: StoryEntry[], globs: string[]): StoryEntry[] {
  if (!globs.length) return stories;
  const matchers = globs.map(titleGlob);
  return stories.filter((s) => matchers.some((m) => m(s.title)));
}

/** Stories grouped by component title, in catalog order. */
export function groupStories<T extends { title: string }>(stories: T[]): { title: string; stories: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const s of stories) {
    const list = groups.get(s.title);
    if (list) list.push(s);
    else groups.set(s.title, [s]);
  }
  return [...groups].map(([title, list]) => ({ title, stories: list }));
}

/* ---------------------------------------------------------------- snapshots */

/** A stylesheet in use while a story rendered. */
export interface StorySheet {
  /** Absolute URL of a `<link>`ed stylesheet. Missing for `<style>` tags and CSS-in-JS. */
  href?: string;
  /** The sheet's CSS, as the browser parsed it. Empty when it couldn't be read. */
  css: string;
}

/** A Storybook viewport (from `parameters.viewport.options`). */
export interface StoryViewport {
  name: string;
  width: number;
  height: number;
  /** `desktop`, `tablet`, `mobile` or `other`. */
  type?: string;
}

/** What a rendered story looked like, read from its iframe. */
export interface StorySnapshot {
  id: string;
  title: string;
  name: string;
  /** Markup inside the story root (`#storybook-root`), with URLs made absolute. */
  html: string;
  sheets: StorySheet[];
  /** The story's args as rendered. */
  args?: Record<string, unknown>;
  viewports?: StoryViewport[];
}

/** Storybook's own preview chrome, which never belongs in a design kit. */
const STORYBOOK_CHROME = /\.sb-show-main|\.sb-nopreview|#storybook-root|\.sb-errordisplay|\.sb-preparing-story/;

/** Whether a stylesheet is Storybook's own preview styling rather than the component library's. */
export const isStorybookChrome = (sheet: StorySheet): boolean =>
  STORYBOOK_CHROME.test(sheet.css) || /\/sb-(preview|addons|common-assets|manager)\//.test(sheet.href ?? '');

/** Rewrite relative `url(...)` references in CSS against the stylesheet's own URL, so copied CSS still finds fonts and images. */
export function absolutizeCssUrls(css: string, baseHref: string): string {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (whole, _quote: string, ref: string) => {
    const target = ref.trim();
    if (/^(data:|[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(target)) return whole;
    try {
      return `url("${new URL(target, baseHref).href}")`;
    } catch {
      return whole;
    }
  });
}

/** Display a Storybook viewport fits best: by its declared type, then by its shape and width. */
export function displayForViewport(v: StoryViewport): DisplayId {
  const type = (v.type ?? '').toLowerCase();
  const landscape = v.width > v.height;
  if (type === 'mobile') return landscape ? 'mobile-landscape' : 'mobile-portrait';
  if (type === 'tablet') return 'tablet';
  if (type === 'desktop') return v.width >= 1600 ? 'xl' : 'lg';
  if (v.width < 600) return 'mobile-portrait';
  if (landscape && v.height < 600) return 'mobile-landscape';
  if (v.width < 1100) return 'tablet';
  return v.width >= 1600 ? 'xl' : 'lg';
}

/**
 * Display sizes taken from Storybook viewports: the first viewport that fits each display
 * type sets that display's preview width and height. Breakpoints are left alone.
 */
export function viewportDisplaySettings(viewports: StoryViewport[]): DisplaySettings {
  const out: DisplaySettings = {};
  for (const v of viewports) {
    if (!(v.width > 0 && v.height > 0)) continue;
    const id = displayForViewport(v);
    if (!out[id]) out[id] = { width: Math.round(v.width), height: Math.round(v.height) };
  }
  return out;
}

/** Read Storybook's `viewport.options` parameter (Storybook 7 to 10) into plain sizes. */
export function readViewports(options: unknown): StoryViewport[] {
  if (!isObj(options)) return [];
  const px = (v: unknown): number => {
    const n = typeof v === 'number' ? v : parseFloat(str(v));
    return Number.isFinite(n) && (typeof v === 'number' || /^\s*[\d.]+\s*(px)?\s*$/.test(str(v))) ? n : NaN;
  };
  const out: StoryViewport[] = [];
  for (const [key, value] of Object.entries(options)) {
    if (!isObj(value) || !isObj(value.styles)) continue;
    const width = px(value.styles.width);
    const height = px(value.styles.height);
    if (!Number.isFinite(width) || !Number.isFinite(height)) continue;
    out.push({ name: str(value.name) || key, width, height, type: str(value.type) || undefined });
  }
  return out;
}

/** Name of a story's branch, e.g. `Button / Primary`. */
export const storyLabel = (s: { title: string; name: string }): string => `${s.title.split('/').pop()!.trim()} / ${s.name}`;

/**
 * Name branches after the string args they show, so a story's editable content is easy to
 * find in the outline: a branch whose only content is the text of the `label` arg is named `label`.
 */
function nameArgBranches(node: Branch, args: Record<string, unknown>): void {
  const texts = new Map<string, string>();
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string' && value.trim()) texts.set(value.trim(), key);
  }
  if (!texts.size) return;
  const visit = (b: Branch) => {
    const only = b.children.length === 1 ? b.children[0] : null;
    if (only && only.kind === 'leaf' && only.type === 'text' && !b.name) {
      const key = texts.get(only.value.trim());
      if (key) b.name = key;
    }
    b.children.forEach((c) => isBranch(c) && visit(c));
  };
  visit(node);
}

/**
 * A story as one branch: the rendered markup read through the HTML importer, wrapped when
 * the story rendered more than one element. Inline styles become desktop (base) styles.
 */
export function snapshotToBranch(snapshot: StorySnapshot): Branch {
  const doc = importHtml(`<body>${snapshot.html}</body>`);
  if (doc.kind !== 'tree') throw new FormatError(`Story "${snapshot.id}" did not render a tree`);
  const children = doc.tree.root.children.filter((c) => !(c.kind === 'leaf' && c.type === 'text' && !c.value.trim()));
  const single = children.length === 1 && isBranch(children[0]) ? children[0] : null;
  const branch = single ?? createBranch({ tag: 'div', children: children.length ? children : [] });
  branch.name = storyLabel(snapshot);
  branch.type ??= 'storybook';
  branch.attrs = { ...branch.attrs, 'data-story': snapshot.id };
  if (snapshot.args) nameArgBranches(branch, snapshot.args);
  return branch;
}

/** A Storybook library entry: a story's branch, ready for the palette. */
export interface LibraryBranch {
  /** Storybook story id. */
  id: string;
  title: string;
  name: string;
  branch: Branch;
}

/** One tree per component title, with each of its stories as a branch, one after the other. */
export function storiesToTrees(items: LibraryBranch[]): Tree[] {
  const groups = new Map<string, LibraryBranch[]>();
  for (const item of items) {
    const list = groups.get(item.title);
    if (list) list.push(item);
    else groups.set(item.title, [item]);
  }
  return [...groups].map(([title, list]) => {
    const tree = createTree(title.split('/').pop()!.trim() || title);
    tree.root.children = list.map((item): TreeNode => {
      const section = createBranch({
        tag: 'section',
        type: 'story',
        name: item.name,
        styles: { lg: { padding: '1.5rem', 'border-bottom': '1px solid #e3e8ee' } },
        children: [cloneNode(item.branch, true)],
      });
      return section;
    });
    return tree;
  });
}

export interface StoryKitOptions {
  /** Library name, used to name the kits. */
  name: string;
  /** `link` keeps stylesheet files as linked kits; `copy` copies their CSS into the forest. */
  styles: 'link' | 'copy';
  /** Source recorded on the kits, e.g. the Storybook URL. */
  source: string;
}

/**
 * Design kits for a set of story snapshots. Stylesheet files are deduplicated by URL and
 * become one kit each (linked, or copied with their `url()`s made absolute). Styles injected
 * at runtime (`<style>` tags, CSS-in-JS) are merged rule by rule into one kit, since each story
 * adds its own. Storybook's own preview styling is left out.
 */
export function storyKits(snapshots: StorySnapshot[], opts: StoryKitOptions): DesignKit[] {
  const files = new Map<string, string>();
  const rules: string[] = [];
  const seenRules = new Set<string>();
  for (const snap of snapshots) {
    for (const sheet of snap.sheets) {
      if (isStorybookChrome(sheet)) continue;
      if (sheet.href) {
        if (!files.has(sheet.href) || (!files.get(sheet.href) && sheet.css)) files.set(sheet.href, sheet.css);
        continue;
      }
      for (const rule of splitRules(sheet.css)) {
        if (seenRules.has(rule)) continue;
        seenRules.add(rule);
        rules.push(rule);
      }
    }
  }
  const kits: DesignKit[] = [];
  for (const [href, css] of files) {
    const fileName = href.split(/[?#]/)[0].split('/').pop() || href;
    const kit: DesignKit = { id: createId('k'), name: `${opts.name}: ${fileName}`, css: absolutizeCssUrls(css, href), enabled: true, source: href };
    if (opts.styles === 'link') kit.href = href;
    kits.push(kit);
  }
  if (rules.length) kits.push({ id: createId('k'), name: `${opts.name}: runtime styles`, css: rules.join('\n'), enabled: true, source: opts.source });
  return kits;
}

/** Split CSS into top-level rules (a block, or an at-rule statement), keeping nested blocks whole. */
export function splitRules(css: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  let quote = '';
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end < 0 ? css.length : end + 1;
    } else if (ch === '{') depth++;
    else if (ch === '}') {
      depth = Math.max(0, depth - 1);
      if (depth === 0) {
        out.push(css.slice(start, i + 1).trim());
        start = i + 1;
      }
    } else if (ch === ';' && depth === 0) {
      out.push(css.slice(start, i + 1).trim());
      start = i + 1;
    }
  }
  const rest = css.slice(start).trim();
  if (rest) out.push(rest);
  return out.map((r) => r.replace(/^\s*\/\*[\s\S]*?\*\/\s*/g, '').trim()).filter(Boolean);
}
