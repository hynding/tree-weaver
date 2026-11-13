import { normalizeForest, normalizeKit, normalizeTree, SCHEMA_URL, TreeDataError, validateDocument, type ValidationResult } from '@tree-weaver/core';
import type { DesignKit, Forest, Tree } from '@tree-weaver/core';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { DOCUMENT_FORMAT, DOCUMENT_VERSION, FormatError, type FormatId, type TreeDocument } from './types';

/** The envelope written to JSON and YAML files. */
export type Envelope =
  | { $schema?: string; format: typeof DOCUMENT_FORMAT; version: number; forest: Forest }
  | { $schema?: string; format: typeof DOCUMENT_FORMAT; version: number; tree: Tree; kits?: DesignKit[] };

/** The envelope for a document. `$schema` points editors and agents at the published JSON Schema. */
export function toEnvelope(doc: TreeDocument): Envelope {
  if (doc.kind === 'forest') return { $schema: SCHEMA_URL, format: DOCUMENT_FORMAT, version: DOCUMENT_VERSION, forest: doc.forest };
  const env: Envelope = { $schema: SCHEMA_URL, format: DOCUMENT_FORMAT, version: DOCUMENT_VERSION, tree: doc.tree };
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

/**
 * Strictly check JSON or YAML text before importing it. Parse failures are reported as an
 * error at `$` instead of thrown. The format is guessed from the first character when not given.
 */
export function validateText(text: string, format?: 'json' | 'yaml'): ValidationResult {
  const fmt = format ?? (/^\s*[{[]/.test(text.replace(/^\uFEFF/, '')) ? 'json' : 'yaml');
  let data: unknown;
  try {
    data = fmt === 'json' ? JSON.parse(text) : parseYaml(text);
  } catch (err) {
    const message = `Invalid ${fmt.toUpperCase()}: ${(err as Error).message}`;
    return { valid: false, kind: null, errors: [{ severity: 'error', path: '$', message }], warnings: [], counts: { trees: 0, branches: 0, leaves: 0 } };
  }
  return validateDocument(data);
}

/**
 * Parse JSON or YAML text into plain data (YAML is a superset of JSON, so either works
 * when the format isn't given). Throws `FormatError` with the parser's message.
 */
export function parseData(text: string, format?: 'json' | 'yaml'): unknown {
  const fmt = format ?? (/^\s*[{["]/.test(text.replace(/^﻿/, '')) ? 'json' : 'yaml');
  try {
    return fmt === 'json' ? JSON.parse(text) : parseYaml(text);
  } catch (err) {
    throw new FormatError(`Invalid ${fmt.toUpperCase()}: ${(err as Error).message}`, fmt);
  }
}
