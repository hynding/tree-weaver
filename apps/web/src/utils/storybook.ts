import { parseStoryIndex, readViewports, type StoryCatalog, type StorySheet, type StorySnapshot, type StoryEntry } from '@tree-weaver/formats';

/**
 * Reading a compiled Storybook in the browser: its story catalog, and a snapshot of each
 * story rendered in a hidden iframe. Reading a rendered story needs the iframe on this
 * site's origin; other origins give the catalog and stylesheet links only.
 */

/** A Storybook's base URL, always ending in `/` (so `index.json` and `iframe.html` resolve inside it). */
export function storybookBase(url: string): string {
  const u = new URL(url.trim(), location.href);
  u.hash = '';
  u.search = '';
  // A link to the manager page or the iframe page points at the Storybook folder.
  u.pathname = u.pathname.replace(/\/(index|iframe)\.html$/, '/');
  if (!u.pathname.endsWith('/')) u.pathname += '/';
  return u.href;
}

export const isSameOrigin = (url: string): boolean => new URL(url, location.href).origin === location.origin;

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText || 'error'}`);
  return res.text();
}

/** Load the story catalog: `index.json`, or `stories.json` for Storybook 6. */
export async function loadCatalog(base: string): Promise<StoryCatalog> {
  const errors: string[] = [];
  for (const file of ['index.json', 'stories.json']) {
    try {
      return parseStoryIndex(await fetchText(new URL(file, base).href));
    } catch (err) {
      errors.push(`${file}: ${(err as Error).message}`);
    }
  }
  const hint = isSameOrigin(base) ? '' : ' If it is on another site, that site must allow cross-origin requests (CORS).';
  throw new Error(`Couldn’t read a Storybook at ${base} (${errors.join('; ')}).${hint}`);
}

/** Stylesheets a Storybook's preview page links, read from `iframe.html`. Works across origins when CORS allows it. */
export async function linkedStylesheets(base: string): Promise<string[]> {
  const html = await fetchText(new URL('iframe.html', base).href);
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const iframeUrl = new URL('iframe.html', base).href;
  return Array.from(doc.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"][href]'))
    .map((l) => new URL(l.getAttribute('href')!, iframeUrl).href)
    .filter((href) => !/\/sb-(preview|addons|common-assets|manager)\//.test(href));
}

/* ------------------------------------------------------------- rendering */

interface PreviewWindow extends Window {
  __STORYBOOK_PREVIEW__?: {
    storyStoreValue?: { loadStory(opts: { storyId: string }): Promise<{ initialArgs?: Record<string, unknown>; parameters?: Record<string, unknown> }> };
    currentRender?: { story?: { unboundStoryFn?: unknown; parameters?: Record<string, unknown>; initialArgs?: Record<string, unknown> } };
  };
  __STORYBOOK_STORY_STORE__?: unknown;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const STORY_ROOTS = ['#storybook-root', '#root'];

/** Status of the story in the iframe, from the classes Storybook puts on `<body>`. */
function storyStatus(doc: Document): 'rendered' | 'error' | 'pending' {
  const body = doc.body;
  if (!body) return 'pending';
  const cls = body.classList;
  if (cls.contains('sb-show-errordisplay')) return 'error';
  if (cls.contains('sb-show-nopreview')) return 'error';
  if (cls.contains('sb-show-preparing-story') || cls.contains('sb-show-preparing-docs')) return 'pending';
  if (cls.contains('sb-show-main')) return 'rendered';
  return 'pending';
}

/** Read a stylesheet's CSS from the CSSOM, which also holds rules CSS-in-JS libraries insert with `insertRule`. */
function sheetCss(sheet: CSSStyleSheet): string {
  try {
    return Array.from(sheet.cssRules)
      .map((r) => r.cssText)
      .join('\n');
  } catch {
    // A cross-origin stylesheet without CORS can't be read; it can still be linked.
    return '';
  }
}

function readSheets(doc: Document): StorySheet[] {
  const out: StorySheet[] = [];
  for (const sheet of Array.from(doc.styleSheets)) {
    const owner = sheet.ownerNode as Element | null;
    if (sheet.disabled || owner?.hasAttribute?.('disabled')) continue;
    if (sheet.media?.mediaText && /^print$/i.test(sheet.media.mediaText.trim())) continue;
    const css = sheetCss(sheet);
    if (sheet.href) out.push({ href: sheet.href, css });
    else if (css.trim()) out.push({ css });
  }
  return out;
}

/** The story's markup with every URL made absolute, so images and links still work outside Storybook. */
function readMarkup(root: Element): string {
  const copy = root.cloneNode(true) as Element;
  const originals = root.querySelectorAll('*');
  copy.querySelectorAll('*').forEach((el, i) => {
    const original = originals[i] as HTMLElement & { src?: string; href?: string };
    for (const attr of ['src', 'href', 'poster']) {
      if (!el.hasAttribute(attr)) continue;
      const value = el.getAttribute(attr)!;
      if (/^(#|javascript:|data:|mailto:|tel:)/i.test(value)) continue;
      try {
        el.setAttribute(attr, new URL(value, root.ownerDocument.baseURI).href);
      } catch {
        // Leave anything unparseable as it is.
      }
    }
    if (el.hasAttribute('srcset')) {
      el.setAttribute(
        'srcset',
        el
          .getAttribute('srcset')!
          .split(',')
          .map((part) => {
            const [u, ...rest] = part.trim().split(/\s+/);
            try {
              return [new URL(u, root.ownerDocument.baseURI).href, ...rest].join(' ');
            } catch {
              return part.trim();
            }
          })
          .join(', '),
      );
    }
    // Form state set by scripts isn't in the attributes; keep what the story shows.
    if (original instanceof HTMLInputElement && original.value && !el.hasAttribute('value') && original.type !== 'password') el.setAttribute('value', original.value);
  });
  return copy.innerHTML;
}

export interface SnapshotOptions {
  /** Width of the hidden iframe the story renders in. */
  width?: number;
  /** How long to wait for a story before giving up. */
  timeoutMs?: number;
}

/**
 * Render each story in a hidden same-origin iframe and read back its markup, styles,
 * args and viewports. Calls `onProgress` after each story; failed stories are reported,
 * not thrown.
 */
export async function snapshotStories(
  base: string,
  stories: StoryEntry[],
  onProgress: (story: StoryEntry, result: { snapshot?: StorySnapshot; error?: string }) => void,
  opts: SnapshotOptions = {},
): Promise<StorySnapshot[]> {
  if (!isSameOrigin(base)) throw new Error('Stories can only be rendered from a Storybook on this site. Upload the Storybook folder or zip instead.');
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  const width = opts.width ?? 1280;
  Object.assign(frame.style, { position: 'fixed', left: '-20000px', top: '0', width: `${width}px`, height: '900px', border: '0', visibility: 'hidden', pointerEvents: 'none' });
  document.body.appendChild(frame);
  const out: StorySnapshot[] = [];
  try {
    for (const story of stories) {
      try {
        const snapshot = await snapshotOne(frame, base, story, opts.timeoutMs ?? 15000);
        out.push(snapshot);
        onProgress(story, { snapshot });
      } catch (err) {
        onProgress(story, { error: (err as Error).message });
      }
    }
  } finally {
    frame.remove();
  }
  return out;
}

async function snapshotOne(frame: HTMLIFrameElement, base: string, story: StoryEntry, timeoutMs: number): Promise<StorySnapshot> {
  const url = new URL('iframe.html', base);
  url.searchParams.set('id', story.id);
  url.searchParams.set('viewMode', 'story');
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The preview page didn’t load')), timeoutMs);
    frame.onload = () => {
      clearTimeout(timer);
      resolve();
    };
    frame.src = url.href;
  });
  const win = frame.contentWindow as PreviewWindow | null;
  const doc = frame.contentDocument;
  if (!win || !doc) throw new Error('The preview page can’t be read from here');

  const started = Date.now();
  let status = storyStatus(doc);
  while (status === 'pending' && Date.now() - started < timeoutMs) {
    await wait(50);
    status = storyStatus(doc);
  }
  if (status === 'pending') throw new Error('The story didn’t finish rendering in time');
  if (status === 'error') {
    const message = ['#error-message', '.sb-errordisplay_main h1', '.sb-nopreview_heading']
      .map((sel) => doc.querySelector(sel)?.textContent?.trim())
      .find(Boolean);
    throw new Error(message || 'The story failed to render');
  }
  // Let effects, fonts and CSS-in-JS settle.
  await wait(150);
  await (doc as Document & { fonts?: FontFaceSet }).fonts?.ready;

  const root = STORY_ROOTS.map((s) => doc.querySelector(s)).find((el): el is Element => !!el);
  if (!root) throw new Error('No story root (#storybook-root) on the preview page');

  let args: Record<string, unknown> | undefined;
  let viewportOptions: unknown;
  try {
    const loaded = await win.__STORYBOOK_PREVIEW__?.storyStoreValue?.loadStory({ storyId: story.id });
    args = loaded?.initialArgs;
    const viewport = loaded?.parameters?.viewport as { options?: unknown; viewports?: unknown } | undefined;
    viewportOptions = viewport?.options ?? viewport?.viewports;
  } catch {
    // Older Storybooks or custom builds: carry on with markup and styles only.
  }

  return {
    id: story.id,
    title: story.title,
    name: story.name,
    html: readMarkup(root),
    sheets: readSheets(doc),
    args: args ? JSON.parse(JSON.stringify(args, (_k, v) => (typeof v === 'function' ? undefined : v))) : undefined,
    viewports: readViewports(viewportOptions),
  };
}
