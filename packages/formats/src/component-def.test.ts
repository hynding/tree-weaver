import { createBranch, createComponent, createLeaf, text, type ComponentDef } from '@tree-weaver/core';
import { describe, expect, it } from 'vitest';
import { exportComponentDef } from './index';

function cardDef(): ComponentDef {
  const title = createBranch({ tag: 'h3', styles: { lg: { margin: '0' } }, children: [text('{{title}}')] });
  title.id = 'b_title';
  const badge = createBranch({ tag: 'span', attrs: { 'data-show-if': 'badge' }, children: [text('New')] });
  const link = createBranch({ tag: 'a', attrs: { href: '{{link}}', title: 'Say "hi" `${x}` \\ {{title}}' }, children: [text('Read more')] });
  const img = createLeaf('{{image}}', 'image', { alt: '{{title}}' });
  const root = createBranch({ tag: 'article', classes: ['card', 'card-{{tone}}'], styles: { lg: { display: 'flex', gap: '16px' } }, children: [img, title, badge, link] });
  root.id = 'b_root';
  return createComponent('Card', root, {
    props: [{ name: 'title', type: 'text', default: 'Card "title"' }],
    variants: [{ name: 'Stacked', styles: { b_root: { lg: { 'flex-direction': 'column' }, 'mobile-portrait': { gap: '4px' } }, b_title: { lg: { 'font-size': '14px' } } } }],
  });
}

const file = (out: { files: { path: string; contents: string }[] }, ext: string) => out.files.find((f) => f.path.endsWith(ext))!.contents;

