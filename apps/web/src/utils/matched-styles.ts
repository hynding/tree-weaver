import {
  alignRuleLines,
  compareSpecificity,
  DISPLAYS,
  isInherited,
  locateRules,
  resolveCascade,
  selectorSpecificity,
  sortByPrecedence,
  splitSelectorList,
  UNLAYERED,
  type CascadeDeclaration,
  type CascadeRule,
  type DesignKit,
  type RuleLocation,
  type Specificity,
} from '@tree-weaver/core';
import { fetchKitCss } from '@tree-weaver/kits';
import { state } from '../store/editor';

/** Where a rule came from, in terms the inspector can show and link to. */
export interface StyleSource {
  kind: 'kit' | 'import' | 'tree' | 'base' | 'inline' | 'page';
  label: string;
  /** The design kit the rule loads through, directly or by `@import`. */
  kitId?: string;
  /** The stylesheet's URL, when it has one. */
  href?: string;
  /** For `@import`ed stylesheets: the stylesheets that imported it, outermost first. */
  via?: string[];
}

export interface MatchedRule extends CascadeRule {
  /** The selector in the rule's list that matched (the most specific one). */
  selector: string;
  source: StyleSource;
  /** `@media`, `@supports`, `@container` and `@layer` conditions around the rule, outermost first. */
  conditions: string[];
  /** 1-based line in the kit's CSS, when the text is available. */
  line?: number;
  declarations: CascadeDeclaration[];
}

export interface StyleGroup {
  /** The element these rules match: the selected one, then its ancestors. */
  element: Element;
  rules: MatchedRule[];
}

export interface UnreadableSheet {
  source: StyleSource;
  href: string;
}

export interface MatchedStyles {
  groups: StyleGroup[];
  /** Stylesheets whose servers don't allow reading their rules (no CORS). */
  unreadable: UnreadableSheet[];
}

/** Stylesheets the canvas adds for itself (selection outlines, grid overlay). */
const EDITOR_SHEETS = new Set(['tw-editor']);

const host = (url: string) => {
  try {
    const u = new URL(url);
    return u.host + u.pathname;
  } catch {
    return url;
  }
};

