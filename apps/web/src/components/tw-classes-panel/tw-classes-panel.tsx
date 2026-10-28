import { Component, Element, State, h } from '@stencil/core';
import {
  classOfSelector,
  DISPLAYS,
  getDisplay,
  inheritedStyles,
  isBranch,
  isClassName,
  walk,
  type DesignKit,
  type DisplayId,
  type StyleRule,
} from '@tree-weaver/core';
import {
  addRule,
  currentTree,
  customKits,
  moveRule,
  removeRule,
  renameRule,
  selectedNode,
  setRulesCss,
  setRuleStyle,
  toast,
  updateBranch,
} from '../../store/actions';
import { state } from '../../store/editor';
import { Icon } from '../../utils/icons';

/** Properties offered when adding a declaration. Any property can be typed. */
const PROPS = [
  'display', 'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-self', 'gap', 'row-gap', 'column-gap',
  'grid-template-columns', 'grid-template-rows', 'grid-column', 'grid-row', 'grid-auto-flow',
  'margin', 'margin-inline', 'margin-block', 'padding', 'padding-inline', 'padding-block',
  'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height', 'aspect-ratio',
  'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-align', 'text-decoration', 'text-transform', 'color',
  'background', 'background-color', 'border', 'border-radius', 'box-shadow', 'opacity', 'overflow',
  'position', 'inset', 'top', 'right', 'bottom', 'left', 'z-index', 'cursor', 'transition', 'transform',
];

/** Whether the browser accepts `selector`. */
function isValidSelector(selector: string): boolean {
  try {
    document.createDocumentFragment().querySelector(selector);
    return true;
  } catch {
    return false;
  }
}

/** Branches in the current tree that carry a class. */
function classUsage(name: string): number {
  const tree = currentTree();
  let count = 0;
  if (tree) walk(tree.root, (node) => void (isBranch(node) && node.classes.includes(name) && count++));
  return count;
}

/** Custom classes and selectors: CSS rules written in the editor, styled per display. */
@Component({ tag: 'tw-classes-panel' })
export class TwClassesPanel {
  @Element() host!: HTMLElement;
  @State() newClass = '';
  @State() newSelector = '';
  @State() newDecl = { prop: '', value: '' };

  componentDidLoad() {
    // Opened from elsewhere (the inspector): bring that rule into view.
    if (state.openRuleId) this.host.querySelector('.rule-details')?.scrollIntoView({ block: 'nearest' });
  }

  private addClass() {
    const name = this.newClass.trim().replace(/^\./, '');
    if (!isClassName(name)) {
      toast('Class names start with a letter, and use letters, digits, - and _', 'error');
      return;
    }
    addRule(`.${name}`);
    this.newClass = '';
  }

  private addSelector() {
    const selector = this.newSelector.trim();
    if (!selector || !isValidSelector(selector)) {
      toast(`“${selector}” is not a valid CSS selector`, 'error');
      return;
    }
    addRule(selector);
    this.newSelector = '';
  }

  private rename(kit: DesignKit, rule: StyleRule, input: HTMLInputElement) {
    const selector = input.value.trim();
    if (selector === rule.selector) return;
    if (!selector || !isValidSelector(selector)) {
      toast(`“${selector}” is not a valid CSS selector`, 'error');
      input.value = rule.selector;
      return;
    }
    renameRule(kit.id, rule.id, selector);
  }

  private toggle(id: string) {
    state.openRuleId = state.openRuleId === id ? null : id;
    this.newDecl = { prop: '', value: '' };
  }

  private applyCss(kit: DesignKit, css: string) {
    const skipped = setRulesCss(kit.id, css);
    if (skipped.length) toast(`Left out ${skipped.join(', ')}: custom styles hold plain rules and the display media queries only`, 'error');
  }