describe('exportComponentDef', () => {
  it('writes a React component with typed props, defaults, conditions and a variant prop', () => {
    const out = exportComponentDef(cardDef(), { framework: 'react', typescript: true });
    const tsx = file(out, '.tsx');
    expect(tsx).toContain('export interface CardProps');
    expect(tsx).toContain('export type CardVariant = "stacked";');
    expect(tsx).toContain("variant?: CardVariant | '' | Partial<Record<CardDisplay, CardVariant | '-'>>;");
    expect(tsx).toContain("function variantClasses(variant: CardProps['variant']): string {");
    expect(tsx).toContain('export default function Card({ title = "Card \\"title\\"", tone = "", image = "", badge = false, link = "", variant = "" }: CardProps)');
    expect(tsx).toContain('className={`card card-${tone} card__article${variantClasses(variant)}`}');
    expect(tsx).toContain('{badge && (<span>New</span>)}');
    expect(tsx).toContain('<img src={image} alt={title} />');
    // Literal backticks, backslashes and ${ are escaped in template literals.
    expect(tsx).toContain('title={`Say "hi" \\`\\${x}\\` \\\\ ${title}`}');
    const css = file(out, '.css');
    expect(css).toContain('.card__article.card__article--lg-stacked {\n  flex-direction: column;');
    expect(css).toContain('.card__article.card__article--lg-stacked .card__h3 {\n  font-size: 14px;');
    // A phone can switch to the variant, or back to the base look, at its own breakpoint.
    const phone = css.slice(css.indexOf('@media (max-width: 600px) and (orientation: portrait)'));
    expect(phone).toContain('.card__article.card__article--tablet-base.card__article--mobile-portrait-stacked {\n    gap: 4px;\n    flex-direction: column;');
    expect(css).toContain('.card__article.card__article--tablet-stacked.card__article--mobile-portrait-base .card__h3 {\n    font-size: unset;');
  });

  it('turns a variant name or a pick per display into one modifier class per display', () => {
    const jsx = file(exportComponentDef(cardDef(), { framework: 'react' }), '.jsx');
    const fn = jsx.slice(jsx.indexOf('const VARIANT_DISPLAYS'), jsx.indexOf('export default'));
    const variantClasses = new Function(`${fn}; return variantClasses;`)() as (v: unknown) => string;
    expect(variantClasses('')).toBe('');
    expect(variantClasses('stacked').trim().split(' ')).toEqual([
      'card__article--lg-stacked',
      'card__article--xl-stacked',
      'card__article--tablet-stacked',
      'card__article--mobile-landscape-stacked',
      'card__article--mobile-portrait-stacked',
    ]);
    // Phones inherit the tablet pick; `-` goes back to the base look.
    expect(variantClasses({ tablet: 'stacked', 'mobile-portrait': '-' }).trim().split(' ')).toEqual([
      'card__article--lg-base',
      'card__article--xl-base',
      'card__article--tablet-stacked',
      'card__article--mobile-landscape-stacked',
      'card__article--mobile-portrait-base',
    ]);
  });

  it('writes Vue props, bindings and v-if, escaping quotes inside bound attributes', () => {
    const vue = file(exportComponentDef(cardDef(), { framework: 'vue' }), '.vue');
    expect(vue).toContain('title: { type: String, default: "Card \\"title\\"" },');
    expect(vue).toContain('badge: { type: Boolean, default: false },');
    expect(vue).toContain('<h3 class="card__h3">{{ title }}</h3>');
    expect(vue).toContain('<span v-if="badge">New</span>');
    expect(vue).toContain('variant: { type: [String, Object], default: "" },');
    expect(vue).toContain(':class="`card card-${tone} card__article${variantClasses(variant)}`"');
    expect(vue).toContain('<a :href="link" :title="`Say &quot;hi&quot; \\`\\${x}\\` \\\\ ${title}`">');
  });

  it('writes Svelte props and blocks, escaping braces in literal text once', () => {
    const svelte = file(exportComponentDef(cardDef(), { framework: 'svelte' }), '.svelte');
    expect(svelte).toContain('export let badge = false;');
    expect(svelte).toContain(`<article class="card card-{tone} card__article{variantClasses(variant)}">`);
    expect(svelte).toContain('  function variantClasses(variant) {');
    expect(svelte).toContain('{#if badge}<span>New</span>{/if}');
    expect(svelte).toContain('title="Say &quot;hi&quot; `$&#123;x&#125;` \\ {title}"');
    expect(svelte).toContain(':global(.card__article.card__article--lg-stacked .card__h3) {');
  });

  it('keeps props but drops variants with Tailwind', () => {
    const out = exportComponentDef(cardDef(), { framework: 'react', styling: 'tailwind' });
    const jsx = file(out, '.jsx');
    expect(jsx).toContain('className={`card card-${tone} flex gap-[16px]`}');
    expect(jsx).not.toContain('variant');
  });

  it('exports HTML and native targets as the component looks with its defaults', () => {
    const html = file(exportComponentDef(cardDef(), { framework: 'html' }), 'index.html');
    expect(html).toContain('<h3 class="card__h3">Card "title"</h3>');
    expect(html).not.toContain('{{');
    expect(html).not.toContain('New');
    const swift = exportComponentDef(cardDef(), { framework: 'swiftui' });
    expect(swift.name).toBe('Card');
    expect(file(swift, 'Card.swift')).toContain('Text("Card \\"title\\"")');
  });
});

describe('exportComponentDef escaping', () => {
  it('keeps prop defaults and descriptions from breaking out of scripts and comments', () => {
    const root = createBranch({ tag: 'div', children: [text('{{title}}')] });
    const def = createComponent('Card', root, {
      props: [
        { name: 'title', type: 'text', default: '</script><script>alert(1)</script>', description: 'x\nalert("desc")' },
        { name: 'flag', type: 'boolean', default: '0' },
      ],
    });
    const svelte = file(exportComponentDef(def, { framework: 'svelte' }), '.svelte');
    expect(svelte).not.toContain('</script><script>');
    expect(svelte).toContain('export let title = "\\u003c/script>\\u003cscript>alert(1)\\u003c/script>";');
    // '0' is off in the editor, so it is off in the export too.
    expect(svelte).toContain('export let flag = false;');
    const jsx = file(exportComponentDef(def, { framework: 'react' }), '.jsx');
    expect(jsx.split('\n')[0]).toContain('alert("desc")');
    expect(jsx).not.toMatch(/^alert/m);
  });
});
