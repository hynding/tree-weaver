import {
  createBranch,
  createComponent,
  createForest,
  createShape,
  createKit,
  renderTokensCss,
  createTree,
  instantiateComponent,
  SVG_NAMESPACE,
  text,
  type Branch,
  type BranchInit,
  type ComponentDef,
  type ComponentInstance,
  type DesignToken,
  type DisplayStyles,
  type Forest,
  type Tree,
  type TreeNode,
} from '@tree-weaver/core';

/**
 * The template gallery: whole starter forests, each with its own design tokens (a token kit),
 * reusable components with per-display variants, and a few trees built from both. Everything
 * is styled with `var(--token)` references, so changing a token in the Tokens tab restyles the
 * whole forest, and every exporter carries the tokens along.
 */

export interface StarterForest {
  id: string;
  label: string;
  description: string;
  /** What the forest holds, for the gallery card. */
  trees: string[];
  components: string[];
  /** The forest's main colors, for a gallery swatch: brand, background, surface, text. */
  swatch: [string, string, string, string];
  create(name?: string): Forest;
}

/* --------------------------------------------------------------- helpers */

const v = (token: string) => `var(--${token})`;
type Extra = Omit<BranchInit, 'tag' | 'styles' | 'children'>;
/** A branch: tag, styles per display, children, and anything else. */
const el = (tag: string, styles: DisplayStyles = {}, children: TreeNode[] = [], extra: Extra = {}): Branch => createBranch({ tag, styles, children, ...extra });
/** A text-only branch. */
const txt = (tag: string, value: string, styles: DisplayStyles = {}, extra: Extra = {}): Branch => el(tag, styles, [text(value)], extra);
/** A template branch with a fixed id, so variants can refer to it. */
const named = (id: string, branch: Branch): Branch => ((branch.id = id), branch);
const use = (def: ComponentDef, props: Record<string, string> = {}, variants?: ComponentInstance['variants']): Branch => instantiateComponent(def, props, variants);

interface Theme {
  brand: string;
  brandContrast: string;
  brandSoft: string;
  bg: string;
  surface: string;
  text: string;
  muted: string;
  border: string;
  success: string;
  heading: string;
  body: string;
}

const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif';
const SERIF = 'Georgia, "Iowan Old Style", "Times New Roman", serif';

/**
 * The theme kit every starter uses; only the colors and fonts differ between themes. It is a
 * plain design kit holding `:root` tokens, so edits in the Tokens tab go to the forest's token
 * kit on top and can be reset back to the theme.
 */
function tokenKit(name: string, th: Theme) {
  const tokens: DesignToken[] = [
    { name: '--color-brand', value: th.brand, kind: 'color', description: 'Buttons, links and highlights' },
    { name: '--color-brand-contrast', value: th.brandContrast, kind: 'color', description: 'Text on the brand color' },
    { name: '--color-brand-soft', value: th.brandSoft, kind: 'color', description: 'Tinted backgrounds' },
    { name: '--color-bg', value: th.bg, kind: 'color', description: 'Page background' },
    { name: '--color-surface', value: th.surface, kind: 'color', description: 'Cards and panels' },
    { name: '--color-text', value: th.text, kind: 'color' },
    { name: '--color-muted', value: th.muted, kind: 'color', description: 'Secondary text' },
    { name: '--color-border', value: th.border, kind: 'color' },
    { name: '--color-success', value: th.success, kind: 'color' },
    { name: '--space-1', value: '0.25rem', kind: 'space' },
    { name: '--space-2', value: '0.5rem', kind: 'space' },
    { name: '--space-3', value: '0.75rem', kind: 'space' },
    { name: '--space-4', value: '1rem', kind: 'space' },
    { name: '--space-5', value: '1.5rem', kind: 'space' },
    { name: '--space-6', value: '2rem', kind: 'space' },
    { name: '--space-7', value: '3rem', kind: 'space' },
    { name: '--space-8', value: '5rem', kind: 'space' },
    { name: '--radius-sm', value: '6px', kind: 'radius' },
    { name: '--radius-md', value: '10px', kind: 'radius' },
    { name: '--radius-lg', value: '16px', kind: 'radius' },
    { name: '--radius-full', value: '999px', kind: 'radius' },
    { name: '--font-body', value: th.body, kind: 'font-family' },
    { name: '--font-heading', value: th.heading, kind: 'font-family' },
    { name: '--text-sm', value: '0.875rem', kind: 'font-size' },
    { name: '--text-base', value: '1rem', kind: 'font-size' },
    { name: '--text-lg', value: '1.125rem', kind: 'font-size' },
    { name: '--text-xl', value: '1.375rem', kind: 'font-size' },
    { name: '--text-2xl', value: '1.75rem', kind: 'font-size' },
    { name: '--text-3xl', value: '2.25rem', kind: 'font-size' },
    { name: '--text-4xl', value: '3.25rem', kind: 'font-size' },
    { name: '--weight-medium', value: '500', kind: 'font-weight' },
    { name: '--weight-bold', value: '700', kind: 'font-weight' },
    { name: '--leading-tight', value: '1.15', kind: 'line-height' },
    { name: '--leading-body', value: '1.6', kind: 'line-height' },
    { name: '--shadow-card', value: '0 1px 2px rgb(16 24 40 / 6%), 0 4px 12px rgb(16 24 40 / 6%)', kind: 'shadow' },
    { name: '--shadow-raised', value: '0 12px 32px rgb(16 24 40 / 14%)', kind: 'shadow' },
  ];
  return createKit(`${name} theme`, `/* ${name} theme: design tokens for this starter forest. */\n${renderTokensCss(tokens)}`, 'builtin');
}

/** A tree whose body uses the theme's background, text color and font. */
function page(name: string, children: TreeNode[], bodyStyles: DisplayStyles = {}): Tree {
  const tree = createTree(name);
  tree.root.styles = {
    ...bodyStyles,
    lg: { margin: '0', background: v('color-bg'), color: v('color-text'), 'font-family': v('font-body'), 'line-height': v('leading-body'), ...bodyStyles.lg },
  };
  tree.root.children = children;
  return tree;
}

const heading = (level: 1 | 2 | 3, value: string, styles: DisplayStyles = {}) =>
  txt(`h${level}`, value, {
    ...styles,
    lg: {
      margin: '0',
      'font-family': v('font-heading'),
      'line-height': v('leading-tight'),
      'font-size': v(level === 1 ? 'text-3xl' : level === 2 ? 'text-xl' : 'text-lg'),
      ...styles.lg,
    },
  });