  /** Put the class on the selected branch, or take it off. */
  private renderApply(name: string) {
    const node = selectedNode();
    if (!isBranch(node)) return <p class="hint">Select a branch to give it this class.</p>;
    const has = node.classes.includes(name);
    return (
      <button
        class="btn small"
        onClick={() => updateBranch(node.id, { classes: has ? node.classes.filter((c) => c !== name) : [...node.classes, name] })}
      >
        {has ? `Remove from selected branch` : `Add to selected branch`}
      </button>
    );
  }

  private renderDeclarations(kit: DesignKit, rule: StyleRule) {
    const display = state.display as DisplayId;
    const own = rule.styles[display] ?? {};
    const inherited = Object.entries(inheritedStyles(rule.styles, display)).filter(([prop]) => !(prop in own));
    const add = () => {
      const prop = this.newDecl.prop.trim().toLowerCase();
      if (prop && this.newDecl.value.trim()) setRuleStyle(kit.id, rule.id, prop, this.newDecl.value);
      this.newDecl = { prop: '', value: '' };
    };
    return (
      <div class="rule-decls">
        <div class="rule-decls-head">
          Styles on <strong>{getDisplay(display).label}</strong>
        </div>
        {Object.entries(own).map(([prop, value]) => (
          <div class="kv" key={`${rule.id}:${display}:${prop}`}>
            <input class="input mono" value={prop} aria-label="Property" readOnly />
            <input class="input mono" value={value} aria-label={`${prop} value`} onChange={(e) => setRuleStyle(kit.id, rule.id, prop, (e.target as HTMLInputElement).value || null)} />
            <button class="icon-btn danger" aria-label={`Remove ${prop}`} onClick={() => setRuleStyle(kit.id, rule.id, prop, null)}>
              <Icon name="x" />
            </button>
          </div>
        ))}
        {inherited.map(([prop, value]) => (
          <div class="kv inherited" key={`${rule.id}:${display}:inherited:${prop}`} title="Inherited from a wider display. Type a value to change it on this display only.">
            <input class="input mono" value={prop} aria-label="Property" readOnly />
            <input class="input mono" placeholder={value} aria-label={`${prop} value on ${getDisplay(display).label}`} onChange={(e) => setRuleStyle(kit.id, rule.id, prop, (e.target as HTMLInputElement).value || null)} />
            <span />
          </div>
        ))}
        <div class="kv" key={`${rule.id}:new`}>
          <input
            class="input mono"
            placeholder="property"
            aria-label="New property"
            list="tw-dl-css-props"
            value={this.newDecl.prop}
            onInput={(e) => (this.newDecl = { ...this.newDecl, prop: (e.target as HTMLInputElement).value })}
          />
          <input
            class="input mono"
            placeholder="value"
            aria-label="New value"
            value={this.newDecl.value}
            onInput={(e) => (this.newDecl = { ...this.newDecl, value: (e.target as HTMLInputElement).value })}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
          <button class="icon-btn" aria-label="Add style" onClick={add}>
            <Icon name="plus" />
          </button>
        </div>
        {display !== 'lg' ? <p class="hint">Changes here apply to {getDisplay(display).label} only. Faded rows come from wider displays.</p> : null}
      </div>
    );
  }

