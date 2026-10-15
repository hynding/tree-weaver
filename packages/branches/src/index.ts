import {
  createBranch,
  createLeaf,
  createTable,
  createTree,
  equalColumns,
  text,
  type Branch,
  type DisplayStyles,
  type Tree,
  type TreeNode,
} from '@tree-weaver/core';

/**
 * The branch library: ready-made branches (components) and leaves (content)
 * the editor offers in its palette, plus whole-tree templates.
 */

export type BlueprintCategory = 'Layout' | 'Content' | 'Media' | 'Table' | 'Sections';

export interface Blueprint {
  id: string;
  label: string;
  category: BlueprintCategory;
  description: string;
  /** Short glyph for compact palettes. */
  glyph: string;
  create(): TreeNode;
}

/** A responsive grid: `columns` on desktop, two on tablet, one on a portrait phone. */
export function responsiveGrid(columns: number, children: TreeNode[] = [], name = 'Grid'): Branch {
  const styles: DisplayStyles = {
    lg: { display: 'grid', 'grid-template-columns': equalColumns(columns), gap: '1rem' },
  };
  if (columns > 2) styles.tablet = { 'grid-template-columns': equalColumns(2) };
  if (columns > 1) styles['mobile-portrait'] = { 'grid-template-columns': '1fr' };
  const cells = children.length ? children : Array.from({ length: columns }, (_, i) => cell(`Cell ${i + 1}`));
  return createBranch({ type: 'grid', name, styles, children: cells });
}

const cell = (label: string): Branch =>
  createBranch({
    type: 'cell',
    styles: { lg: { padding: '1rem', border: '1px dashed #c4cdd5', 'min-height': '4rem' } },
    children: [text(label)],
  });

export const flexRow = (children: TreeNode[] = []): Branch =>
  createBranch({
    type: 'flex-row',
    name: 'Row',
    styles: {
      lg: { display: 'flex', 'flex-direction': 'row', 'flex-wrap': 'wrap', gap: '1rem', 'align-items': 'center' },
      'mobile-portrait': { 'flex-direction': 'column', 'align-items': 'stretch' },
    },
    children,
  });

export const flexColumn = (children: TreeNode[] = []): Branch =>
  createBranch({
    type: 'flex-column',
    name: 'Column',
    styles: { lg: { display: 'flex', 'flex-direction': 'column', gap: '1rem' } },
    children,
  });

export const heading = (level: 1 | 2 | 3 | 4 | 5 | 6, value: string, classes: string[] = []): Branch =>
  createBranch({ tag: `h${level}`, classes, children: [text(value)] });

export const paragraph = (value: string, classes: string[] = []): Branch => createBranch({ tag: 'p', classes, children: [text(value)] });

export const button = (label: string, primary = false): Branch =>
  createBranch({ tag: 'a', type: 'button', classes: primary ? ['btn', 'btn-primary'] : ['btn'], attrs: { href: '#' }, children: [text(label)] });

export const image = (src = 'https://picsum.photos/seed/tree-weaver/800/500', alt = 'Placeholder image'): TreeNode =>
  createLeaf(src, 'image', { alt });

export const card = (title = 'Card title', body = 'Describe something worth reading here.'): Branch =>
  createBranch({ tag: 'article', type: 'card', name: 'Card', classes: ['card'], children: [heading(3, title), paragraph(body, ['muted'])] });

export const section = (children: TreeNode[] = [], name = 'Section'): Branch =>
  createBranch({
    tag: 'section',
    type: 'section',
    name,
    classes: ['section'],
    children: [createBranch({ type: 'container', name: 'Container', classes: ['container'], children })],
  });

const list = (ordered: boolean): Branch =>
  createBranch({
    tag: ordered ? 'ol' : 'ul',
    children: ['First item', 'Second item', 'Third item'].map((t) => createBranch({ tag: 'li', children: [text(t)] })),
  });