const muted = (value: string, styles: DisplayStyles = {}) => txt('p', value, { ...styles, lg: { margin: '0', color: v('color-muted'), ...styles.lg } });
const container = (children: TreeNode[], styles: DisplayStyles = {}, extra: Extra & { tag?: string } = {}) => {
  const { tag = 'div', ...rest } = extra;
  return el(tag, { ...styles, lg: { width: 'min(100% - 2rem, 1120px)', 'margin-inline': 'auto', ...styles.lg } }, children, { name: 'Container', ...rest });
};
const card = (children: TreeNode[], name: string, styles: DisplayStyles = {}, tag = 'section') =>
  el(
    tag,
    {
      ...styles,
      lg: {
        display: 'flex',
        'flex-direction': 'column',
        gap: v('space-4'),
        padding: v('space-5'),
        background: v('color-surface'),
        border: `1px solid ${v('color-border')}`,
        'border-radius': v('radius-lg'),
        'box-shadow': v('shadow-card'),
        'min-width': '0',
        ...styles.lg,
      },
    },
    children,
    { name },
  );
/** A responsive grid: `lg` columns on desktops, `tablet` on tablets, one on portrait phones. */
const grid = (lg: number, tablet: number, children: TreeNode[], name = 'Grid', gap = 'space-5') =>
  el(
    'div',
    {
      lg: { display: 'grid', 'grid-template-columns': `repeat(${lg}, minmax(0, 1fr))`, gap: v(gap) },
      tablet: { 'grid-template-columns': `repeat(${tablet}, minmax(0, 1fr))` },
      'mobile-portrait': { 'grid-template-columns': 'minmax(0, 1fr)' },
    },
    children,
    { type: 'grid', name },
  );
/** A real `<button>` styled like the Button component (forms submit with these). */
const submitButton = (label: string, styles: DisplayStyles = {}) =>
  txt(
    'button',
    label,
    {
      ...styles,
      lg: {
        padding: `${v('space-3')} ${v('space-5')}`,
        border: '0',
        'border-radius': v('radius-md'),
        background: v('color-brand'),
        color: v('color-brand-contrast'),
        font: 'inherit',
        'font-weight': v('weight-bold'),
        cursor: 'pointer',
        ...styles.lg,
      },
    },
    { attrs: { type: 'submit' } },
  );

/* ------------------------------------------------------------ components */

function buttonComponent(): ComponentDef {
  const root = named(
    'b_button',
    txt(
      'a',
      '{{label}}',
      {
        lg: {
          display: 'inline-flex',
          'align-items': 'center',
          'justify-content': 'center',
          padding: `${v('space-3')} ${v('space-5')}`,
          'border-radius': v('radius-md'),
          border: `1px solid ${v('color-brand')}`,
          background: v('color-brand'),
          color: v('color-brand-contrast'),
          'font-weight': v('weight-bold'),
          'text-decoration': 'none',
          'white-space': 'nowrap',
        },
      },
      { name: 'Button', attrs: { href: '{{href}}' } },
    ),
  );
  return createComponent('Button', root, {
    description: 'A link styled as a button',
    props: [
      { name: 'label', type: 'text', default: 'Get started' },
      { name: 'href', type: 'url', default: '#' },
    ],
    variants: [
      { name: 'Ghost', styles: { b_button: { lg: { background: 'transparent', color: v('color-brand') } } } },
      { name: 'Inverse', styles: { b_button: { lg: { background: v('color-brand-contrast'), color: v('color-brand'), 'border-color': v('color-brand-contrast') } } } },
      { name: 'Block', styles: { b_button: { lg: { display: 'flex', width: '100%' } } } },
    ],
  });
}

function statComponent(): ComponentDef {
  const root = named(
    'b_stat',
    card(
      [
        named('b_stat_label', txt('p', '{{label}}', { lg: { margin: '0', color: v('color-muted'), 'font-size': v('text-sm'), 'font-weight': v('weight-medium') } })),
        named('b_stat_value', txt('p', '{{value}}', { lg: { margin: '0', 'font-family': v('font-heading'), 'font-size': v('text-2xl'), 'font-weight': v('weight-bold'), 'line-height': v('leading-tight') } })),
        txt('p', '{{delta}}', { lg: { margin: '0', color: v('color-success'), 'font-size': v('text-sm'), 'font-weight': v('weight-medium') } }, { attrs: { 'data-show-if': 'delta' } }),
      ],
      'Stat tile',
      { lg: { gap: v('space-1') } },
      'div',
    ),
  );
  return createComponent('Stat tile', root, {
    description: 'A number with a label and an optional change',
    props: [
      { name: 'label', type: 'text', default: 'Visitors' },
      { name: 'value', type: 'text', default: '12,480' },
      { name: 'delta', type: 'text', default: '', description: 'Shown when set' },
    ],
    variants: [
      {
        name: 'Compact',
        styles: {
          b_stat: { lg: { 'flex-direction': 'row', 'flex-wrap': 'wrap', 'align-items': 'baseline', 'column-gap': v('space-3'), padding: v('space-4') } },
          b_stat_label: { lg: { flex: '1 1 100%' } },
          b_stat_value: { lg: { 'font-size': v('text-xl') } },
        },
      },
    ],
  });
}

