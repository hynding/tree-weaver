import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { isBranch, type Branch } from '@tree-weaver/core';
import { describe, expect, it } from 'vitest';
import {
  absolutizeCssUrls,
  filterStories,
  groupStories,
  parseStoryIndex,
  parseTitleGlobs,
  readViewports,
  snapshotToBranch,
  splitRules,
  storiesToTrees,
  storyKits,
  titleGlob,
  unzip,
  viewportDisplaySettings,
  zip,
  type StorySnapshot,
} from './index';

/** Shaped like a Storybook 10 `index.json`. */
const INDEX_V5 = {
  v: 5,
  entries: {
    'configure-your-project--docs': { id: 'configure-your-project--docs', title: 'Configure your project', name: 'Docs', importPath: './Configure.mdx', type: 'docs', tags: ['dev'] },
    'example-button--primary': { id: 'example-button--primary', title: 'Example/Button', name: 'Primary', importPath: './Button.stories.ts', type: 'story', tags: ['dev', 'autodocs'], exportName: 'Primary' },
    'example-button--secondary': { id: 'example-button--secondary', title: 'Example/Button', name: 'Secondary', importPath: './Button.stories.ts', type: 'story', tags: [], exportName: 'Secondary' },
    'example-header--logged-in': { id: 'example-header--logged-in', title: 'Example/Header', name: 'Logged In', importPath: './Header.stories.ts', type: 'story', tags: [] },
    'forms-input--default': { id: 'forms-input--default', title: 'Forms/Input', name: 'Default', importPath: './Input.stories.ts', type: 'story', tags: [] },
  },
};

const snapshot = (over: Partial<StorySnapshot> = {}): StorySnapshot => ({
  id: 'example-button--primary',
  title: 'Example/Button',
  name: 'Primary',
  html: '<button type="button" class="storybook-button storybook-button--medium storybook-button--primary" style="background-color: red">Button</button>',
  sheets: [],
  args: { primary: true, label: 'Button' },
  ...over,
});

describe('Storybook catalog', () => {
  it('reads index.json v5 and leaves docs pages out', () => {
    const catalog = parseStoryIndex(JSON.stringify(INDEX_V5));
    expect(catalog.version).toBe(5);
    expect(catalog.stories.map((s) => s.id)).toEqual(['example-button--primary', 'example-button--secondary', 'example-header--logged-in', 'forms-input--default']);
    expect(catalog.stories[0]).toMatchObject({ title: 'Example/Button', name: 'Primary', tags: ['dev', 'autodocs'] });
  });

  it('reads a Storybook 6 stories.json', () => {
    const catalog = parseStoryIndex({
      v: 3,
      stories: {
        'button--primary': { id: 'button--primary', kind: 'Button', story: 'Primary', parameters: {} },
        'intro--page': { id: 'intro--page', kind: 'Intro', name: 'Page', parameters: { docsOnly: true } },
      },
    });
    expect(catalog.stories).toEqual([{ id: 'button--primary', title: 'Button', name: 'Primary', tags: [] }]);
  });

  it('rejects files that are not a story index', () => {
    expect(() => parseStoryIndex('{nope')).toThrow(/not valid JSON/);
    expect(() => parseStoryIndex({ hello: 1 })).toThrow(/not a Storybook index/);
  });

  it('filters by title globs and groups by title', () => {
    const { stories } = parseStoryIndex(INDEX_V5);
    expect(titleGlob('Example/**')('Example/Button')).toBe(true);
    expect(titleGlob('Example/**')('Example')).toBe(true);
    expect(titleGlob('Example/*')('Example/Deep/Button')).toBe(false);
    expect(titleGlob('*/Input')('Forms/Input')).toBe(true);
    expect(parseTitleGlobs(' Example/** , Forms/*  \nDesign System/Button')).toEqual(['Example/**', 'Forms/*', 'Design System/Button']);
    expect(filterStories(stories, ['forms/**']).map((s) => s.id)).toEqual(['forms-input--default']);
    expect(filterStories(stories, [])).toHaveLength(4);
    expect(groupStories(stories).map((g) => [g.title, g.stories.length])).toEqual([
      ['Example/Button', 2],
      ['Example/Header', 1],
      ['Forms/Input', 1],
    ]);
  });
});

describe('Storybook snapshots', () => {
  it('turns a story into one named branch, with inline styles and arg names', () => {
    const branch = snapshotToBranch(snapshot());
    expect(branch.tag).toBe('button');
    expect(branch.name).toBe('Button / Primary');
    expect(branch.classes).toContain('storybook-button--primary');
    expect(branch.attrs['data-story']).toBe('example-button--primary');
    expect(branch.styles.lg?.['background-color']).toBe('red');
    // The button's only content is the `label` arg.
    expect(branch.name).toBe('Button / Primary');
    const named = snapshotToBranch(snapshot({ html: '<div class="card"><h2>Title here</h2><p>Body</p></div>', args: { heading: 'Title here' } }));
    const h2 = named.children.find((c): c is Branch => isBranch(c) && c.tag === 'h2');
    expect(h2?.name).toBe('heading');
  });

  it('wraps a story that rendered several elements', () => {
    const branch = snapshotToBranch(snapshot({ html: '\n<span>A</span>\n<span>B</span>\n', args: {} }));
    expect(branch.tag).toBe('div');
    expect(branch.children).toHaveLength(2);
  });

  it('makes one tree per component with a section per story', () => {
    const items = [snapshot(), snapshot({ id: 'example-button--secondary', name: 'Secondary' }), snapshot({ id: 'forms-input--default', title: 'Forms/Input', name: 'Default', html: '<input placeholder="Name">' })].map((s) => ({
      id: s.id,
      title: s.title,
      name: s.name,
      branch: snapshotToBranch(s),
    }));
    const trees = storiesToTrees(items);
    expect(trees.map((t) => t.name)).toEqual(['Button', 'Input']);
    expect(trees[0].root.children.map((c) => (c as Branch).name)).toEqual(['Primary', 'Secondary']);
    // Trees get their own copies, with fresh ids.
    const inner = (trees[0].root.children[0] as Branch).children[0];
    expect(inner.id).not.toBe(items[0].branch.id);
  });
});