export const BLUEPRINTS: readonly Blueprint[] = [
  // Layout
  { id: 'section', label: 'Section', category: 'Layout', glyph: '▭', description: 'Full-width section with a centered container', create: () => section() },
  { id: 'container', label: 'Container', category: 'Layout', glyph: '▢', description: 'Centered, width-limited wrapper', create: () => createBranch({ type: 'container', name: 'Container', classes: ['container'] }) },
  { id: 'box', label: 'Box', category: 'Layout', glyph: '□', description: 'Plain block (div)', create: () => createBranch({ type: 'box', name: 'Box' }) },
  { id: 'grid-2', label: 'Grid · 2', category: 'Layout', glyph: '▦', description: 'Two columns, one on phones', create: () => responsiveGrid(2) },
  { id: 'grid-3', label: 'Grid · 3', category: 'Layout', glyph: '▦', description: 'Three columns, two on tablets, one on phones', create: () => responsiveGrid(3) },
  { id: 'grid-4', label: 'Grid · 4', category: 'Layout', glyph: '▦', description: 'Four columns, two on tablets, one on phones', create: () => responsiveGrid(4) },
  {
    id: 'sidebar',
    label: 'Sidebar layout',
    category: 'Layout',
    glyph: '◧',
    description: 'Sidebar and main area that stack on tablets and phones',
    create: () =>
      createBranch({
        type: 'grid',
        name: 'Sidebar layout',
        styles: { lg: { display: 'grid', 'grid-template-columns': '260px minmax(0, 1fr)', gap: '1.5rem' }, tablet: { 'grid-template-columns': '1fr' } },
        children: [
          createBranch({ tag: 'aside', name: 'Sidebar', children: [text('Sidebar')] }),
          createBranch({ tag: 'main', name: 'Main', children: [text('Main content')] }),
        ],
      }),
  },
  { id: 'flex-row', label: 'Flex row', category: 'Layout', glyph: '⇶', description: 'Items in a wrapping row, stacked on portrait phones', create: () => flexRow([cell('Item 1'), cell('Item 2'), cell('Item 3')]) },
  { id: 'flex-column', label: 'Flex column', category: 'Layout', glyph: '⇊', description: 'Items stacked with a gap', create: () => flexColumn([cell('Item 1'), cell('Item 2')]) },
  { id: 'header', label: 'Header', category: 'Layout', glyph: '▔', description: 'Page header landmark', create: () => createBranch({ tag: 'header', name: 'Header', children: [] }) },
  { id: 'footer', label: 'Footer', category: 'Layout', glyph: '▁', description: 'Page footer landmark', create: () => createBranch({ tag: 'footer', name: 'Footer', children: [] }) },
  { id: 'spacer', label: 'Spacer', category: 'Layout', glyph: '↕', description: 'Vertical space', create: () => createBranch({ type: 'spacer', name: 'Spacer', styles: { lg: { height: '2rem' } } }) },
  { id: 'divider', label: 'Divider', category: 'Layout', glyph: '—', description: 'Horizontal rule', create: () => createBranch({ tag: 'hr' }) },

  // Content
  { id: 'h1', label: 'Heading 1', category: 'Content', glyph: 'H1', description: 'Page title', create: () => heading(1, 'Page title') },
  { id: 'h2', label: 'Heading 2', category: 'Content', glyph: 'H2', description: 'Section title', create: () => heading(2, 'Section title') },
  { id: 'h3', label: 'Heading 3', category: 'Content', glyph: 'H3', description: 'Sub-section title', create: () => heading(3, 'Sub-section title') },
  { id: 'paragraph', label: 'Paragraph', category: 'Content', glyph: '¶', description: 'A paragraph of text', create: () => paragraph('Write something worth reading. Double-click text in the canvas to edit it.') },
  { id: 'text', label: 'Text leaf', category: 'Content', glyph: 'T', description: 'Bare text content', create: () => text('Text') },
  { id: 'link', label: 'Link', category: 'Content', glyph: '↗', description: 'Hyperlink', create: () => createBranch({ tag: 'a', attrs: { href: '#' }, children: [text('Link text')] }) },
  { id: 'button', label: 'Button', category: 'Content', glyph: '⏺', description: 'Call to action (styled link)', create: () => button('Get started', true) },
  { id: 'list', label: 'List', category: 'Content', glyph: '•', description: 'Bulleted list', create: () => list(false) },
  { id: 'ordered-list', label: 'Numbered list', category: 'Content', glyph: '1.', description: 'Numbered list', create: () => list(true) },
  { id: 'quote', label: 'Quote', category: 'Content', glyph: '“', description: 'Block quote', create: () => createBranch({ tag: 'blockquote', children: [paragraph('A memorable quote.')] }) },
  { id: 'code', label: 'Code block', category: 'Content', glyph: '{}', description: 'Preformatted code', create: () => createBranch({ tag: 'pre', children: [createBranch({ tag: 'code', children: [text('const forest = weave();')] })] }) },

  // Media
  { id: 'image', label: 'Image', category: 'Media', glyph: '▣', description: 'Image leaf', create: () => image() },
  {
    id: 'figure',
    label: 'Figure',
    category: 'Media',
    glyph: '▤',
    description: 'Image with a caption',
    create: () => createBranch({ tag: 'figure', name: 'Figure', children: [image(), createBranch({ tag: 'figcaption', children: [text('Caption')] })] }),
  },

  // Tables
  { id: 'table', label: 'Table', category: 'Table', glyph: '⊞', description: '3 × 3 table with a header row', create: () => ({ ...createTable(3, 3), classes: ['table'] }) },
  { id: 'table-plain', label: 'Plain table', category: 'Table', glyph: '⊟', description: '2 × 2 table without a header', create: () => createTable(2, 2, false) },

  // Sections
  { id: 'card', label: 'Card', category: 'Sections', glyph: '▢', description: 'Title and body in a card', create: () => card() },
  {
    id: 'navbar',
    label: 'Navigation bar',
    category: 'Sections',
    glyph: '☰',
    description: 'Brand and links, stacked on portrait phones',
    create: () =>
      createBranch({
        tag: 'nav',
        type: 'navbar',
        name: 'Navigation',
        classes: ['nav', 'container'],
        styles: { 'mobile-portrait': { 'flex-direction': 'column', gap: '0.5rem' } },
        children: [
          createBranch({ tag: 'strong', children: [text('Brand')] }),
          createBranch({
            type: 'flex-row',
            classes: ['cluster'],
            children: ['Home', 'About', 'Contact'].map((t) => createBranch({ tag: 'a', attrs: { href: '#' }, children: [text(t)] })),
          }),
        ],
      }),
  },
  {
    id: 'hero',
    label: 'Hero',
    category: 'Sections',
    glyph: '★',
    description: 'Headline, intro and actions',
    create: () =>
      createBranch({
        tag: 'section',
        type: 'hero',
        name: 'Hero',
        classes: ['hero'],
        children: [
          createBranch({
            type: 'container',
            classes: ['container', 'stack'],
            children: [
              heading(1, 'Weave layouts that fit every screen'),
              paragraph('Build once, then tune each display: desktop, tablet and phone.', ['muted']),
              flexRow([button('Start weaving', true), button('Learn more')]),
            ],
          }),
        ],
      }),
  },
  {
    id: 'features',
    label: 'Feature grid',
    category: 'Sections',
    glyph: '▦',
    description: 'Three cards in a responsive grid',
    create: () => section([heading(2, 'Features'), responsiveGrid(3, [card('Fast'), card('Flexible'), card('Portable')], 'Feature grid')], 'Features'),
  },
];

