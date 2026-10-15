import { normalizeForest, normalizeKit, normalizeTree, TreeDataError } from '@tree-weaver/core';
import type { DesignKit, Forest, Tree } from '@tree-weaver/core';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { DOCUMENT_FORMAT, DOCUMENT_VERSION, FormatError, type FormatId, type TreeDocument } from './types';

/** The envelope written to JSON and YAML files. */
export type Envelope =
  | { format: typeof DOCUMENT_FORMAT; version: number; forest: Forest }
  | { format: typeof DOCUMENT_FORMAT; version: number; tree: Tree; kits?: DesignKit[] };

export function toEnvelope(doc: TreeDocument): Envelope {
  if (doc.kind === 'forest') return { format: DOCUMENT_FORMAT, version: DOCUMENT_VERSION, forest: doc.forest };
  const env: Envelope = { format: DOCUMENT_FORMAT, version: DOCUMENT_VERSION, tree: doc.tree };
  if (doc.kits.length) env.kits = doc.kits;
  return env;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Read parsed data into a document. Accepts the envelope, or (for hand-written files)
 * a bare forest (`trees`), a bare tree (`root`), or a bare branch.
 */
export function fromData(data: unknown, format: FormatId): TreeDocument {
  try {
    if (!isObj(data)) throw new FormatError('The file does not contain a Tree Weaver object', format);
    if (data.format !== undefined && data.format !== DOCUMENT_FORMAT) {
      throw new FormatError(`Unsupported document format "${String(data.format)}"`, format);
    }
    if (typeof data.version === 'number' && data.version > DOCUMENT_VERSION) {
      throw new FormatError(`This file was written by a newer Tree Weaver (version ${data.version})`, format);
    }
    if (data.forest !== undefined) return { kind: 'forest', forest: normalizeForest(data.forest) };
    if (data.tree !== undefined) {
      const kits = Array.isArray(data.kits) ? data.kits.map((k, i) => normalizeKit(k, `kits[${i}]`)) : [];
      return { kind: 'tree', tree: normalizeTree(data.tree), kits };
    }
    if (Array.isArray(data.trees)) return { kind: 'forest', forest: normalizeForest(data) };
    if (data.root !== undefined) return { kind: 'tree', tree: normalizeTree(data), kits: [] };
    if (data.kind === 'branch' || data.tag !== undefined || Array.isArray(data.children)) {
      return { kind: 'tree', tree: normalizeTree({ root: data }), kits: [] };
    }
    throw new FormatError('Could not find a forest, tree or branch in the file', format);
  } catch (err) {
    if (err instanceof TreeDataError) throw new FormatError(err.message, format);
    throw err;
  }
}

export function exportJson(doc: TreeDocument): string {
  return `${JSON.stringify(toEnvelope(doc), null, 2)}\n`;
}

export function importJson(text: string): TreeDocument {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new FormatError(`Invalid JSON: ${(err as Error).message}`, 'json');
  }
  return fromData(data, 'json');
}

export function exportYaml(doc: TreeDocument): string {
  return stringifyYaml(toEnvelope(doc), { lineWidth: 0, aliasDuplicateObjects: false });
}

export function importYaml(text: string): TreeDocument {
  let data: unknown;
  try {
    data = parseYaml(text);
  } catch (err) {
    throw new FormatError(`Invalid YAML: ${(err as Error).message}`, 'yaml');
  }
  return fromData(data, 'yaml');
}
