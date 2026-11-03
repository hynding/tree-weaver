import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020';
import { createForest, createTree, SCHEMA_URL, TREE_WEAVER_SCHEMA, validateDocument } from '@tree-weaver/core';
import { describe, expect, it } from 'vitest';
import { exportForest, exportTree, importDocument, validateText } from './index';

const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
const schemaValid = ajv.compile(TREE_WEAVER_SCHEMA);
const dir = fileURLToPath(new URL('../../../examples/', import.meta.url));
const examples = readdirSync(dir).filter((f) => f.endsWith('.json'));

describe('examples', () => {
  it('exist', () => expect(examples.length).toBeGreaterThanOrEqual(4));

  it.each(examples)('%s is valid, matches the schema and imports', (file) => {
    const text = readFileSync(dir + file, 'utf8');
    const result = validateText(text);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(schemaValid(JSON.parse(text)), JSON.stringify(schemaValid.errors)).toBe(true);
    const doc = importDocument(text, undefined, file);
    expect(doc.kind).toBe(file.includes('.forest.') ? 'forest' : 'tree');
  });
});

describe('exports for agents', () => {
  it('JSON exports name the schema and validate against it', () => {
    const forest = createForest('Site', [createTree('Home')]);
    for (const text of [exportForest(forest, 'json'), exportTree(forest.trees[0], 'json', forest.kits)]) {
      const data = JSON.parse(text);
      expect(data.$schema).toBe(SCHEMA_URL);
      expect(schemaValid(data), JSON.stringify(schemaValid.errors)).toBe(true);
      expect(validateDocument(data)).toMatchObject({ valid: true, warnings: [] });
    }
  });

  it('imports still accept files with $schema', () => {
    const text = exportTree(createTree('Home'), 'yaml');
    expect(text).toContain(SCHEMA_URL);
    expect(importDocument(text, 'yaml').kind).toBe('tree');
  });

  it('validateText reports parse errors instead of throwing', () => {
    expect(validateText('{ "tree": ')).toMatchObject({ valid: false, errors: [{ path: '$' }] });
    expect(validateText('tree:\n  root:\n    tag: body\n', 'yaml')).toMatchObject({ valid: true, kind: 'tree' });
  });
});