function fieldComponent(): ComponentDef {
  const root = named(
    'b_field',
    el(
      'div',
      { lg: { display: 'grid', gap: v('space-2') } },
      [
        named('b_field_label', txt('label', '{{label}}', { lg: { 'font-size': v('text-sm'), 'font-weight': v('weight-medium') } }, { attrs: { for: '{{name}}' } })),
        named(
          'b_field_input',
          el(
            'input',
            {
              lg: {
                width: '100%',
                padding: `${v('space-3')} ${v('space-4')}`,
                border: `1px solid ${v('color-border')}`,
                'border-radius': v('radius-md'),
                background: v('color-surface'),
                color: v('color-text'),
                font: 'inherit',
              },
            },
            [],
            { attrs: { id: '{{name}}', name: '{{name}}', type: '{{type}}', placeholder: '{{placeholder}}' } },
          ),
        ),
        named('b_field_hint', txt('p', '{{hint}}', { lg: { margin: '0', color: v('color-muted'), 'font-size': v('text-sm') } }, { attrs: { 'data-show-if': 'hint' } })),
      ],
      { name: 'Form field' },
    ),
  );
  return createComponent('Form field', root, {
    description: 'A labelled input with an optional hint',
    props: [
      { name: 'label', type: 'text', default: 'Email' },
      { name: 'name', type: 'text', default: 'email', description: 'Field name and id' },
      { name: 'type', type: 'enum', default: 'text', options: ['text', 'email', 'password', 'tel', 'url', 'number'] },
      { name: 'placeholder', type: 'text', default: '' },
      { name: 'hint', type: 'text', default: '', description: 'Shown under the input when set' },
    ],
    variants: [
      {
        name: 'Inline',
        styles: {
          b_field: { lg: { 'grid-template-columns': '170px minmax(0, 1fr)', 'align-items': 'center', 'column-gap': v('space-4') } },
          b_field_hint: { lg: { 'grid-column': '2' } },
        },
      },
    ],
  });
}

function featureComponent(): ComponentDef {
  const root = named(
    'b_feature',
    card(
      [
        named(
          'b_feature_icon',
          txt('span', '{{icon}}', {
            lg: {
              display: 'inline-grid',
              'place-items': 'center',
              width: '44px',
              height: '44px',
              flex: 'none',
              'border-radius': v('radius-md'),
              background: v('color-brand-soft'),
              color: v('color-brand'),
              'font-size': v('text-xl'),
            },
          }, { attrs: { 'aria-hidden': 'true' } }),
        ),
        el('div', { lg: { display: 'flex', 'flex-direction': 'column', gap: v('space-1') } }, [heading(3, '{{title}}'), muted('{{body}}')]),
      ],
      'Feature card',
      { lg: { gap: v('space-3'), padding: v('space-6'), 'box-shadow': 'none' } },
      'article',
    ),
  );
  return createComponent('Feature card', root, {
    description: 'An icon, a title and a sentence',
    props: [
      { name: 'icon', type: 'text', default: '★' },
      { name: 'title', type: 'text', default: 'Feature' },
      { name: 'body', type: 'text', default: 'One sentence about why it matters.' },
    ],
    variants: [{ name: 'Row', styles: { b_feature: { lg: { 'flex-direction': 'row', 'align-items': 'flex-start', gap: v('space-4'), padding: v('space-4') } } } }],
  });
}

function pricingComponent(): ComponentDef {
  const li = (prop: string) => txt('li', `{{${prop}}}`);
  const root = named(
    'b_price',
    card(
      [
        txt(
          'span',
          'Most popular',
          {
            lg: {
              'align-self': 'flex-start',
              padding: `${v('space-1')} ${v('space-3')}`,
              'border-radius': v('radius-full'),
              background: v('color-brand-soft'),
              color: v('color-brand'),
              'font-size': v('text-sm'),
              'font-weight': v('weight-bold'),
            },
          },
          { attrs: { 'data-show-if': 'featured' } },
        ),
        heading(3, '{{plan}}'),
        el('p', { lg: { margin: '0', display: 'flex', 'align-items': 'baseline', gap: v('space-2') } }, [
          txt('span', '{{price}}', { lg: { 'font-family': v('font-heading'), 'font-size': v('text-3xl'), 'font-weight': v('weight-bold'), 'line-height': '1' } }),
          txt('span', '{{period}}', { lg: { color: v('color-muted') } }),
        ]),
        muted('{{summary}}'),
        el('ul', { lg: { margin: '0', 'padding-left': v('space-5'), display: 'flex', 'flex-direction': 'column', gap: v('space-2') } }, [li('feature1'), li('feature2'), li('feature3')]),
        named(
          'b_price_cta',
          txt(
            'a',
            '{{cta}}',
            {
              lg: {
                'margin-top': 'auto',
                padding: `${v('space-3')} ${v('space-5')}`,
                'text-align': 'center',
                'border-radius': v('radius-md'),
                border: `1px solid ${v('color-brand')}`,
                color: v('color-brand'),
                'font-weight': v('weight-bold'),
                'text-decoration': 'none',
              },
            },
            { attrs: { href: '{{href}}' } },
          ),
        ),
      ],
      'Pricing card',
      { lg: { padding: v('space-6'), 'box-shadow': 'none' } },
      'article',
    ),
  );
  return createComponent('Pricing card', root, {
    description: 'A plan with its price, features and a call to action',
    props: [
      { name: 'plan', type: 'text', default: 'Team' },
      { name: 'price', type: 'text', default: '$29' },
      { name: 'period', type: 'text', default: 'per month' },
      { name: 'summary', type: 'text', default: 'For growing teams.' },
      { name: 'feature1', type: 'text', default: 'Unlimited projects' },
      { name: 'feature2', type: 'text', default: 'Shared boards' },
      { name: 'feature3', type: 'text', default: 'Email support' },
      { name: 'cta', type: 'text', default: 'Choose plan' },
      { name: 'href', type: 'url', default: '#' },
      { name: 'featured', type: 'boolean', default: '', description: 'Shows the "Most popular" badge' },
    ],
    variants: [
      {
        name: 'Featured',
        styles: {
          b_price: { lg: { 'border-color': v('color-brand'), 'box-shadow': v('shadow-raised') } },
          b_price_cta: { lg: { background: v('color-brand'), color: v('color-brand-contrast') } },
        },
      },
    ],
  });
}

/* --------------------------------------------------------------- dashboard */

const DASHBOARD_THEME: Theme = {
  brand: '#4f46e5',
  brandContrast: '#ffffff',
  brandSoft: '#eef2ff',
  bg: '#f5f7fb',
  surface: '#ffffff',
  text: '#111827',
  muted: '#4b5563',
  border: '#e5e7eb',
  success: '#047857',
  heading: SANS,
  body: SANS,
};

