import {
  BASE_CSS,
  DISPLAYS,
  isBranch,
  renderNodeHtml,
  renderTreeBody,
  renderTreeCss,
  rootAttrs,
  type Branch,
  type DisplayId,
  type Forest,
  type Tree,
  type TreeNode,
} from '@tree-weaver/core';
import { slugify } from './slug';
import { zip, type ZipEntry } from './zip';

/**
 * Storybook export: a ready-to-run Storybook project (framework-free `@storybook/html-vite`)
 * with one stories file per tree. Each tree gets a story for the whole tree, one per display
 * type, and one per named branch. Text and image leaves become Storybook args, so content can
 * be edited from the Controls panel. Design kits load globally in the preview.
 */

/** Storybook release the generated project targets. */
export const STORYBOOK_VERSION = '^10.6.2';

export interface StorybookFile {
  path: string;
  content: string;
}

export interface StorybookExport {
  /** Folder name the project unpacks into, e.g. `my-site-storybook`. */
  name: string;
  files: StorybookFile[];
}

export interface StorybookOptions {
  /** Only export these trees (by id). All trees when omitted. */
  treeIds?: string[];
}

interface LeafArg {
  id: string;
  type: 'text' | 'image';
}

interface StoryDef {
  exportName: string;
  name: string;
  html: string;
  args: Record<string, string>;
  leaves: Record<string, LeafArg>;
  display?: DisplayId;
}

const words = (value: string): string[] =>
  value
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_-]+/)
    .filter(Boolean);

const capital = (w: string): string => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();

function pascalCase(value: string, fallback: string): string {
  const out = words(value).map(capital).join('');
  if (!out) return fallback;
  return /^\d/.test(out) ? `${fallback}${out}` : out;
}

function camelCase(value: string, fallback: string): string {
  const pascal = pascalCase(value, '');
  if (!pascal) return fallback;
  const camel = pascal.charAt(0).toLowerCase() + pascal.slice(1);
  return /^\d/.test(camel) ? `${fallback}${pascal}` : camel;
}

/** Hands out unique names: `card`, `card2`, `card3`. */
function uniqueNames(taken: Iterable<string> = []) {
  const used = new Set(taken);
  return (base: string): string => {
    let name = base;
    for (let n = 2; used.has(name); n++) name = `${base}${n}`;
    used.add(name);
    return name;
  };
}

