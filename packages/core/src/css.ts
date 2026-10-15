import type { StyleMap } from './model';

/**
 * A small, forgiving CSS parser: enough structure to read rules, at-rules and
 * declarations from design kits and from exported Tree Weaver documents.
 * It is not a validating parser; malformed input degrades rather than throws.
 */

export type CssNode =
  | { type: 'rule'; selector: string; declarations: StyleMap; body: string }
  | { type: 'at'; name: string; prelude: string; children: CssNode[] | null; body: string | null };

/** Remove comments, leaving strings untouched. */
export function stripCssComments(css: string): string {
  let out = '';
  let i = 0;
  while (i < css.length) {
    const ch = css[i];
    if (ch === '"' || ch === "'") {
      const end = findStringEnd(css, i);
      out += css.slice(i, end);
      i = end;
    } else if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end === -1 ? css.length : end + 2;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

function findStringEnd(css: string, start: number): number {
  const quote = css[start];
  let i = start + 1;
  while (i < css.length && css[i] !== quote) {
    if (css[i] === '\\') i++;
    if (css[i] === '\n') break;
    i++;
  }
  return Math.min(i + 1, css.length);
}

/** Index of the `}` matching the `{` at `open`, skipping strings. */
function matchBrace(css: string, open: number): number {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    const ch = css[i];
    if (ch === '"' || ch === "'") {
      i = findStringEnd(css, i) - 1;
    } else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return css.length;
}

/** Split `a: b; c: d` into a style map. Later declarations win. */
export function parseDeclarations(body: string): StyleMap {
  const out: StyleMap = {};
  let current = '';
  let paren = 0;
  const flush = () => {
    const idx = current.indexOf(':');
    if (idx > 0) {
      const prop = current.slice(0, idx).trim();
      const value = current.slice(idx + 1).trim();
      if (prop && value) out[prop.startsWith('--') ? prop : prop.toLowerCase()] = value;
    }
    current = '';
  };
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '"' || ch === "'") {
      const end = findStringEnd(body, i);
      current += body.slice(i, end);
      i = end - 1;
      continue;
    }
    if (ch === '(') paren++;
    if (ch === ')') paren = Math.max(0, paren - 1);
    if (ch === ';' && paren === 0) flush();
    else current += ch;
  }
  flush();
  return out;
}

/** At-rules whose blocks hold nested rules rather than declarations. */
const BLOCK_AT_RULES_WITH_RULES = new Set(['media', 'supports', 'layer', 'container', 'document', 'scope', 'starting-style']);

export function parseCss(input: string): CssNode[] {
  const css = stripCssComments(input);
  const nodes: CssNode[] = [];
  let i = 0;
  while (i < css.length) {
    while (i < css.length && /[\s;]/.test(css[i])) i++;
    if (i >= css.length) break;
    // Find whichever comes first: a block or (for at-rules) a terminating semicolon.
    let j = i;
    while (j < css.length && css[j] !== '{' && !(css[i] === '@' && css[j] === ';')) {
      if (css[j] === '"' || css[j] === "'") j = findStringEnd(css, j);
      else j++;
    }
    const head = css.slice(i, j).trim();
    if (j >= css.length) break;
    if (css[j] === ';') {
      const m = /^@([\w-]+)\s*([\s\S]*)$/.exec(head);
      if (m) nodes.push({ type: 'at', name: m[1].toLowerCase(), prelude: m[2].trim(), children: null, body: null });
      i = j + 1;
      continue;
    }
    const close = matchBrace(css, j);
    const body = css.slice(j + 1, close);
    if (head.startsWith('@')) {
      const m = /^@([\w-]+)\s*([\s\S]*)$/.exec(head);
      const name = (m?.[1] ?? '').toLowerCase();
      const prelude = (m?.[2] ?? '').trim();
      nodes.push(
        BLOCK_AT_RULES_WITH_RULES.has(name)
          ? { type: 'at', name, prelude, children: parseCss(body), body }
          : { type: 'at', name, prelude, children: null, body },
      );
    } else if (head) {
      nodes.push({ type: 'rule', selector: head, declarations: parseDeclarations(body), body });
    }
    i = close + 1;
  }
  return nodes;
}

/** Render a style map as an inline `style` attribute value. */
export function toInlineStyle(styles: StyleMap): string {
  return Object.entries(styles)
    .map(([p, v]) => `${p}: ${v}`)
    .join('; ');
}