function dashboardShell(active: number, main: TreeNode[]): Branch {
  const links = ['Overview', 'Reports', 'Customers', 'Settings'].map((label, i) =>
    txt(
      'a',
      label,
      {
        lg: {
          padding: `${v('space-2')} ${v('space-3')}`,
          'border-radius': v('radius-sm'),
          color: i === active ? v('color-brand') : v('color-muted'),
          background: i === active ? v('color-brand-soft') : 'transparent',
          'font-weight': v('weight-medium'),
          'text-decoration': 'none',
          'white-space': 'nowrap',
        },
      },
      { attrs: i === active ? { href: '#', 'aria-current': 'page' } : { href: '#' } },
    ),
  );
  return el(
    'div',
    {
      lg: { display: 'grid', 'grid-template-columns': '248px minmax(0, 1fr)', 'min-height': '100vh' },
      tablet: { 'grid-template-columns': 'minmax(0, 1fr)', 'grid-template-rows': 'auto 1fr' },
    },
    [
      el(
        'aside',
        {
          lg: { display: 'flex', 'flex-direction': 'column', gap: v('space-6'), padding: v('space-6'), background: v('color-surface'), 'border-right': `1px solid ${v('color-border')}` },
          tablet: { 'flex-direction': 'row', 'align-items': 'center', gap: v('space-5'), padding: `${v('space-3')} ${v('space-5')}`, 'border-right': '0', 'border-bottom': `1px solid ${v('color-border')}` },
          'mobile-portrait': { padding: `${v('space-3')} ${v('space-4')}`, gap: v('space-3') },
        },
        [
          txt('p', 'Lumen', { lg: { margin: '0', 'font-family': v('font-heading'), 'font-size': v('text-xl'), 'font-weight': v('weight-bold'), color: v('color-brand') } }),
          el(
            'nav',
            { lg: { display: 'flex', 'flex-direction': 'column', gap: v('space-1') }, tablet: { 'flex-direction': 'row', 'overflow-x': 'auto', 'min-width': '0' } },
            links,
            { name: 'Navigation', attrs: { 'aria-label': 'Main' } },
          ),
        ],
        { name: 'Sidebar' },
      ),
      el(
        'main',
        {
          lg: { display: 'flex', 'flex-direction': 'column', gap: v('space-6'), padding: v('space-6'), 'min-width': '0' },
          tablet: { padding: v('space-5') },
          'mobile-portrait': { padding: v('space-4'), gap: v('space-5') },
        },
        main,
        { name: 'Main' },
      ),
    ],
    { type: 'grid', name: 'App shell' },
  );
}

function pageHeader(title: string, intro: string, actions: TreeNode[]): Branch {
  return el(
    'header',
    { lg: { display: 'flex', 'justify-content': 'space-between', 'align-items': 'flex-end', gap: v('space-4'), 'flex-wrap': 'wrap' } },
    [el('div', { lg: { display: 'flex', 'flex-direction': 'column', gap: v('space-1') } }, [heading(1, title, { lg: { 'font-size': v('text-2xl') } }), muted(intro)]), el('div', { lg: { display: 'flex', gap: v('space-3'), 'flex-wrap': 'wrap' } }, actions)],
    { name: 'Page header' },
  );
}

function barChart(values: number[]): Branch {
  const w = 560;
  const h = 200;
  const gap = 14;
  const bar = (w - gap * (values.length + 1)) / values.length;
  const max = Math.max(...values);
  const shapes = values.map((n, i) => {
    const bh = Math.round((n / max) * (h - 20));
    return createShape('rect', { x: String(Math.round(gap + i * (bar + gap))), y: String(h - bh), width: String(Math.round(bar)), height: String(bh), rx: '6', fill: 'currentColor', opacity: i === values.length - 1 ? '1' : '0.55' });
  });
  return el('svg', { lg: { display: 'block', width: '100%', height: 'auto', color: v('color-brand') } }, [createShape('line', { x1: '0', y1: String(h), x2: String(w), y2: String(h), stroke: '#d1d5db' }), ...shapes], {
    type: 'svg',
    name: 'Bar chart',
    attrs: { xmlns: SVG_NAMESPACE, viewBox: `0 0 ${w} ${h}`, role: 'img', 'aria-label': 'Visitors per week, rising over the last eight weeks' },
  });
}

function dataTable(head: string[], rows: string[][]): Branch {
  const cell = (tag: 'th' | 'td', value: string) =>
    txt(tag, value, {
      lg: {
        padding: `${v('space-3')} ${v('space-4')}`,
        'border-bottom': `1px solid ${v('color-border')}`,
        'text-align': 'left',
        'white-space': 'nowrap',
        ...(tag === 'th' ? { color: v('color-muted'), 'font-size': v('text-sm'), 'font-weight': v('weight-medium') } : {}),
      },
    });
  const table = el('table', { lg: { width: '100%', 'border-collapse': 'collapse' } }, [
    el('thead', {}, [el('tr', {}, head.map((h) => cell('th', h)))]),
    el('tbody', {}, rows.map((r) => el('tr', {}, r.map((c) => cell('td', c))))),
  ], { type: 'table', name: 'Table' });
  // Wide tables scroll inside their own box instead of pushing the page sideways on phones.
  return el('div', { lg: { 'overflow-x': 'auto' } }, [table], { name: 'Table scroller' });
}

