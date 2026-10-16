import type { DesignKit, Forest, Tree } from '@tree-weaver/core';
import { exportJson, exportYaml, importJson, importYaml } from './data';
import { exportHtml, importHtml } from './html';
import { exportMarkdown, importMarkdown } from './markdown';
import { slugify } from './slug';
import { FORMATS, FormatError, getFormat, type FormatId, type TreeDocument } from './types';
import { exportXml, importXml } from './xml';

export * from './types';
export { exportJson, exportYaml, importJson, importYaml, toEnvelope, fromData } from './data';
export { exportHtml, importHtml } from './html';
export { exportMarkdown, importMarkdown, splitFrontMatter, escapeMarkdown } from './markdown';
export { exportXml, importXml, XML_NAMESPACE } from './xml';
export { exportStorybook, zipStorybook, STORYBOOK_VERSION, type StorybookExport, type StorybookFile, type StorybookOptions } from './storybook';
export { zip, crc32, type ZipEntry } from './zip';
export { slugify } from './slug';

/** Format for a file name, from its extension. */
export function formatFromFileName(fileName: string): FormatId | null {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  return FORMATS.find((f) => f.extensions.includes(ext))?.id ?? null;
}

/** Guess the format of some text, preferring the file name's extension when given. */
export function detectFormat(text: string, fileName?: string): FormatId {
  const byName = fileName ? formatFromFileName(fileName) : null;
  if (byName) return byName;
  const head = text.replace(/^﻿/, '').trimStart();
  if (/^<\?xml|^<tree-weaver[\s>]/i.test(head)) return 'xml';
  if (head.startsWith('<')) return 'html';
  if (head.startsWith('{') || head.startsWith('[')) return 'json';
  if (/^---\s*\n[\s\S]*?^tree-weaver:/m.test(head)) return 'markdown';
  if (/^(format:\s*tree-weaver|forest:|tree:|trees:|root:)/m.test(head)) return 'yaml';
  return 'markdown';
}

/** Read text in any supported format. The format is detected when not given. */
export function importDocument(text: string, format?: FormatId, fileName?: string): TreeDocument {
  const id = format ?? detectFormat(text, fileName);
  switch (id) {
    case 'json':
      return importJson(text);
    case 'yaml':
      return importYaml(text);
    case 'xml':
      return importXml(text);
    case 'html':
      return importHtml(text);
    case 'markdown':
      return importMarkdown(text);
    default:
      throw new FormatError(`Unsupported format "${String(id)}"`);
  }
}

/** Write a whole forest. Only formats that can hold several trees are allowed. */
export function exportForest(forest: Forest, format: FormatId): string {
  const doc: TreeDocument = { kind: 'forest', forest };
  switch (format) {
    case 'json':
      return exportJson(doc);
    case 'yaml':
      return exportYaml(doc);
    case 'xml':
      return exportXml(doc);
    default:
      throw new FormatError(`${getFormat(format).label} holds a single tree; export a tree instead`, format);
  }
}

/** Write one tree with the design kits it uses. */
export function exportTree(tree: Tree, format: FormatId, kits: DesignKit[] = []): string {
  const doc: TreeDocument = { kind: 'tree', tree, kits };
  switch (format) {
    case 'json':
      return exportJson(doc);
    case 'yaml':
      return exportYaml(doc);
    case 'xml':
      return exportXml(doc);
    case 'html':
      return exportHtml(tree, { kits });
    case 'markdown':
      return exportMarkdown(tree, { kits });
    default:
      throw new FormatError(`Unsupported format "${String(format)}"`);
  }
}

/** A file name such as `home-page.tree.json` or `my-site.forest.yaml`. */
export function suggestFileName(name: string, scope: 'tree' | 'forest', format: FormatId): string {
  const slug = slugify(name, scope);
  const ext = getFormat(format).extensions[0];
  return format === 'html' || format === 'markdown' ? `${slug}.${ext}` : `${slug}.${scope}.${ext}`;
}