export const BLUEPRINT_CATEGORIES: readonly BlueprintCategory[] = ['Layout', 'Content', 'Media', 'Table', 'Sections'];

export function getBlueprint(id: string): Blueprint | undefined {
  return BLUEPRINTS.find((b) => b.id === id);
}

/* -------------------------------------------------------------- templates */

export interface TreeTemplate {
  id: string;
  label: string;
  description: string;
  create(name?: string): Tree;
}

const build = (id: string) => getBlueprint(id)!.create();

export const TEMPLATES: readonly TreeTemplate[] = [
  { id: 'blank', label: 'Blank', description: 'An empty tree', create: (name = 'Untitled tree') => createTree(name) },
  {
    id: 'landing',
    label: 'Landing page',
    description: 'Navigation, hero, feature grid, pricing table and footer',
    create: (name = 'Landing page') => {
      const tree = createTree(name);
      const pricing = createTable(3, 3);
      pricing.classes = ['table'];
      tree.root.children = [
        createBranch({ tag: 'header', name: 'Header', classes: ['surface'], children: [build('navbar')] }),
        build('hero'),
        build('features'),
        section([heading(2, 'Pricing'), pricing], 'Pricing'),
        createBranch({ tag: 'footer', name: 'Footer', classes: ['section', 'center', 'muted'], children: [paragraph('Made with Tree Weaver')] }),
      ];
      return tree;
    },
  },
  {
    id: 'dashboard',
    label: 'Dashboard',
    description: 'Sidebar layout with stat cards and a data table',
    create: (name = 'Dashboard') => {
      const tree = createTree(name);
      const stats = responsiveGrid(4, ['Visitors', 'Signups', 'Revenue', 'Churn'].map((t) => card(t, '0')), 'Stats');
      const data = createTable(5, 4);
      data.classes = ['table'];
      tree.root.children = [
        createBranch({
          type: 'grid',
          name: 'App shell',
          styles: {
            lg: { display: 'grid', 'grid-template-columns': '240px minmax(0, 1fr)', 'min-height': '100vh' },
            tablet: { 'grid-template-columns': '1fr' },
          },
          children: [
            createBranch({
              tag: 'aside',
              name: 'Sidebar',
              classes: ['surface'],
              styles: { lg: { padding: '1.5rem' }, tablet: { display: 'none' } },
              children: [heading(3, 'Menu'), flexColumn(['Overview', 'Reports', 'Settings'].map((t) => createBranch({ tag: 'a', attrs: { href: '#' }, children: [text(t)] })))],
            }),
            createBranch({ tag: 'main', name: 'Main', classes: ['stack'], styles: { lg: { padding: '1.5rem' } }, children: [heading(1, 'Overview'), stats, data] }),
          ],
        }),
      ];
      return tree;
    },
  },
  {
    id: 'article',
    label: 'Article',
    description: 'Readable single column with a figure and a quote',
    create: (name = 'Article') => {
      const tree = createTree(name);
      tree.root.children = [
        createBranch({
          tag: 'article',
          name: 'Article',
          classes: ['container', 'section'],
          styles: { lg: { 'max-width': '720px' } },
          children: [
            heading(1, 'A story worth telling'),
            paragraph('Lead paragraph that sets the scene.', ['muted']),
            build('figure'),
            paragraph('Body copy continues here.'),
            build('quote'),
          ],
        }),
      ];
      return tree;
    },
  },
];

export function getTemplate(id: string): TreeTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
