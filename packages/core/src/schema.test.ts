import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DISPLAY_IDS } from './displays';
import { PATCH_SCHEMA_URL, TREE_WEAVER_PATCH_SCHEMA } from './patch';
import { SCHEMA_URL, TREE_WEAVER_SCHEMA } from './schema';

const committed = (name: string, schema: unknown) => {
  const file = fileURLToPath(new URL(`../../../schema/${name}`, import.meta.url));
  const json = `${JSON.stringify(schema, null, 2)}\n`;
  if (process.env.UPDATE_SCHEMA) writeFileSync(file, json);
  return { actual: readFileSync(file, 'utf8'), json };
};

describe('JSON Schema', () => {
  it('is committed in sync with TREE_WEAVER_SCHEMA (run `pnpm schema` to update)', () => {
    const { actual, json } = committed('tree-weaver-v1.schema.json', TREE_WEAVER_SCHEMA);
    expect(actual).toBe(json);
  });

  it('for patches is committed in sync with TREE_WEAVER_PATCH_SCHEMA', () => {
    const { actual, json } = committed('tree-weaver-patch-v1.schema.json', TREE_WEAVER_PATCH_SCHEMA);
    expect(actual).toBe(json);
  });

  it('names its published URL and every display', () => {
    expect(TREE_WEAVER_SCHEMA.$id).toBe(SCHEMA_URL);
    expect(TREE_WEAVER_PATCH_SCHEMA.$id).toBe(PATCH_SCHEMA_URL);
    expect(TREE_WEAVER_SCHEMA.$defs.displayId.enum).toEqual([...DISPLAY_IDS]);
  });
});
