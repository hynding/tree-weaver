import { createBranch, createForest, createKit, createLeaf, createTree, text, type Forest } from '@tree-weaver/core';
import { describe, expect, it } from 'vitest';
import { exportStorybook, slugify, zipStorybook } from './index';
import { crc32 } from './zip';

function sampleForest(): Forest {
  const card = (title: string) =>
    createBranch({
      tag: 'article',
      name: 'Card',
      classes: ['card'],
      styles: { lg: { padding: '1rem' }, 'mobile-portrait': { padding: '0.5rem' } },
      children: [createBranch({ tag: 'h2', children: [text(title)] }), createLeaf('https://example.com/cat.png', 'image', { alt: 'Cat' })],
    });
  const hero = createBranch({ tag: 'section', name: 'Hero banner', children: [createBranch({ tag: 'h1', children: [text('Hello </script> "world"')] })] });
  const grid = createBranch({ tag: 'div', type: 'grid', styles: { lg: { display: 'grid' } }, children: [card('One'), card('Two')] });
  const home = createTree('Home / Landing', createBranch({ tag: 'body', children: [hero, grid] }));
  const about = createTree('About', createBranch({ tag: 'body', children: [text('About us')] }));
  const forest = createForest('My Site', [home, about]);
  forest.kits = [createKit('Brand Kit', '.card { border: 1px solid; }'), { ...createKit('Off', '.x{}'), enabled: false }];
  return forest;
}

const file = (files: { path: string; content: string }[], path: string) => files.find((f) => f.path === path)?.content ?? '';

describe('Storybook export', () => {
  it('writes a runnable project with one stories file per tree', () => {
    const { name, files } = exportStorybook(sampleForest());
    expect(name).toBe('my-site-storybook');
    const paths = files.map((f) => f.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        'package.json',
        '.storybook/main.js',
        '.storybook/preview.js',
        '.storybook/tree-weaver.js',
        'styles/base.css',
        'styles/kits/brand-kit.css',
        'stories/home-landing.stories.js',
        'stories/home-landing.css',
        'stories/about.stories.js',
      ]),
    );
    expect(paths.some((p) => p.includes('off'))).toBe(false);
    const pkg = JSON.parse(file(files, 'package.json'));
    expect(pkg.devDependencies).toHaveProperty('@storybook/html-vite');
    expect(file(files, '.storybook/preview.js')).toContain("import '../styles/kits/brand-kit.css';");
  });

  it('maps display types to viewports and adds a story per display', () => {
    const { files } = exportStorybook(sampleForest());
    const preview = file(files, '.storybook/preview.js');
    expect(preview).toContain('"mobile-portrait"');
    expect(preview).toContain('"width": "390px"');
    const stories = file(files, 'stories/home-landing.stories.js');
    expect(stories).toContain('export const WholeTree = {');
    expect(stories).toContain('export const WholeTreeMobilePortrait = {');
    expect(stories).toContain('globals: { viewport: { value: "tablet", isRotated: false } }');
  });

  it('adds a story per named branch with unique export names, and leaves as args', () => {
    const { files } = exportStorybook(sampleForest());
    const stories = file(files, 'stories/home-landing.stories.js');
    expect(stories).toContain('title: "My Site/Home - Landing"');
    expect(stories).toContain('export const HeroBanner = {');
    expect(stories).toContain('export const Card = {');
    expect(stories).toContain('export const Card2 = {');
    expect(stories).toContain('name: "Card 2"');
    expect(stories).toContain('"h1Text": "Hello </script> \\"world\\""');
    expect(stories).toContain('"cardImage": "https://example.com/cat.png"');
    expect(stories).toContain('data-tw-leaf=');
    expect(file(files, 'stories/home-landing.css')).toContain('display: grid;');
  });

  it('exports only the chosen trees', () => {
    const forest = sampleForest();
    const { files } = exportStorybook(forest, { treeIds: [forest.trees[1].id] });
    expect(files.some((f) => f.path === 'stories/about.stories.js')).toBe(true);
    expect(files.some((f) => f.path.startsWith('stories/home'))).toBe(false);
  });

  it('zips the project into its folder', () => {
    const project = exportStorybook(sampleForest());
    const bytes = zipStorybook(project, new Date(2026, 0, 2, 3, 4, 6));
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    const end = bytes.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(project.files.length);
    const nameLength = view.getUint16(26, true);
    expect(new TextDecoder().decode(bytes.slice(30, 30 + nameLength))).toBe('my-site-storybook/package.json');
  });

  it('computes standard CRC-32 and slugs', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(slugify('Home Page!', 'tree')).toBe('home-page');
    expect(slugify('***', 'tree')).toBe('tree');
  });
});
