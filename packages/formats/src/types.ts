import type { DesignKit, Forest, Tree } from '@tree-weaver/core';

export type FormatId = 'json' | 'yaml' | 'xml' | 'html' | 'markdown';

export interface FormatInfo {
  id: FormatId;
  label: string;
  extensions: string[];
  mime: string;
  /** Whether the format can carry a whole forest, or only a single tree. */
  forest: boolean;
  /** Whether a round trip keeps every detail of a tree (ids, styles, attributes). */
  lossless: boolean;
}

export const FORMATS: readonly FormatInfo[] = [
  { id: 'json', label: 'JSON', extensions: ['json'], mime: 'application/json', forest: true, lossless: true },
  { id: 'yaml', label: 'YAML', extensions: ['yaml', 'yml'], mime: 'application/yaml', forest: true, lossless: true },
  { id: 'xml', label: 'XML', extensions: ['xml'], mime: 'application/xml', forest: true, lossless: true },
  { id: 'html', label: 'HTML', extensions: ['html', 'htm'], mime: 'text/html', forest: false, lossless: true },
  { id: 'markdown', label: 'Markdown', extensions: ['md', 'markdown'], mime: 'text/markdown', forest: false, lossless: false },
];

export function getFormat(id: FormatId): FormatInfo {
  const info = FORMATS.find((f) => f.id === id);
  if (!info) throw new Error(`Unknown format "${id}"`);
  return info;
}

/** What an import produced: a whole forest, or one tree plus any design kits that came with it. */
export type TreeDocument = { kind: 'forest'; forest: Forest } | { kind: 'tree'; tree: Tree; kits: DesignKit[] };

/** Identifies Tree Weaver documents in JSON and YAML. */
export const DOCUMENT_FORMAT = 'tree-weaver';
export const DOCUMENT_VERSION = 1;

export class FormatError extends Error {
  constructor(
    message: string,
    readonly format?: FormatId,
  ) {
    super(message);
    this.name = 'FormatError';
  }
}