/** Storybook titles use `/` for hierarchy, so it cannot appear inside a name. */
const titlePart = (value: string): string => value.replace(/\//g, '-').trim() || 'Untitled';

/** Args (and the leaves they fill) for every text and image leaf under `node`. */
function collectLeaves(node: TreeNode): { args: Record<string, string>; leaves: Record<string, LeafArg> } {
  const args: Record<string, string> = {};
  const leaves: Record<string, LeafArg> = {};
  const unique = uniqueNames();
  const visit = (current: TreeNode, parent: Branch | null) => {
    if (isBranch(current)) {
      current.children.forEach((child) => visit(child, current));
      return;
    }
    const owner = parent ? (parent.name ?? parent.type ?? parent.tag) : 'content';
    const base = camelCase(owner, 'content') + (current.type === 'image' ? 'Image' : 'Text');
    const key = unique(base);
    args[key] = current.value;
    leaves[key] = { id: current.id, type: current.type };
  };
  visit(node, null);
  return { args, leaves };
}

function treeStories(tree: Tree): StoryDef[] {
  const exportName = uniqueNames(['default']);
  const storyName = uniqueNames();
  const stories: StoryDef[] = [];

  const whole = collectLeaves(tree.root);
  const wholeHtml = `<div ${rootAttrs(tree.root)}>${renderTreeBody(tree.root, { designer: true })}</div>`;
  stories.push({ exportName: exportName('WholeTree'), name: storyName('Whole tree'), html: wholeHtml, ...whole });
  for (const display of DISPLAYS) {
    stories.push({
      exportName: exportName(`WholeTree${pascalCase(display.label, 'Display')}`),
      name: storyName(`Whole tree, ${display.label.toLowerCase()}`),
      html: wholeHtml,
      ...whole,
      display: display.id,
    });
  }

  const visit = (node: TreeNode) => {
    if (!isBranch(node)) return;
    if (node !== tree.root && node.name?.trim()) {
      const label = node.name.trim();
      const exportBase = pascalCase(label, 'Branch');
      const name = storyName(label);
      const suffix = name.slice(label.length);
      stories.push({
        exportName: exportName(exportBase),
        name: suffix ? `${label} ${suffix}` : label,
        html: renderNodeHtml(node, { designer: true }),
        ...collectLeaves(node),
      });
    }
    node.children.forEach(visit);
  };
  visit(tree.root);
  return stories;
}

const js = (value: unknown): string => JSON.stringify(value, null, 2);

/** Story parameters as source: the markup and the leaves each arg fills, one leaf per line. */
function treeWeaverParams(s: StoryDef): string {
  const leaves = Object.entries(s.leaves).map(([key, leaf]) => `    ${JSON.stringify(key)}: ${JSON.stringify(leaf)},`);
  return `{\n  html: ${JSON.stringify(s.html)},\n  leaves: {${leaves.length ? `\n${leaves.join('\n')}\n  ` : ''}},\n}`;
}

function storiesFile(forest: Forest, tree: Tree, cssFile: string): string {
  const [whole, ...rest] = treeStories(tree);
  const shared = (s: StoryDef) => s.html === whole.html;
  const body = [whole, ...rest]
    .map((s) => {
      const parts = [`  name: ${JSON.stringify(s.name)},`];
      if (shared(s)) {
        if (Object.keys(s.args).length) parts.push('  args: wholeTreeArgs,');
        parts.push('  parameters: { treeWeaver: wholeTree },');
      } else {
        if (Object.keys(s.args).length) parts.push(`  args: ${js(s.args).replace(/\n/g, '\n  ')},`);
        parts.push(`  parameters: { treeWeaver: ${treeWeaverParams(s).replace(/\n/g, '\n  ')} },`);
      }
      if (s.display) parts.push(`  globals: { viewport: { value: ${JSON.stringify(s.display)}, isRotated: false } },`);
      return `export const ${s.exportName} = {\n${parts.join('\n')}\n};`;
    })
    .join('\n\n');
  return `// Generated by Tree Weaver from the tree ${JSON.stringify(tree.name)}.
// Export again from Tree Weaver to update it; edits here are not read back.
import './${cssFile}';
import { renderBranch } from '../.storybook/tree-weaver.js';

export default {
  title: ${JSON.stringify(`${titlePart(forest.name)}/${titlePart(tree.name)}`)},
  render: (args, { parameters }) => renderBranch(parameters.treeWeaver, args),
};

const wholeTree = ${treeWeaverParams(whole)};

const wholeTreeArgs = ${js(whole.args)};

${body}
`;
}

const RENDER_HELPER = `// Renders a Tree Weaver branch and fills its leaves from Storybook args.
export function renderBranch({ html, leaves }, args) {
  const host = document.createElement('div');
  host.style.display = 'contents';
  host.innerHTML = html;
  for (const [key, leaf] of Object.entries(leaves ?? {})) {
    const el = host.querySelector(\`[data-tw-leaf="\${CSS.escape(leaf.id)}"]\`);
    if (!el) continue;
    const value = args[key] == null ? '' : String(args[key]);
    if (leaf.type === 'image') el.setAttribute('src', value);
    else el.replaceWith(document.createTextNode(value));
  }
  return host;
}
`;

function previewFile(kitFiles: string[]): string {
  const viewports = Object.fromEntries(
    DISPLAYS.map((d) => [
      d.id,
      {
        name: d.label,
        styles: { width: `${d.width}px`, height: `${d.height}px` },
        type: d.id.startsWith('mobile') ? 'mobile' : d.id === 'tablet' ? 'tablet' : 'desktop',
      },
    ]),
  );
  const imports = ['../styles/base.css', ...kitFiles.map((f) => `../styles/kits/${f}`)].map((p) => `import '${p}';`).join('\n');
  return `${imports}

/** Tree Weaver display types, offered in the viewport toolbar. */
const viewports = ${js(viewports)};

export default {
  parameters: {
    layout: 'fullscreen',
    viewport: { options: viewports },
  },
};
`;
}

const MAIN_FILE = `/** @type { import('@storybook/html-vite').StorybookConfig } */
export default {
  stories: ['../stories/**/*.stories.js'],
  framework: { name: '@storybook/html-vite', options: {} },
};
`;

function packageFile(name: string): string {
  return `${js({
    name,
    private: true,
    type: 'module',
    scripts: { storybook: 'storybook dev -p 6006', 'build-storybook': 'storybook build' },
    devDependencies: { '@storybook/html-vite': STORYBOOK_VERSION, storybook: STORYBOOK_VERSION, vite: '^7.0.0' },
  })}\n`;
}

function readme(forest: Forest, trees: Tree[]): string {
  return `# ${forest.name} in Storybook

Exported from Tree Weaver. Each tree is a stories file in \`stories/\`, with a story for the whole tree,
one per display type, and one per named branch. Edit text and images from the Controls panel, and switch
display types from the viewport toolbar.

\`\`\`sh
npm install
npm run storybook
\`\`\`

Trees: ${trees.map((t) => t.name).join(', ') || 'none'}.

Design kits load in \`.storybook/preview.js\`. To change the layouts, edit them in Tree Weaver and export again.
`;
}

/** Build a Storybook project for a forest (or some of its trees). */
export function exportStorybook(forest: Forest, opts: StorybookOptions = {}): StorybookExport {
  const trees = opts.treeIds ? forest.trees.filter((t) => opts.treeIds!.includes(t.id)) : forest.trees;
  const name = `${slugify(forest.name, 'forest')}-storybook`;
  const kitName = uniqueNames();
  const kits = forest.kits.filter((k) => k.enabled).map((k) => ({ file: `${kitName(slugify(k.name, 'kit'))}.css`, kit: k }));
  const treeName = uniqueNames();

  const files: StorybookFile[] = [
    { path: 'package.json', content: packageFile(name) },
    { path: 'README.md', content: readme(forest, trees) },
    { path: '.gitignore', content: 'node_modules\nstorybook-static\n' },
    { path: '.storybook/main.js', content: MAIN_FILE },
    { path: '.storybook/preview.js', content: previewFile(kits.map((k) => k.file)) },
    { path: '.storybook/tree-weaver.js', content: RENDER_HELPER },
    { path: 'styles/base.css', content: `${BASE_CSS}\n` },
    ...kits.map(({ file, kit }) => ({ path: `styles/kits/${file}`, content: `/* ${kit.name.replace(/\*\//g, '* /')} */\n${kit.css}\n` })),
  ];
  for (const tree of trees) {
    const slug = treeName(slugify(tree.name, 'tree'));
    files.push({ path: `stories/${slug}.css`, content: `${renderTreeCss(tree.root)}\n` });
    files.push({ path: `stories/${slug}.stories.js`, content: storiesFile(forest, tree, `${slug}.css`) });
  }
  return { name, files };
}

/** The Storybook project as a zip, with every file inside its project folder. */
export function zipStorybook(project: StorybookExport, modified?: Date): Uint8Array {
  const entries: ZipEntry[] = project.files.map((f) => ({ path: `${project.name}/${f.path}`, content: f.content }));
  return zip(entries, modified);
}