function createDashboard(name = 'Analytics dashboard'): Forest {
  const button = buttonComponent();
  const stat = statComponent();
  const field = fieldComponent();
  const compactOnPhones = { 'mobile-portrait': 'Compact' };

  const topPages = el(
    'ol',
    { lg: { margin: '0', padding: '0', 'list-style': 'none', display: 'flex', 'flex-direction': 'column', gap: v('space-3') } },
    [
      ['/pricing', '8,120'],
      ['/blog/launch', '6,045'],
      ['/docs/start', '4,388'],
      ['/features', '3,910'],
      ['/changelog', '2,264'],
    ].map(([path, views]) =>
      el('li', { lg: { display: 'flex', 'justify-content': 'space-between', gap: v('space-4') } }, [txt('span', path, { lg: { 'font-weight': v('weight-medium') } }), txt('span', views, { lg: { color: v('color-muted') } })]),
    ),
  );

  const overview = page('Overview', [
    dashboardShell(0, [
      pageHeader('Overview', 'Traffic and revenue for the last 30 days', [use(button, { label: 'Export' }, { lg: 'Ghost' }), use(button, { label: 'New report' })]),
      grid(
        4,
        2,
        [
          use(stat, { label: 'Visitors', value: '48,210', delta: '+12% vs last month' }, compactOnPhones),
          use(stat, { label: 'Sign-ups', value: '1,284', delta: '+4.1% vs last month' }, compactOnPhones),
          use(stat, { label: 'Revenue', value: '$32,400', delta: '+8.6% vs last month' }, compactOnPhones),
          use(stat, { label: 'Churn', value: '2.1%' }, compactOnPhones),
        ],
        'Stats',
        'space-4',
      ),
      el(
        'div',
        { lg: { display: 'grid', 'grid-template-columns': 'minmax(0, 2fr) minmax(0, 1fr)', gap: v('space-4') }, tablet: { 'grid-template-columns': 'minmax(0, 1fr)' } },
        [card([heading(2, 'Visitors per week'), barChart([32, 41, 38, 47, 52, 49, 61, 68])], 'Chart'), card([heading(2, 'Top pages'), topPages], 'Top pages')],
        { type: 'grid', name: 'Charts' },
      ),
      card(
        [
          heading(2, 'Recent sign-ups'),
          dataTable(
            ['Name', 'Plan', 'Signed up', 'Status'],
            [
              ['Ada Moreno', 'Team', 'Today', 'Active'],
              ['Kenji Ito', 'Starter', 'Yesterday', 'Trial'],
              ['Priya Nair', 'Business', 'Mar 3', 'Active'],
              ['Sam Okafor', 'Team', 'Mar 2', 'Active'],
            ],
          ),
        ],
        'Recent sign-ups',
      ),
    ]),
  ]);

  const inline = { lg: 'Inline', tablet: '-' };
  const checkbox = (label: string, checked: boolean) =>
    el('label', { lg: { display: 'flex', 'align-items': 'center', gap: v('space-3') } }, [el('input', {}, [], { attrs: checked ? { type: 'checkbox', checked: '' } : { type: 'checkbox' } }), txt('span', label)]);
  const settings = page('Settings', [
    dashboardShell(3, [
      pageHeader('Settings', 'Your profile and how we keep in touch', []),
      card(
        [
          heading(2, 'Profile'),
          el(
            'form',
            { lg: { display: 'flex', 'flex-direction': 'column', gap: v('space-4') } },
            [
              use(field, { label: 'Full name', name: 'name', placeholder: 'Ada Moreno' }, inline),
              use(field, { label: 'Email', name: 'email', type: 'email', placeholder: 'ada@example.com' }, inline),
              use(field, { label: 'Company', name: 'company', placeholder: 'Lumen Inc.' }, inline),
              use(field, { label: 'Role', name: 'role', placeholder: 'Product manager', hint: 'Shown to people you invite' }, inline),
              submitButton('Save changes', { lg: { 'align-self': 'flex-end' }, 'mobile-portrait': { 'align-self': 'stretch' } }),
            ],
            { name: 'Profile form', attrs: { action: '#' } },
          ),
        ],
        'Profile',
        { lg: { 'max-width': '760px' } },
      ),
      card([heading(2, 'Notifications'), checkbox('Weekly summary email', true), checkbox('Alert me when sign-ups drop', true), checkbox('Product news', false)], 'Notifications', { lg: { 'max-width': '760px' } }),
    ]),
  ]);

  const forest = createForest(name, [overview, settings]);
  forest.kits = [tokenKit('Lumen', DASHBOARD_THEME)];
  forest.components = [button, stat, field];
  return forest;
}

/* ----------------------------------------------------------------- landing */

const LANDING_THEME: Theme = {
  brand: '#c2410c',
  brandContrast: '#ffffff',
  brandSoft: '#ffedd5',
  bg: '#fffaf5',
  surface: '#ffffff',
  text: '#1c1917',
  muted: '#57534e',
  border: '#e7e5e4',
  success: '#15803d',
  heading: SERIF,
  body: SANS,
};

function siteHeader(button: ComponentDef): Branch {
  const link = (label: string) => txt('a', label, { lg: { color: v('color-text'), 'text-decoration': 'none', 'font-weight': v('weight-medium') } }, { attrs: { href: '#' } });
  return el(
    'header',
    { lg: { background: v('color-surface'), 'border-bottom': `1px solid ${v('color-border')}` } },
    [
      container(
        [
          txt('a', 'Fernwood', { lg: { 'font-family': v('font-heading'), 'font-size': v('text-xl'), 'font-weight': v('weight-bold'), color: v('color-text'), 'text-decoration': 'none' } }, { attrs: { href: '#' } }),
          el('nav', { lg: { display: 'flex', gap: v('space-5') }, 'mobile-portrait': { display: 'none' } }, ['Product', 'Pricing', 'Customers', 'Docs'].map(link), { attrs: { 'aria-label': 'Main' } }),
          use(button, { label: 'Start free' }),
        ],
        { lg: { display: 'flex', 'justify-content': 'space-between', 'align-items': 'center', gap: v('space-4'), 'padding-block': v('space-4') } },
        { name: 'Navigation bar' },
      ),
    ],
    { name: 'Header' },
  );
}

function siteFooter(): Branch {
  return el(
    'footer',
    { lg: { 'border-top': `1px solid ${v('color-border')}`, color: v('color-muted'), 'font-size': v('text-sm') } },
    [
      container(
        [txt('p', '© Fernwood. Planned with care.', { lg: { margin: '0' } }), el('div', { lg: { display: 'flex', gap: v('space-5') } }, ['Privacy', 'Terms', 'Contact'].map((l) => txt('a', l, { lg: { color: 'inherit' } }, { attrs: { href: '#' } })))],
        { lg: { display: 'flex', 'justify-content': 'space-between', gap: v('space-4'), 'padding-block': v('space-6'), 'flex-wrap': 'wrap' }, 'mobile-portrait': { 'flex-direction': 'column' } },
      ),
    ],
    { name: 'Footer' },
  );
}

const section = (children: TreeNode[], name: string, styles: DisplayStyles = {}) =>
  el('section', { ...styles, lg: { 'padding-block': v('space-8'), ...styles.lg }, tablet: { 'padding-block': v('space-7'), ...styles.tablet } }, [container(children, { lg: { display: 'flex', 'flex-direction': 'column', gap: v('space-6') } })], { name });

const sectionIntro = (title: string, intro: string) =>
  el('div', { lg: { display: 'flex', 'flex-direction': 'column', gap: v('space-3'), 'text-align': 'center', 'max-width': '640px', 'margin-inline': 'auto' } }, [heading(2, title, { lg: { 'font-size': v('text-3xl') }, 'mobile-portrait': { 'font-size': v('text-2xl') } }), muted(intro, { lg: { 'font-size': v('text-lg') } })]);