describe('Storybook styles', () => {
  const sheets = [
    { href: 'https://sb.example.com/assets/iframe-abc.css', css: '.storybook-button { font: 700 14px "Nunito Sans"; background: url(./img/bg.png); }' },
    { css: '.sb-show-main.sb-main-centered { margin: 0; } #storybook-root { padding: 1rem; }' },
    { css: '.css-1x2y { color: red; }\n@media (max-width: 600px) { .css-1x2y { color: blue; } }' },
  ];

  it('links stylesheet files and merges runtime styles, without Storybook chrome', () => {
    const kits = storyKits(
      [snapshot({ sheets }), snapshot({ id: 'b', sheets: [...sheets, { css: '.css-1x2y { color: red; }\n.css-9z { margin: 0; }' }] })],
      { name: 'My SB', styles: 'link', source: 'https://sb.example.com/' },
    );
    expect(kits).toHaveLength(2);
    expect(kits[0]).toMatchObject({ name: 'My SB: iframe-abc.css', href: 'https://sb.example.com/assets/iframe-abc.css' });
    expect(kits[0].css).toContain('url("https://sb.example.com/assets/img/bg.png")');
    expect(kits[1].name).toBe('My SB: runtime styles');
    expect(kits[1].css.match(/\.css-1x2y \{ color: red; \}/g)).toHaveLength(1);
    expect(kits[1].css).toContain('@media (max-width: 600px)');
    expect(kits[1].css).toContain('.css-9z');
    expect(kits.some((k) => k.css.includes('sb-show-main'))).toBe(false);
  });

  it('copies stylesheet files when asked', () => {
    const [file] = storyKits([snapshot({ sheets: [sheets[0]] })], { name: 'SB', styles: 'copy', source: 'x' });
    expect(file.href).toBeUndefined();
    expect(file.css).toContain('.storybook-button');
  });

  it('splits CSS into top-level rules and absolutizes urls', () => {
    expect(splitRules('/* c */ a { b: c; } @import url("x.css"); @media (x) { a { b: "}" } }')).toEqual(['a { b: c; }', '@import url("x.css");', '@media (x) { a { b: "}" } }']);
    expect(absolutizeCssUrls('a{background:url("data:image/png;base64,xx")} b{src:url(../f.woff2)}', 'https://x.com/a/b/c.css')).toBe(
      'a{background:url("data:image/png;base64,xx")} b{src:url("https://x.com/a/f.woff2")}',
    );
  });
});

describe('Storybook viewports', () => {
  it('maps viewports onto display types', () => {
    const viewports = readViewports({
      mobile1: { name: 'Small mobile', styles: { width: '320px', height: '568px' }, type: 'mobile' },
      mobile2: { name: 'Large mobile', styles: { width: '414px', height: '896px' }, type: 'mobile' },
      tablet: { name: 'Tablet', styles: { width: '834px', height: '1112px' }, type: 'tablet' },
      wide: { name: 'Wide', styles: { width: '1920px', height: '1080px' }, type: 'desktop' },
      weird: { name: 'Percent', styles: { width: '100%', height: '100%' } },
    });
    expect(viewports.map((v) => v.name)).toEqual(['Small mobile', 'Large mobile', 'Tablet', 'Wide']);
    expect(viewportDisplaySettings(viewports)).toEqual({
      'mobile-portrait': { width: 320, height: 568 },
      tablet: { width: 834, height: 1112 },
      xl: { width: 1920, height: 1080 },
    });
    expect(viewportDisplaySettings(readViewports({ l: { name: 'Phone landscape', styles: { width: 812, height: 375 } } }))).toEqual({
      'mobile-landscape': { width: 812, height: 375 },
    });
  });
});

describe('unzip', () => {
  it('reads stored and deflated entries', async () => {
    const stored = zip([
      { path: 'storybook-static/index.json', content: '{"v":5}' },
      { path: 'storybook-static/iframe.html', content: '<html></html>' },
    ]);
    const files = await unzip(stored, () => {
      throw new Error('nothing is deflated');
    });
    expect(files.map((f) => [f.path, new TextDecoder().decode(f.data)])).toEqual([
      ['storybook-static/index.json', '{"v":5}'],
      ['storybook-static/iframe.html', '<html></html>'],
    ]);

    // Turn the first entry into a deflated one.
    const body = new TextEncoder().encode('hello hello hello hello');
    const deflated = new Uint8Array(deflateRawSync(body));
    const one = zip([{ path: 'a.txt', content: deflated }]);
    const v = new DataView(one.buffer);
    v.setUint16(8, 8, true); // local: method
    v.setUint32(22, body.length, true);
    const central = 30 + 5 + deflated.length;
    v.setUint16(central + 10, 8, true);
    v.setUint32(central + 24, body.length, true);
    const [file] = await unzip(one, (d) => new Uint8Array(inflateRawSync(d)));
    expect(new TextDecoder().decode(file.data)).toBe('hello hello hello hello');
  });

  it('rejects other files', async () => {
    await expect(unzip(new Uint8Array(40), (d) => d)).rejects.toThrow(/not a zip/);
  });
});