const fileName = (url: string) => url.split(/[?#]/)[0].split('/').filter(Boolean).pop() ?? url;

function sourceOf(sheet: CSSStyleSheet, kits: DesignKit[]): StyleSource | null {
  const owner = sheet.ownerNode as Element | null;
  const id = owner?.id;
  if (id && EDITOR_SHEETS.has(id)) return null;
  if (id === 'tw-base') return { kind: 'base', label: 'Tree Weaver base styles' };
  if (id === 'tw-tree') return { kind: 'tree', label: 'Branch styles' };
  const kitId = owner?.getAttribute('data-tw-kit');
  const kit = kitId ? kits.find((k) => k.id === kitId) : undefined;
  if (kit) return { kind: 'kit', label: kit.name, kitId: kit.id, href: kit.href };
  return { kind: 'page', label: sheet.href ? fileName(sheet.href) : 'Page styles', href: sheet.href ?? undefined };
}

/** Called for each style rule in source order, with the rule built for it when it matched the element. */
type OnRule = (selectorText: string, matched: MatchedRule | null) => void;

/** Report the style rules inside a block that doesn't apply, so source lines stay aligned. */
function skipRules(rules: CSSRuleList, onRule: OnRule) {
  for (const rule of Array.from(rules)) {
    if (ruleType(rule) === 'CSSStyleRule') onRule((rule as CSSStyleRule).selectorText, null);
    else if ('cssRules' in rule && ruleType(rule) !== 'CSSImportRule') skipRules((rule as CSSGroupingRule).cssRules, onRule);
  }
}

/** Rule type by constructor name: the canvas's rules come from another window, so `instanceof` fails. */
const ruleType = (rule: CSSRule) => rule.constructor.name;

/** Split `cssText` declarations at top-level semicolons. */
function splitDeclarations(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ';' && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out.map((d) => d.trim()).filter(Boolean);
}

/**
 * Collects the rules that match an element and its ancestors from every stylesheet in
 * the canvas, in document order, following `@import`, `@media`, `@supports`, `@layer`
 * and `@container`. Media queries are tested against the canvas, so the result follows
 * the display being edited.
 */
class Collector {
  private order = 0;
  private layers = new Map<string, number>();
  private anonymousLayers = 0;
  private longhandCache = new Map<string, string[]>();
  private probe: CSSStyleDeclaration;
  private view: Window;
  readonly perTarget: MatchedRule[][];
  readonly unreadable: UnreadableSheet[] = [];

  constructor(
    private targets: Element[],
    private kits: DesignKit[],
  ) {
    const doc = targets[0].ownerDocument;
    this.view = doc.defaultView!;
    this.probe = doc.createElement('div').style;
    this.perTarget = targets.map(() => []);
  }

  run() {
    const doc = this.targets[0].ownerDocument;
    for (const sheet of Array.from(doc.styleSheets)) {
      const source = sourceOf(sheet, this.kits);
      if (source) this.visitSheet(sheet, source, [], UNLAYERED, '');
    }
    this.addInlineStyles();
  }

  private registerLayer(name: string): number {
    if (!this.layers.has(name)) this.layers.set(name, this.layers.size);
    return this.layers.get(name)!;
  }

  /** The stylesheet's own text, when the editor has it, parsed for rule lines. */
  private textOf(source: StyleSource): ParsedText | null {
    if (source.kind === 'kit') {
      const kit = this.kits.find((k) => k.id === source.kitId);
      return kit?.css ? parseText(`kit:${kit.id}`, kit.css) : null;
    }
    if (source.kind === 'import' && source.href) return fetchedImport(source.href);
    return null;
  }

  private visitSheet(sheet: CSSStyleSheet, source: StyleSource, conditions: string[], layer: number, layerName: string) {
    const text = this.textOf(source);
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      // The browser won't share this cross-origin sheet's rules. When the editor has its
      // text anyway (fetched with CORS), read the rules from a copy built from that text.
      if (text?.sheet) rules = text.sheet.cssRules;
      else {
        if (sheet.href && text !== PENDING) this.unreadable.push({ source, href: sheet.href });
        return;
      }
    }
    const located: { rule: MatchedRule; ordinal: number }[] = [];
    const selectors: string[] = [];
    this.visitRules(rules, source, conditions, layer, layerName, (selectorText, matched) => {
      if (matched) located.push({ rule: matched, ordinal: selectors.length });
      selectors.push(selectorText);
    });
    if (text?.rules && located.length) {
      const lines = alignRuleLines(text.rules, selectors);
      for (const { rule, ordinal } of located) rule.line = lines[ordinal];
    }
  }

  private visitRules(
    rules: CSSRuleList,
    source: StyleSource,
    conditions: string[],
    layer: number,
    layerName: string,
    onRule: OnRule,
  ) {
    for (const rule of Array.from(rules)) {
      switch (ruleType(rule)) {
        case 'CSSStyleRule': {
          const style = rule as CSSStyleRule;
          onRule(style.selectorText, this.matchRule(style, source, conditions, layer));
          break;
        }
        case 'CSSImportRule': {
          const imp = rule as CSSImportRule;
          const media = imp.media?.mediaText;
          if (!imp.styleSheet || (media && !this.view.matchMedia(media).matches)) break;
          const href = imp.styleSheet.href ?? imp.href;
          const child: StyleSource = {
            kind: 'import',
            label: fileName(href),
            kitId: source.kitId,
            href,
            via: [...(source.via ?? []), source.label],
          };
          let childLayer = layer;
          let childLayerName = layerName;
          const named = (imp as CSSImportRule & { layerName?: string | null }).layerName;
          if (named !== null && named !== undefined) {
            childLayerName = [layerName, named || `(anonymous ${++this.anonymousLayers})`].filter(Boolean).join('.');
            childLayer = this.registerLayer(childLayerName);
          }
          const cond = media ? [...conditions, `@media ${media}`] : conditions;
          this.visitSheet(imp.styleSheet, child, childLayerName === layerName ? cond : [...cond, `@layer ${childLayerName}`], childLayer, childLayerName);
          break;
        }
        case 'CSSMediaRule': {
          const media = (rule as CSSMediaRule).media.mediaText;
          if (!this.view.matchMedia(media).matches) {
            skipRules((rule as CSSMediaRule).cssRules, onRule);
            break;
          }
          this.visitRules((rule as CSSMediaRule).cssRules, source, [...conditions, this.describeMedia(media, source)], layer, layerName, onRule);
          break;
        }
        case 'CSSSupportsRule': {
          const text = (rule as CSSSupportsRule).conditionText;
          if (!CSS.supports(text)) {
            skipRules((rule as CSSSupportsRule).cssRules, onRule);
            break;
          }
          this.visitRules((rule as CSSSupportsRule).cssRules, source, [...conditions, `@supports ${text}`], layer, layerName, onRule);
          break;
        }
        case 'CSSContainerRule': {
          // Container conditions depend on the container's size; list them with their condition.
          const text = (rule as CSSRule & { conditionText: string }).conditionText;
          this.visitRules((rule as CSSGroupingRule).cssRules, source, [...conditions, `@container ${text}`], layer, layerName, onRule);
          break;
        }
        case 'CSSLayerBlockRule': {
          const own = (rule as CSSRule & { name: string }).name || `(anonymous ${++this.anonymousLayers})`;
          const name = layerName ? `${layerName}.${own}` : own;
          this.visitRules((rule as CSSGroupingRule).cssRules, source, [...conditions, `@layer ${name}`], this.registerLayer(name), name, onRule);
          break;
        }
        case 'CSSLayerStatementRule':
          for (const own of (rule as CSSRule & { nameList: string[] }).nameList) this.registerLayer(layerName ? `${layerName}.${own}` : own);
          break;
        case 'CSSScopeRule':
        case 'CSSStartingStyleRule':
          // Not shown: they depend on scoping roots and transitions.
          break;
        default:
          break;
      }
    }
  }

  /** Branch styles are written per display; name the display instead of its query. */
  private describeMedia(media: string, source: StyleSource): string {
    if (source.kind === 'tree') {
      const display = DISPLAYS.find((d) => d.media && d.media.replace(/\s/g, '') === media.replace(/\s/g, ''));
      if (display) return display.label;
    }
    return `@media ${media}`;
  }

  private longhands(property: string, value: string): string[] {
    if (property.startsWith('--')) return [property];
    const cached = this.longhandCache.get(property);
    if (cached) return cached;
    this.probe.cssText = '';
    this.probe.setProperty(property, value);
    const list = Array.from(this.probe);
    if (!list.length) return [property];
    this.longhandCache.set(property, list);
    return list;
  }

  private declarations(style: CSSStyleDeclaration): CascadeDeclaration[] {
    const out: CascadeDeclaration[] = [];
    for (const part of splitDeclarations(style.cssText)) {
      const colon = part.indexOf(':');
      if (colon < 1) continue;
      const property = part.slice(0, colon).trim();
      let value = part.slice(colon + 1).trim();
      const important = /!\s*important$/i.test(value);
      if (important) value = value.replace(/\s*!\s*important$/i, '');
      out.push({ property, value, important, longhands: this.longhands(property, value) });
    }
    return out;
  }

  private matchRule(rule: CSSStyleRule, source: StyleSource, conditions: string[], layer: number): MatchedRule | null {
    const order = this.order++;
    const parts = splitSelectorList(rule.selectorText);
    let first: MatchedRule | null = null;
    let declarations: CascadeDeclaration[] | null = null;
    this.targets.forEach((target, depth) => {
      let best: { selector: string; specificity: Specificity } | null = null;
      for (const selector of parts) {
        let hit = false;
        try {
          hit = target.matches(selector);
        } catch {
          // Selectors this browser rejects, or pseudo-elements, never match.
        }
        if (!hit) continue;
        const specificity = selectorSpecificity(selector);
        if (!best || compareSpecificity(specificity, best.specificity) > 0) best = { selector, specificity };
      }
      if (!best) return;
      declarations ??= this.declarations(rule.style);
      // Ancestors only pass on inherited properties.
      const decls = depth === 0 ? declarations : declarations.filter((d) => d.longhands.some(isInherited)).map((d) => ({ ...d }));
      if (!decls.length) return;
      const matched: MatchedRule = { ...best, layer, order, source, conditions, declarations: decls };
      this.perTarget[depth].push(matched);
      if (depth === 0) first = matched;
    });
    return first;
  }

  private addInlineStyles() {
    this.targets.forEach((target, depth) => {
      const style = (target as HTMLElement).style;
      if (!style?.length) return;
      const declarations = this.declarations(style).filter((d) => depth === 0 || d.longhands.some(isInherited));
      if (!declarations.length) return;
      this.perTarget[depth].push({
        selector: 'style attribute',
        specificity: [0, 0, 0],
        inline: true,
        layer: UNLAYERED,
        order: this.order++,
        source: { kind: 'inline', label: 'Inline style' },
        conditions: [],
        declarations,
      });
    });
  }
}

interface ParsedText {
  rules: RuleLocation[];
  /** A readable copy of the stylesheet built from its text, for sheets the browser won't share. */
  sheet: CSSStyleSheet | null;
}

/** Stylesheet text parsed once per change, keyed by kit or URL. */
const textCache = new Map<string, { css: string; parsed: ParsedText }>();

function parseText(key: string, css: string): ParsedText {
  const cached = textCache.get(key);
  if (cached?.css === css) return cached.parsed;
  let sheet: CSSStyleSheet | null = new CSSStyleSheet();
  try {
    // Drops any `@import` rules inside, which a constructed sheet can't load.
    sheet.replaceSync(css);
  } catch {
    sheet = null;
  }
  const parsed = { rules: locateRules(css), sheet };
  textCache.set(key, { css, parsed });
  return parsed;
}

const PENDING = Object.freeze({ rules: [], sheet: null }) as ParsedText;

/** Imported stylesheets' text, fetched by the editor: `null` while loading, `''` when the server refuses. */
const importText = new Map<string, string | null>();

/**
 * The text of an `@import`ed stylesheet. Browsers fetch imports without CORS, so their
 * rules are hidden even when the server allows CORS; fetching the text ourselves gets
 * around that. Starts the fetch on first use and refreshes the canvas views when it lands.
 */
function fetchedImport(href: string): ParsedText | null {
  if (!importText.has(href)) {
    importText.set(href, null);
    void fetchKitCss(href).then((css) => {
      importText.set(href, css);
      state.canvasVersion++;
    });
  }
  const css = importText.get(href);
  if (css === null) return PENDING;
  return css ? parseText(`url:${href}`, css) : null;
}

/**
 * Every rule that styles `element`, grouped by the element it matches (the element
 * itself, then each ancestor that passes inherited properties down), strongest first,
 * with overridden declarations marked.
 */
export function matchStyles(element: Element, kits: DesignKit[]): MatchedStyles {
  const targets: Element[] = [];
  for (let el: Element | null = element; el; el = el.parentElement) targets.push(el);
  const collector = new Collector(targets, kits);
  collector.run();
  resolveCascade(collector.perTarget);
  const groups = collector.perTarget
    .map((rules, i) => ({ element: targets[i], rules: sortByPrecedence(rules) }))
    .filter((g, i) => i === 0 || g.rules.length);
  const seen = new Set<string>();
  const unreadable = collector.unreadable.filter((u) => !seen.has(u.href) && seen.add(u.href));
  return { groups, unreadable };
}

/** Short description of a stylesheet URL for labels: host and path. */
export const describeHref = host;