function pricingGrid(pricing: ComponentDef): Branch {
  return el(
    'div',
    {
      lg: { display: 'grid', 'grid-template-columns': 'repeat(3, minmax(0, 1fr))', gap: v('space-5'), 'align-items': 'stretch' },
      tablet: { 'grid-template-columns': 'minmax(0, 1fr)', 'max-width': '480px', width: '100%', 'margin-inline': 'auto' },
    },
    [
      use(pricing, { plan: 'Starter', price: '$0', period: 'free forever', summary: 'For you and a side project.', feature1: '3 projects', feature2: 'Personal boards', feature3: 'Community help', cta: 'Start free' }),
      use(pricing, { plan: 'Team', price: '$12', period: 'per person / month', summary: 'For teams that plan together.', feature1: 'Unlimited projects', feature2: 'Shared roadmaps', feature3: 'Email support', cta: 'Start a trial', featured: 'true' }, { lg: 'Featured' }),
      use(pricing, { plan: 'Business', price: '$24', period: 'per person / month', summary: 'For companies with many teams.', feature1: 'Everything in Team', feature2: 'SSO and audit log', feature3: 'Priority support', cta: 'Talk to sales' }),
    ],
    { type: 'grid', name: 'Pricing cards' },
  );
}

function productMock(): Branch {
  const bar = (width: string, strong = false) => el('div', { lg: { height: '12px', width, 'border-radius': v('radius-full'), background: strong ? v('color-brand') : v('color-brand-soft') } });
  const row = (a: string, b: string, strong = false) =>
    el('div', { lg: { display: 'flex', 'align-items': 'center', gap: v('space-3'), padding: v('space-3'), 'border-radius': v('radius-md'), border: `1px solid ${v('color-border')}` } }, [
      el('div', { lg: { width: '20px', height: '20px', flex: 'none', 'border-radius': v('radius-sm'), border: `2px solid ${v('color-brand')}`, background: strong ? v('color-brand') : 'transparent' } }),
      el('div', { lg: { display: 'flex', 'flex-direction': 'column', gap: v('space-2'), flex: '1' } }, [bar(a, strong), bar(b)]),
    ]);
  return card([el('div', { lg: { display: 'flex', gap: v('space-2') } }, [bar('64px', true), bar('40px'), bar('40px')]), row('70%', '45%', true), row('55%', '35%'), row('80%', '50%'), row('40%', '30%')], 'Product preview', {
    lg: { padding: v('space-6'), 'box-shadow': v('shadow-raised'), transform: 'rotate(1deg)' },
    tablet: { transform: 'none' },
  }, 'div');
}

