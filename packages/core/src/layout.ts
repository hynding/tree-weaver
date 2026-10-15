import { createBranch, text } from './create';
import type { Branch, TreeNode } from './model';
import { isBranch } from './model';
import { findNode, updateNode } from './ops';

/* ------------------------------------------------------------------ grids */

/** `repeat(3, minmax(0, 1fr))` style template for `count` equal columns. */
export const equalColumns = (count: number): string => `repeat(${Math.max(1, Math.floor(count))}, minmax(0, 1fr))`;

/** Best-effort count of the tracks in a `grid-template-columns` / `-rows` value. */
export function countTracks(template: string | undefined): number {
  if (!template || template === 'none') return 0;
  let total = 0;
  let rest = template.trim();
  const repeat = /repeat\(\s*(\d+)\s*,((?:[^()]|\([^()]*\))*)\)/g;
  rest = rest.replace(repeat, (_m, n: string, inner: string) => {
    total += Number(n) * splitTracks(inner).length;
    return ' ';
  });
  return total + splitTracks(rest).length;
}

function splitTracks(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of value.trim()) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (/\s/.test(ch) && depth === 0) {
      if (current) out.push(current);
      current = '';
    } else current += ch;
  }
  if (current) out.push(current);
  // Line names like [main-start] are not tracks.
  return out.filter((t) => !t.startsWith('['));
}

/* ----------------------------------------------------------------- tables */

const SECTION_TAGS = new Set(['thead', 'tbody', 'tfoot']);

export interface TableRowRef {
  row: Branch;
  section: Branch | null;
}

/** All `tr` rows of a table branch, in order, with the section that holds each. */
export function tableRows(table: Branch): TableRowRef[] {
  const rows: TableRowRef[] = [];
  for (const child of table.children) {
    if (!isBranch(child)) continue;
    if (child.tag === 'tr') rows.push({ row: child, section: null });
    else if (SECTION_TAGS.has(child.tag)) {
      for (const r of child.children) if (isBranch(r) && r.tag === 'tr') rows.push({ row: r, section: child });
    }
  }
  return rows;
}

export function tableSize(table: Branch): { rows: number; columns: number } {
  const rows = tableRows(table);
  const columns = rows.reduce((max, { row }) => Math.max(max, row.children.filter(isCell).length), 0);
  return { rows: rows.length, columns };
}

const isCell = (n: TreeNode): n is Branch => isBranch(n) && (n.tag === 'td' || n.tag === 'th');

export const createCell = (header = false, content = ''): Branch =>
  createBranch({ tag: header ? 'th' : 'td', children: content ? [text(content)] : [] });

function requireTable(root: Branch, tableId: string): Branch {
  const table = findNode(root, tableId);
  if (!isBranch(table) || table.tag !== 'table') throw new Error(`"${tableId}" is not a table`);
  return table;
}

/** Add a body row (after `afterRow` when given, else at the end of the body). */
export function addTableRow(root: Branch, tableId: string, afterRow?: number): Branch {
  const table = requireTable(root, tableId);
  const { columns } = tableSize(table);
  const rows = tableRows(table);
  const newRow = createBranch({ tag: 'tr', children: Array.from({ length: Math.max(1, columns) }, () => createCell()) });
  const anchor = afterRow !== undefined ? rows[afterRow] : undefined;
  if (anchor) {
    const container = anchor.section ?? table;
    return updateNode(root, container.id, (node) => {
      const b = node as Branch;
      const children = [...b.children];
      children.splice(children.findIndex((c) => c.id === anchor.row.id) + 1, 0, newRow);
      return { ...b, children };
    });
  }
  const body = table.children.find((c): c is Branch => isBranch(c) && c.tag === 'tbody');
  return updateNode(root, (body ?? table).id, (node) => ({ ...(node as Branch), children: [...(node as Branch).children, newRow] }));
}

export function removeTableRow(root: Branch, tableId: string, rowIndex: number): Branch {
  const table = requireTable(root, tableId);
  const ref = tableRows(table)[rowIndex];
  if (!ref) return root;
  const container = ref.section ?? table;
  return updateNode(root, container.id, (node) => ({
    ...(node as Branch),
    children: (node as Branch).children.filter((c) => c.id !== ref.row.id),
  }));
}

/** Add a column at `index` (appends when omitted). Header rows get `th` cells. */
export function addTableColumn(root: Branch, tableId: string, index?: number): Branch {
  const table = requireTable(root, tableId);
  return tableRows(table).reduce(
    (acc, { row, section }) =>
      updateNode(acc, row.id, (node) => {
        const r = node as Branch;
        const children = [...r.children];
        const header = section?.tag === 'thead';
        children.splice(index ?? children.length, 0, createCell(header, header ? 'Heading' : ''));
        return { ...r, children };
      }),
    root,
  );
}

export function removeTableColumn(root: Branch, tableId: string, index: number): Branch {
  const table = requireTable(root, tableId);
  return tableRows(table).reduce(
    (acc, { row }) =>
      updateNode(acc, row.id, (node) => {
        const r = node as Branch;
        const cells = r.children.filter(isCell);
        const victim = cells[index];
        return victim ? { ...r, children: r.children.filter((c) => c.id !== victim.id) } : r;
      }),
    root,
  );
}

/** Build a table branch with an optional header row. */
export function createTable(rows: number, columns: number, withHeader = true): Branch {
  const cols = Math.max(1, columns);
  const children: Branch[] = [];
  if (withHeader) {
    children.push(
      createBranch({
        tag: 'thead',
        children: [createBranch({ tag: 'tr', children: Array.from({ length: cols }, (_, i) => createCell(true, `Heading ${i + 1}`)) })],
      }),
    );
  }
  children.push(
    createBranch({
      tag: 'tbody',
      children: Array.from({ length: Math.max(1, rows) }, () =>
        createBranch({ tag: 'tr', children: Array.from({ length: cols }, () => createCell()) }),
      ),
    }),
  );
  return createBranch({ tag: 'table', type: 'table', name: 'Table', children });
}