  private renderRule(kit: DesignKit, rule: StyleRule, index: number, count: number) {
    const open = state.openRuleId === rule.id;
    const name = classOfSelector(rule.selector);
    const used = name ? classUsage(name) : 0;
    return [
      <div class={{ 'list-item': true, current: open }} key={rule.id}>
        <span class="title mono" title={rule.selector} onClick={() => this.toggle(rule.id)}>
          {rule.selector}
          {name ? <span class="meta"> · {used === 1 ? '1 branch' : `${used} branches`}</span> : null}
        </span>
        <button class="icon-btn" title="Earlier (later rules win)" disabled={index === 0} onClick={() => moveRule(kit.id, rule.id, -1)}>
          <Icon name="up" />
        </button>
        <button class="icon-btn" title="Later (later rules win)" disabled={index === count - 1} onClick={() => moveRule(kit.id, rule.id, 1)}>
          <Icon name="down" />
        </button>
        <button class="icon-btn" title="Edit" aria-expanded={String(open)} onClick={() => this.toggle(rule.id)}>
          <Icon name="edit" />
        </button>
        <button class="icon-btn danger" title="Delete rule" onClick={() => removeRule(kit.id, rule.id)}>
          <Icon name="trash" />
        </button>
      </div>,
      open ? (
        <div class="kit-details rule-details" key={`${rule.id}-details`}>
          <div class="field">
            <label htmlFor={`rule-sel-${rule.id}`}>Selector</label>
            <input id={`rule-sel-${rule.id}`} class="input mono" value={rule.selector} onChange={(e) => this.rename(kit, rule, e.target as HTMLInputElement)} />
          </div>
          <div class="overrides" aria-label="Displays with styles">
            {DISPLAYS.map((d) => (
              <span class={{ on: !!rule.styles[d.id] }} title={rule.styles[d.id] ? `${Object.keys(rule.styles[d.id]!).length} styles on ${d.label}` : `No styles on ${d.label}`}>
                {d.short}
              </span>
            ))}
          </div>
          {this.renderDeclarations(kit, rule)}
          {name ? <div class="row">{this.renderApply(name)}</div> : null}
        </div>
      ) : null,
    ];
  }

  private renderKit(kit: DesignKit & { rules: StyleRule[] }, titled: boolean) {
    return (
      <section class="panel-section" key={kit.id}>
        {titled ? <h3 class="panel-title">{kit.name}</h3> : null}
        {kit.enabled ? null : <p class="hint">This kit is turned off in the Kits tab, so these rules don’t apply.</p>}
        {kit.rules.map((rule, i) => this.renderRule(kit, rule, i, kit.rules.length))}
        <details>
          <summary class="hint">Edit as CSS</summary>
          <textarea class="textarea mono" rows={10} aria-label={`${kit.name} CSS`} value={kit.css} onChange={(e) => this.applyCss(kit, (e.target as HTMLTextAreaElement).value)} />
          <p class="hint">Plain rules apply to every display. Put rules inside a display’s media query (as written above) to style that display.</p>
        </details>
      </section>
    );
  }

  render() {
    const kits = customKits();
    const display = getDisplay(state.display as DisplayId);
    const empty = kits.every((k) => !k.rules.length);
    return [
      <section class="panel-section">
        <h3 class="panel-title">Classes and selectors</h3>
        <p class="hint">
          Write your own CSS rules. They style every tree in this forest and load after your other kits. Styles you set here apply to <strong>{display.label}</strong>; switch display in the
          toolbar to style the others.
        </p>
        <div class="row" style={{ marginBottom: '6px' }}>
          <span class="input-prefix mono">.</span>
          <input
            class="input mono grow"
            placeholder="new-class-name"
            aria-label="New class name"
            value={this.newClass}
            onInput={(e) => (this.newClass = (e.target as HTMLInputElement).value)}
            onKeyDown={(e) => e.key === 'Enter' && this.addClass()}
          />
          <button class="btn small" disabled={!this.newClass.trim()} onClick={() => this.addClass()}>
            <Icon name="plus" /> Class
          </button>
        </div>
        <div class="row">
          <input
            class="input mono grow"
            placeholder="Any selector: nav a:hover, .card > h2…"
            aria-label="New selector"
            value={this.newSelector}
            onInput={(e) => (this.newSelector = (e.target as HTMLInputElement).value)}
            onKeyDown={(e) => e.key === 'Enter' && this.addSelector()}
          />
          <button class="btn small" disabled={!this.newSelector.trim()} onClick={() => this.addSelector()}>
            <Icon name="plus" /> Selector
          </button>
        </div>
        {empty ? <p class="hint">No custom rules yet. Add a class above, or select a branch and use “Save styles as class” in the inspector.</p> : null}
      </section>,
      kits.map((kit) => (kit.rules.length || kits.length > 1 ? this.renderKit(kit, kits.length > 1) : null)),
      <datalist id="tw-dl-css-props">
        {PROPS.map((p) => (
          <option value={p} />
        ))}
      </datalist>,
    ];
  }
}