function createLanding(name = 'Product landing page'): Forest {
  const button = buttonComponent();
  const feature = featureComponent();
  const pricing = pricingComponent();
  const rowOnPhones = { 'mobile-portrait': 'Row' };

  const hero = el(
    'section',
    { lg: { 'padding-block': v('space-8'), background: `linear-gradient(180deg, ${v('color-brand-soft')}, ${v('color-bg')})` }, tablet: { 'padding-block': v('space-7') } },
    [
      container(
        [
          el('div', { lg: { display: 'flex', 'flex-direction': 'column', gap: v('space-5'), 'align-items': 'flex-start' }, tablet: { 'align-items': 'center', 'text-align': 'center' } }, [
            txt('p', 'Project planning, minus the chaos', { lg: { margin: '0', color: v('color-brand'), 'font-size': v('text-sm'), 'font-weight': v('weight-bold'), 'text-transform': 'uppercase', 'letter-spacing': '0.08em' } }),
            heading(1, 'Plan the work. Ship it together.', { lg: { 'font-size': v('text-4xl') }, 'mobile-portrait': { 'font-size': v('text-3xl') } }),
            muted('Fernwood keeps roadmaps, tasks and decisions in one calm place, so your team spends less time chasing updates and more time building.', { lg: { 'font-size': v('text-lg'), 'max-width': '36em' } }),
            el('div', { lg: { display: 'flex', gap: v('space-3'), 'flex-wrap': 'wrap' }, tablet: { 'justify-content': 'center' }, 'mobile-portrait': { 'flex-direction': 'column', 'align-self': 'stretch' } }, [
              use(button, { label: 'Start free trial' }),
              use(button, { label: 'Book a demo' }, { lg: 'Ghost' }),
            ]),
          ]),
          productMock(),
        ],
        { lg: { display: 'grid', 'grid-template-columns': 'minmax(0, 1.1fr) minmax(0, 0.9fr)', gap: v('space-7'), 'align-items': 'center' }, tablet: { 'grid-template-columns': 'minmax(0, 1fr)' } },
      ),
    ],
    { name: 'Hero' },
  );

  const logos = el('section', { lg: { 'padding-block': v('space-6') } }, [
    container(
      [
        muted('Trusted by teams at', { lg: { 'font-size': v('text-sm') } }),
        el('div', { lg: { display: 'flex', 'flex-wrap': 'wrap', 'justify-content': 'center', gap: `${v('space-3')} ${v('space-7')}` } }, ['Northwind', 'Halcyon', 'Bluebird', 'Okapi', 'Meridian'].map((n) => txt('span', n, { lg: { color: v('color-muted'), 'font-family': v('font-heading'), 'font-size': v('text-xl'), 'font-weight': v('weight-bold') } }))),
      ],
      { lg: { display: 'flex', 'flex-direction': 'column', 'align-items': 'center', gap: v('space-4') } },
    ),
  ], { name: 'Logos' });

  const features = section(
    [
      sectionIntro('Everything your team needs', 'From the first idea to the release notes, without a pile of tools.'),
      grid(3, 2, [
        use(feature, { icon: '◎', title: 'Roadmaps', body: 'See every project on one timeline and move dates by dragging.' }, rowOnPhones),
        use(feature, { icon: '✓', title: 'Tasks', body: 'Break work down, assign it and watch it move across the board.' }, rowOnPhones),
        use(feature, { icon: '✎', title: 'Docs', body: 'Write specs next to the work they describe, with comments inline.' }, rowOnPhones),
        use(feature, { icon: '⚑', title: 'Goals', body: 'Tie projects to outcomes so priorities stay obvious.' }, rowOnPhones),
        use(feature, { icon: '⟳', title: 'Automations', body: 'Move cards, ping owners and file reports on a schedule.' }, rowOnPhones),
        use(feature, { icon: '⌘', title: 'Integrations', body: 'Connect the code, chat and calendar tools you already use.' }, rowOnPhones),
      ], 'Features'),
    ],
    'Features',
  );

  const quote = el('section', { lg: { 'padding-block': v('space-8'), background: v('color-brand-soft') }, tablet: { 'padding-block': v('space-7') } }, [
    container(
      [
        el('blockquote', { lg: { margin: '0', display: 'flex', 'flex-direction': 'column', gap: v('space-4'), 'max-width': '760px', 'margin-inline': 'auto', 'text-align': 'center' } }, [
          txt('p', '“We replaced four tools with Fernwood and our planning meetings got twice as short.”', { lg: { margin: '0', 'font-family': v('font-heading'), 'font-size': v('text-2xl'), 'line-height': '1.35' }, 'mobile-portrait': { 'font-size': v('text-xl') } }),
          txt('footer', 'Maya Chen, Head of Product at Halcyon', { lg: { color: v('color-muted'), 'font-weight': v('weight-medium') } }),
        ]),
      ],
    ),
  ], { name: 'Testimonial' });

  const pricingSection = section([sectionIntro('Simple pricing', 'Start free. Upgrade when your team grows.'), pricingGrid(pricing)], 'Pricing');

  const cta = el('section', { lg: { 'padding-block': v('space-8'), background: v('color-brand'), color: v('color-brand-contrast') }, tablet: { 'padding-block': v('space-7') } }, [
    container(
      [
        heading(2, 'Ready when you are', { lg: { 'font-size': v('text-3xl') } }),
        txt('p', 'Bring your team over in an afternoon. We will help you move your projects.', { lg: { margin: '0', 'font-size': v('text-lg') } }),
        use(button, { label: 'Start free trial' }, { lg: 'Inverse' }),
      ],
      { lg: { display: 'flex', 'flex-direction': 'column', 'align-items': 'center', gap: v('space-4'), 'text-align': 'center' } },
    ),
  ], { name: 'Call to action' });

  const home = page('Home', [siteHeader(button), el('main', {}, [hero, logos, features, quote, pricingSection, cta], { name: 'Main' }), siteFooter()]);

  const faq = (q: string, a: string) =>
    el('details', { lg: { padding: v('space-5'), background: v('color-surface'), border: `1px solid ${v('color-border')}`, 'border-radius': v('radius-md') } }, [txt('summary', q, { lg: { cursor: 'pointer', 'font-weight': v('weight-bold') } }), muted(a, { lg: { 'margin-top': v('space-3') } })]);
  const pricingPage = page('Pricing', [
    siteHeader(button),
    el('main', {}, [
      section([
        el('div', { lg: { display: 'flex', 'flex-direction': 'column', gap: v('space-3'), 'text-align': 'center' } }, [heading(1, 'Pricing that grows with you', { lg: { 'font-size': v('text-4xl') }, 'mobile-portrait': { 'font-size': v('text-3xl') } }), muted('Every plan includes unlimited viewers and a 14-day trial of Business.', { lg: { 'font-size': v('text-lg') } })]),
        heading(2, 'Choose a plan', { lg: { 'font-size': v('text-xl'), 'text-align': 'center' } }),
        pricingGrid(pricing),
      ], 'Plans'),
      section([
        heading(2, 'Questions', { lg: { 'font-size': v('text-2xl'), 'text-align': 'center' } }),
        el('div', { lg: { display: 'flex', 'flex-direction': 'column', gap: v('space-3'), 'max-width': '760px', width: '100%', 'margin-inline': 'auto' } }, [
          faq('Can I change plans later?', 'Yes. Upgrades apply right away and downgrades at the end of the billing period.'),
          faq('Do you offer discounts?', 'Nonprofits and schools get Team for free. Get in touch and we will set it up.'),
          faq('What happens when my trial ends?', 'You keep everything on the Starter plan until you choose a paid plan.'),
          faq('Can I export my data?', 'Any time, as CSV or JSON, from the workspace settings.'),
        ]),
      ], 'Questions', { lg: { 'padding-top': '0' }, tablet: { 'padding-top': '0' } }),
    ], { name: 'Main' }),
    siteFooter(),
  ]);

  const forest = createForest(name, [home, pricingPage]);
  forest.kits = [tokenKit('Fernwood', LANDING_THEME)];
  forest.components = [button, feature, pricing];
  return forest;
}

/* -------------------------------------------------------------------- form */

const FORM_THEME: Theme = {
  brand: '#0f766e',
  brandContrast: '#ffffff',
  brandSoft: '#e6f4f2',
  bg: '#f1f5f4',
  surface: '#ffffff',
  text: '#0f172a',
  muted: '#475569',
  border: '#cbd5d3',
  success: '#15803d',
  heading: SANS,
  body: SANS,
};

