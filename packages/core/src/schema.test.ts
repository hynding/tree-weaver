import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DISPLAY_IDS } from './displays';
import { SCHEMA_URL, TREE_WEAVER_SCHEMA } from './schema';

const file = fileURLToPath(new URL('../../../schema/tree-weaver-v1.schema.json', import.meta.url));
const json = `${JSON.stringify(TREE_WEAVER_SCHEMA, null, 2)}\n`;

describe('JSON Schema', () => {
  it('is committed in sync with TREE_WEAVER_SCHEMA (run `pnpm schema` to update)', () => {
    if (process.env.UPDATE_SCHEMA) writeFileSync(file, json);
    expect(readFileSync(file, 'utf8')).toBe(json);
  });

  it('names its published URL and every display', () => {
    expect(TREE_WEAVER_SCHEMA.$id).toBe(SCHEMA_URL);
    expect(TREE_WEAVER_SCHEMA.$defs.displayId.enum).toEqual([...DISPLAY_IDS]);
  });
});