function createSignup(name = 'Sign-up and contact forms'): Forest {
  const field = fieldComponent();
  const button = buttonComponent();
  const brand = () => txt('p', 'Tidewater', { lg: { margin: '0', color: v('color-brand'), 'font-weight': v('weight-bold'), 'font-size': v('text-lg') } });
  const link = (label: string) => txt('a', label, { lg: { color: v('color-brand'), 'font-weight': v('weight-medium') } }, { attrs: { href: '#' } });

  const signup = page(
    'Sign up',
    [
      el(
        'main',
        {
          lg: { width: 'min(100%, 460px)', display: 'flex', 'flex-direction': 'column', gap: v('space-5'), padding: v('space-7'), background: v('color-surface'), 'border-radius': v('radius-lg'), 'box-shadow': v('shadow-raised') },
          'mobile-portrait': { padding: v('space-5') },
        },
        [
          el('div', { lg: { display: 'flex', 'flex-direction': 'column', gap: v('space-2') } }, [brand(), heading(1, 'Create your account', { lg: { 'font-size': v('text-2xl') } }), muted('Start your 14-day free trial. No card needed.')]),
          el(
            'form',
            { lg: { display: 'flex', 'flex-direction': 'column', gap: v('space-4') } },
            [
              use(field, { label: 'Full name', name: 'name', placeholder: 'Jordan Lee' }),
              use(field, { label: 'Work email', name: 'email', type: 'email', placeholder: 'you@company.com' }),
              use(field, { label: 'Password', name: 'password', type: 'password', hint: 'At least 12 characters' }),
              el('label', { lg: { display: 'flex', 'align-items': 'flex-start', gap: v('space-3'), color: v('color-muted'), 'font-size': v('text-sm') } }, [
                el('input', { lg: { 'margin-top': '0.2em' } }, [], { attrs: { type: 'checkbox', name: 'terms', required: '' } }),
                el('span', {}, [text('I agree to the '), link('Terms'), text(' and '), link('Privacy Policy'), text('.')]),
              ]),
              submitButton('Create account', { lg: { width: '100%' } }),
            ],
            { name: 'Sign-up form', attrs: { action: '#', method: 'post' } },
          ),
          el('p', { lg: { margin: '0', 'text-align': 'center', color: v('color-muted'), 'font-size': v('text-sm') } }, [text('Already have an account? '), link('Sign in')]),
        ],
        { name: 'Card' },
      ),
    ],
    { lg: { 'min-height': '100vh', display: 'grid', 'place-items': 'center', padding: v('space-5') }, 'mobile-portrait': { padding: v('space-3') } },
  );

  const info = (label: string, value: string) => el('div', { lg: { display: 'flex', 'flex-direction': 'column', gap: v('space-1') } }, [txt('span', label, { lg: { color: v('color-muted'), 'font-size': v('text-sm') } }), txt('strong', value)]);
  const inline = { lg: 'Inline', tablet: '-' };
  const contact = page('Contact', [
    container(
      [
        el('aside', { lg: { display: 'flex', 'flex-direction': 'column', gap: v('space-5') } }, [
          brand(),
          heading(1, 'Talk to our team', { lg: { 'font-size': v('text-3xl') } }),
          muted('Questions about plans, security or a migration? Send us a note and a person will answer within one working day.', { lg: { 'font-size': v('text-lg') } }),
          el('div', { lg: { display: 'grid', 'grid-template-columns': 'repeat(2, minmax(0, 1fr))', gap: v('space-4') }, tablet: { 'grid-template-columns': 'repeat(3, minmax(0, 1fr))' }, 'mobile-portrait': { 'grid-template-columns': 'minmax(0, 1fr)' } }, [info('Email', 'hello@tidewater.test'), info('Phone', '+1 555 0100'), info('Office', 'Portland, Maine')]),
          use(button, { label: 'Read the help center' }, { lg: 'Ghost' }),
        ], { name: 'About' }),
        card(
          [
            heading(2, 'Send a message'),
            el(
              'form',
              { lg: { display: 'flex', 'flex-direction': 'column', gap: v('space-4') } },
              [
                use(field, { label: 'Name', name: 'name', placeholder: 'Jordan Lee' }, inline),
                use(field, { label: 'Email', name: 'email', type: 'email', placeholder: 'you@company.com' }, inline),
                use(field, { label: 'Company', name: 'company', hint: 'Optional' }, inline),
                el('div', { lg: { display: 'grid', 'grid-template-columns': '170px minmax(0, 1fr)', 'column-gap': v('space-4'), 'row-gap': v('space-2') }, tablet: { 'grid-template-columns': 'minmax(0, 1fr)' } }, [
                  txt('label', 'Message', { lg: { 'font-size': v('text-sm'), 'font-weight': v('weight-medium'), 'padding-top': v('space-3') }, tablet: { 'padding-top': '0' } }, { attrs: { for: 'message' } }),
                  el('textarea', { lg: { width: '100%', 'min-height': '140px', padding: `${v('space-3')} ${v('space-4')}`, border: `1px solid ${v('color-border')}`, 'border-radius': v('radius-md'), font: 'inherit', color: v('color-text'), background: v('color-surface') } }, [], { attrs: { id: 'message', name: 'message', rows: '5' } }),
                ], { name: 'Message field' }),
                submitButton('Send message', { lg: { 'align-self': 'flex-end' }, 'mobile-portrait': { 'align-self': 'stretch' } }),
              ],
              { name: 'Contact form', attrs: { action: '#', method: 'post' } },
            ),
          ],
          'Message',
          { lg: { padding: v('space-6') }, 'mobile-portrait': { padding: v('space-5') } },
        ),
      ],
      {
        lg: { display: 'grid', 'grid-template-columns': 'minmax(0, 0.8fr) minmax(0, 1.2fr)', gap: v('space-7'), 'padding-block': v('space-8'), 'align-items': 'start' },
        tablet: { 'grid-template-columns': 'minmax(0, 1fr)', gap: v('space-6'), 'padding-block': v('space-6') },
      },
      { tag: 'main' },
    ),
  ]);

  const forest = createForest(name, [signup, contact]);
  forest.kits = [tokenKit('Tidewater', FORM_THEME)];
  forest.components = [field, button];
  return forest;
}

/* ----------------------------------------------------------------- gallery */

export const STARTERS: readonly StarterForest[] = [
  {
    id: 'dashboard',
    label: 'Analytics dashboard',
    description: 'An app shell with a sidebar that becomes a top bar on tablets, stat tiles, a chart, a table and a settings form',
    trees: ['Overview', 'Settings'],
    components: ['Button', 'Stat tile', 'Form field'],
    swatch: [DASHBOARD_THEME.brand, DASHBOARD_THEME.bg, DASHBOARD_THEME.surface, DASHBOARD_THEME.text],
    create: createDashboard,
  },
  {
    id: 'landing',
    label: 'Product landing page',
    description: 'Hero, features, testimonial, pricing and a call to action, plus a pricing page with questions',
    trees: ['Home', 'Pricing'],
    components: ['Button', 'Feature card', 'Pricing card'],
    swatch: [LANDING_THEME.brand, LANDING_THEME.bg, LANDING_THEME.surface, LANDING_THEME.text],
    create: createLanding,
  },
  {
    id: 'form',
    label: 'Sign-up and contact forms',
    description: 'A centered sign-up card and a two-column contact page whose fields put labels beside inputs on desktops',
    trees: ['Sign up', 'Contact'],
    components: ['Form field', 'Button'],
    swatch: [FORM_THEME.brand, FORM_THEME.bg, FORM_THEME.surface, FORM_THEME.text],
    create: createSignup,
  },
];

export function getStarter(id: string): StarterForest | undefined {
  return STARTERS.find((s) => s.id === id);
}
