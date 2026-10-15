import { Component, State, h } from '@stencil/core';
import {
  countTracks,
  DISPLAYS,
  equalColumns,
  findNode,
  getDisplay,
  inheritedStyles,
  isBranch,
  resolveStyles,
  tableSize,
  type Branch,
  type DisplayId,
  type Leaf,
} from '@tree-weaver/core';
import { kitClasses } from '@tree-weaver/kits';
import {
  currentTree,
  duplicateSelected,
  parentOf,
  removeSelected,
  select,
  selectParent,
  setStyleValue,
  tableEdit,
  updateBranch,
  updateLeaf,
  wrapSelected,
} from '../../store/actions';
import { state } from '../../store/editor';
import { nodeKind, nodeLabel } from '../../utils/describe';
import { Icon } from '../../utils/icons';

interface FieldOpts {
  options?: string[];
  suggestions?: string[];
  placeholder?: string;
}

const TAGS = [
  'div', 'section', 'article', 'aside', 'header', 'footer', 'main', 'nav', 'figure', 'figcaption',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'a', 'strong', 'em', 'small', 'blockquote', 'pre', 'code',
  'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'form', 'label', 'button', 'hr',
];

const SUGGEST: Record<string, string[]> = {
  display: ['block', 'grid', 'flex', 'inline', 'inline-block', 'inline-flex', 'inline-grid', 'contents', 'none', 'table'],
  'flex-direction': ['row', 'row-reverse', 'column', 'column-reverse'],
  'flex-wrap': ['nowrap', 'wrap', 'wrap-reverse'],
  'justify-content': ['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly', 'stretch'],
  'align-items': ['stretch', 'flex-start', 'center', 'flex-end', 'baseline', 'start', 'end'],
  'justify-items': ['stretch', 'start', 'center', 'end'],
  'align-self': ['auto', 'stretch', 'start', 'center', 'end', 'baseline'],
  'justify-self': ['auto', 'stretch', 'start', 'center', 'end'],
  'grid-auto-flow': ['row', 'column', 'dense', 'row dense', 'column dense'],
  'grid-template-columns': ['1fr', 'repeat(2, minmax(0, 1fr))', 'repeat(3, minmax(0, 1fr))', 'repeat(4, minmax(0, 1fr))', 'repeat(auto-fit, minmax(220px, 1fr))', '260px minmax(0, 1fr)'],
  'grid-column': ['auto', 'span 2', 'span 3', '1 / -1'],
  'grid-row': ['auto', 'span 2', '1 / -1'],
  'text-align': ['left', 'center', 'right', 'justify', 'start', 'end'],
  'font-weight': ['300', '400', '500', '600', '700', '800'],
  position: ['static', 'relative', 'absolute', 'fixed', 'sticky'],
  overflow: ['visible', 'hidden', 'auto', 'scroll', 'clip'],
  gap: ['0', '0.5rem', '1rem', '1.5rem', '2rem'],
  width: ['auto', '100%', 'fit-content', 'min-content', 'max-content'],
};

const GROUPS: { title: string; fields: [string, string][] }[] = [
  { title: 'Spacing', fields: [['margin', 'Margin'], ['padding', 'Padding'], ['margin-inline', 'Margin x'], ['margin-block', 'Margin y']] },
  {
    title: 'Size',
    fields: [['width', 'Width'], ['height', 'Height'], ['min-width', 'Min width'], ['max-width', 'Max width'], ['min-height', 'Min height'], ['max-height', 'Max height'], ['aspect-ratio', 'Aspect ratio']],
  },
  {
    title: 'Typography',
    fields: [['font-family', 'Font'], ['font-size', 'Size'], ['font-weight', 'Weight'], ['line-height', 'Line height'], ['color', 'Color'], ['text-align', 'Align'], ['letter-spacing', 'Tracking']],
  },
  {
    title: 'Background & border',
    fields: [['background', 'Background'], ['border', 'Border'], ['border-radius', 'Radius'], ['box-shadow', 'Shadow'], ['opacity', 'Opacity'], ['overflow', 'Overflow']],
  },
  { title: 'Position', fields: [['position', 'Position'], ['inset', 'Inset'], ['top', 'Top'], ['left', 'Left'], ['z-index', 'Z-index']] },
];

/** Properties for the selected branch or leaf; styles edit the current display only. */
@Component({ tag: 'tw-inspector' })
export class TwInspector {
  @State() newClass = '';
  @State() newAttr = { name: '', value: '' };
  @State() newDecl = { prop: '', value: '' };

  private styleField(branch: Branch, prop: string, label: string, opts: FieldOpts = {}) {
    const display = state.display as DisplayId;
    const own = branch.styles[display]?.[prop] ?? '';
    const inherited = inheritedStyles(branch.styles, display)[prop];
    const listId = opts.suggestions || SUGGEST[prop] ? `tw-dl-${prop}` : undefined;
    const commit = (value: string) => setStyleValue(branch.id, prop, value || null);
    return (
      <div class={{ field: true, overridden: own !== '' }} key={`${branch.id}:${display}:${prop}`}>
        <label htmlFor={`f-${prop}`} title={prop}>
          {label}
        </label>
        {opts.options ? (
          <select id={`f-${prop}`} class="select" onChange={(e) => commit((e.target as HTMLSelectElement).value)}>
            <option value="" selected={own === ''}>
              {inherited ? `${inherited} (inherited)` : '—'}
            </option>
            {opts.options.map((o) => (
              <option value={o} selected={own === o}>
                {o}
              </option>
            ))}
          </select>
        ) : (
          <input
            id={`f-${prop}`}
            class="input mono"
            value={own}
            placeholder={inherited ?? opts.placeholder ?? ''}
            list={listId}
            onChange={(e) => commit((e.target as HTMLInputElement).value)}
          />
        )}
        <button class="icon-btn clear" title={`Clear ${prop} on this display`} aria-label={`Clear ${prop}`} onClick={() => commit('')}>
          <Icon name="x" />
        </button>
      </div>
    );
  }

  private renderDatalists() {
    return (
      <div hidden>
        {Object.entries(SUGGEST).map(([prop, values]) => (
          <datalist id={`tw-dl-${prop}`}>
            {values.map((v) => (
              <option value={v} />
            ))}
          </datalist>
        ))}
        <datalist id="tw-dl-tags">
          {TAGS.map((t) => (
            <option value={t} />
          ))}
        </datalist>
        <datalist id="tw-dl-classes">
          {kitClasses(state.forest?.kits ?? []).map((c) => (
            <option value={c} />
          ))}
        </datalist>
      </div>
    );
  }

  private renderHead(node: Branch | Leaf, isRoot: boolean) {
    const display = getDisplay(state.display as DisplayId);
    const inherits = display.inherits.map((d) => getDisplay(d).label).join(' → ');
    return (
      <div class="inspector-head">
        <h2>
          <span class="grow">{isRoot ? 'Tree body' : nodeLabel(node)}</span>
          {!isRoot && (
            <button class="icon-btn" title="Select parent (Esc)" aria-label="Select parent" onClick={selectParent}>
              <Icon name="parent" />
            </button>
          )}
        </h2>
        <div class="tagline">
          {isBranch(node) ? 'branch' : 'leaf'} · {nodeKind(node)}
          {isBranch(node) && node.type ? ` · ${node.type}` : ''}
        </div>
        {isBranch(node) && (
          <div class="display-note">
            <Icon name="info" />
            <span>
              Styling <strong>{display.label}</strong>
              {inherits ? `, inheriting ${inherits}` : ', the base for every display'}.
            </span>
          </div>
        )}
        {isBranch(node) && (
          <div class="overrides" aria-label="Displays with styles">
            {DISPLAYS.map((d) => (
              <span class={{ on: !!node.styles[d.id] }} title={node.styles[d.id] ? `${Object.keys(node.styles[d.id]!).length} styles on ${d.label}` : `No styles on ${d.label}`}>
                {d.short}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }

  private renderLeaf(leaf: Leaf) {
    return (
      <section class="panel-section">
        <h3 class="panel-title">{leaf.type === 'image' ? 'Image leaf' : 'Text leaf'}</h3>
        {leaf.type === 'text' ? (
          <textarea
            key={leaf.id}
            class="textarea prose"
            aria-label="Text"
            rows={5}
            onChange={(e) => updateLeaf(leaf.id, { value: (e.target as HTMLTextAreaElement).value })}
          >
            {leaf.value}
          </textarea>
        ) : (
          [
            <div class="field" key={`${leaf.id}-src`}>
              <label htmlFor="leaf-src">Source</label>
              <input id="leaf-src" class="input mono" value={leaf.value} onChange={(e) => updateLeaf(leaf.id, { value: (e.target as HTMLInputElement).value })} />
            </div>,
            <div class="field" key={`${leaf.id}-alt`}>
              <label htmlFor="leaf-alt">Alt text</label>
              <input
                id="leaf-alt"
                class="input"
                value={leaf.attrs?.alt ?? ''}
                onChange={(e) => updateLeaf(leaf.id, { attrs: { ...leaf.attrs, alt: (e.target as HTMLInputElement).value } })}
              />
            </div>,
          ]
        )}
        <p class="hint">{leaf.type === 'text' ? 'Tip: double-click text in the canvas to edit it in place.' : 'Images are leaves: style them through their parent branch.'}</p>
      </section>
    );
  }

  private renderBranchBasics(branch: Branch, isRoot: boolean) {
    return (
      <section class="panel-section">
        <h3 class="panel-title">Branch</h3>
        <div class="field" key={`${branch.id}-name`}>
          <label htmlFor="b-name">Name</label>
          <input id="b-name" class="input" value={branch.name ?? ''} placeholder={nodeLabel(branch)} onChange={(e) => updateBranch(branch.id, { name: (e.target as HTMLInputElement).value.trim() })} />
        </div>
        {!isRoot && (
          <div class="field" key={`${branch.id}-tag`}>
            <label htmlFor="b-tag">Tag</label>
            <input
              id="b-tag"
              class="input mono"
              value={branch.tag}
              list="tw-dl-tags"
              onChange={(e) => {
                const tag = (e.target as HTMLInputElement).value.trim().toLowerCase();
                if (/^[a-z][a-z0-9-]*$/.test(tag)) updateBranch(branch.id, { tag });
              }}
            />
          </div>
        )}
      </section>
    );
  }

  private renderClasses(branch: Branch) {
    const add = () => {
      const names = this.newClass.split(/\s+/).filter(Boolean);
      if (names.length) updateBranch(branch.id, { classes: [...new Set([...branch.classes, ...names])] });
      this.newClass = '';
    };
    return (
      <section class="panel-section">
        <h3 class="panel-title">Classes</h3>
        {branch.classes.length ? (
          <div class="chips">
            {branch.classes.map((c) => (
              <span class="chip">
                {c}
                <button aria-label={`Remove class ${c}`} onClick={() => updateBranch(branch.id, { classes: branch.classes.filter((x) => x !== c) })}>
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <div class="row">
          <input
            class="input mono grow"
            placeholder="Add a class from your kits…"
            aria-label="Add class"
            list="tw-dl-classes"
            value={this.newClass}
            onInput={(e) => (this.newClass = (e.target as HTMLInputElement).value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
          <button class="btn small" onClick={add} disabled={!this.newClass.trim()}>
            Add
          </button>
        </div>
      </section>
    );
  }

  private renderLayout(branch: Branch) {
    const display = state.display as DisplayId;
    const effective = resolveStyles(branch.styles, display);
    const mode = effective.display ?? '';
    const isGrid = mode.includes('grid');
    const isFlex = mode.includes('flex');
    const columns = countTracks(effective['grid-template-columns']);
    return (
      <details class="group" open>
        <summary>Layout</summary>
        <div class="group-body">
          <div class="row wrap" style={{ marginBottom: '8px' }}>
            <div class="segmented" role="group" aria-label="Layout mode">
              {[
                ['block', 'Block'],
                ['flex', 'Flex'],
                ['grid', 'Grid'],
                ['none', 'Hidden'],
              ].map(([value, label]) => (
                <button aria-pressed={String(mode === value || (value === 'block' && !mode))} onClick={() => setStyleValue(branch.id, 'display', value)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          {this.styleField(branch, 'display', 'Display')}
          {isGrid && [
            <div class="field">
              <label>Columns</label>
              <div class="segmented" role="group" aria-label="Equal columns">
                {[1, 2, 3, 4, 6].map((n) => (
                  <button aria-pressed={String(columns === n)} onClick={() => setStyleValue(branch.id, 'grid-template-columns', n === 1 ? '1fr' : equalColumns(n))}>
                    {n}
                  </button>
                ))}
              </div>
              <span />
            </div>,
            this.styleField(branch, 'grid-template-columns', 'Columns'),
            this.styleField(branch, 'grid-template-rows', 'Rows'),
            this.styleField(branch, 'gap', 'Gap'),
            this.styleField(branch, 'grid-auto-flow', 'Flow'),
            this.styleField(branch, 'justify-items', 'Justify items'),
            this.styleField(branch, 'align-items', 'Align items'),
          ]}
          {isFlex && [
            this.styleField(branch, 'flex-direction', 'Direction', { options: SUGGEST['flex-direction'] }),
            this.styleField(branch, 'flex-wrap', 'Wrap', { options: SUGGEST['flex-wrap'] }),
            this.styleField(branch, 'justify-content', 'Justify'),
            this.styleField(branch, 'align-items', 'Align'),
            this.styleField(branch, 'gap', 'Gap'),
          ]}
        </div>
      </details>
    );
  }

  private renderPlacement(branch: Branch) {
    const parent = parentOf(branch.id);
    if (!parent) return null;
    const mode = resolveStyles(parent.styles, state.display as DisplayId).display ?? '';
    if (!mode.includes('grid') && !mode.includes('flex')) return null;
    return (
      <details class="group" open>
        <summary>In parent {mode.includes('grid') ? 'grid' : 'flex'}</summary>
        <div class="group-body">
          {mode.includes('grid')
            ? [
                this.styleField(branch, 'grid-column', 'Column'),
                this.styleField(branch, 'grid-row', 'Row'),
                this.styleField(branch, 'justify-self', 'Justify self'),
                this.styleField(branch, 'align-self', 'Align self'),
              ]
            : [
                this.styleField(branch, 'flex', 'Flex', { placeholder: '0 1 auto' }),
                this.styleField(branch, 'align-self', 'Align self'),
                this.styleField(branch, 'order', 'Order'),
              ]}
        </div>
      </details>
    );
  }

  private renderTable(branch: Branch) {
    if (branch.tag !== 'table') return null;
    const { rows, columns } = tableSize(branch);
    return (
      <section class="panel-section">
        <h3 class="panel-title">
          Table <span>{rows} × {columns}</span>
        </h3>
        <div class="row wrap">
          <button class="btn small" onClick={() => tableEdit(branch.id, 'add-row')}>
            + Row
          </button>
          <button class="btn small" disabled={rows <= 1} onClick={() => tableEdit(branch.id, 'remove-row', rows - 1)}>
            − Row
          </button>
          <button class="btn small" onClick={() => tableEdit(branch.id, 'add-column')}>
            + Column
          </button>
          <button class="btn small" disabled={columns <= 1} onClick={() => tableEdit(branch.id, 'remove-column', columns - 1)}>
            − Column
          </button>
        </div>
      </section>
    );
  }

  private renderDeclarations(branch: Branch) {
    const display = state.display as DisplayId;
    const own = branch.styles[display] ?? {};
    const entries = Object.entries(own);
    const add = () => {
      const prop = this.newDecl.prop.trim();
      if (prop && this.newDecl.value.trim()) setStyleValue(branch.id, prop, this.newDecl.value);
      this.newDecl = { prop: '', value: '' };
    };
    return (
      <details class="group" open={entries.length > 0}>
        <summary>
          All styles on {getDisplay(display).short}
          {entries.length ? <span class="count">{entries.length}</span> : null}
        </summary>
        <div class="group-body">
          {entries.map(([prop, value]) => (
            <div class="kv" key={`${branch.id}:${display}:decl:${prop}`}>
              <input class="input mono" value={prop} aria-label="Property" readOnly />
              <input class="input mono" value={value} aria-label={`${prop} value`} onChange={(e) => setStyleValue(branch.id, prop, (e.target as HTMLInputElement).value || null)} />
              <button class="icon-btn danger" aria-label={`Remove ${prop}`} onClick={() => setStyleValue(branch.id, prop, null)}>
                <Icon name="x" />
              </button>
            </div>
          ))}
          <div class="kv">
            <input class="input mono" placeholder="property" aria-label="New property" value={this.newDecl.prop} onInput={(e) => (this.newDecl = { ...this.newDecl, prop: (e.target as HTMLInputElement).value })} />
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
        </div>
      </details>
    );
  }

  private renderAttributes(branch: Branch) {
    const entries = Object.entries(branch.attrs);
    const set = (name: string, value: string | null) => {
      const attrs = { ...branch.attrs };
      if (value === null) delete attrs[name];
      else attrs[name] = value;
      updateBranch(branch.id, { attrs });
    };
    const add = () => {
      const name = this.newAttr.name.trim();
      if (/^[a-zA-Z_:][-a-zA-Z0-9_:.]*$/.test(name) && !/^on/i.test(name) && name !== 'class' && name !== 'style') set(name, this.newAttr.value);
      this.newAttr = { name: '', value: '' };
    };
    return (
      <details class="group" open={entries.length > 0}>
        <summary>
          Attributes
          {entries.length ? <span class="count">{entries.length}</span> : null}
        </summary>
        <div class="group-body">
          {entries.map(([name, value]) => (
            <div class="kv" key={`${branch.id}:attr:${name}`}>
              <input class="input mono" value={name} aria-label="Attribute" readOnly />
              <input class="input mono" value={value} aria-label={`${name} value`} onChange={(e) => set(name, (e.target as HTMLInputElement).value)} />
              <button class="icon-btn danger" aria-label={`Remove ${name}`} onClick={() => set(name, null)}>
                <Icon name="x" />
              </button>
            </div>
          ))}
          <div class="kv">
            <input class="input mono" placeholder="name" aria-label="New attribute name" value={this.newAttr.name} onInput={(e) => (this.newAttr = { ...this.newAttr, name: (e.target as HTMLInputElement).value })} />
            <input
              class="input mono"
              placeholder="value"
              aria-label="New attribute value"
              value={this.newAttr.value}
              onInput={(e) => (this.newAttr = { ...this.newAttr, value: (e.target as HTMLInputElement).value })}
              onKeyDown={(e) => e.key === 'Enter' && add()}
            />
            <button class="icon-btn" aria-label="Add attribute" onClick={add}>
              <Icon name="plus" />
            </button>
          </div>
        </div>
      </details>
    );
  }

  private renderActions() {
    return (
      <section class="panel-section">
        <div class="row wrap">
          <button class="btn small" onClick={() => wrapSelected()}>
            <Icon name="wrap" /> Wrap
          </button>
          <button class="btn small" onClick={duplicateSelected}>
            <Icon name="copy" /> Duplicate
          </button>
          <button class="btn small danger" onClick={removeSelected}>
            <Icon name="trash" /> Delete
          </button>
        </div>
      </section>
    );
  }

  render() {
    const tree = currentTree();
    if (!tree) return <p class="empty">No tree selected.</p>;
    const node = ((state.selectedId && findNode(tree.root, state.selectedId)) || tree.root) as Branch | Leaf;
    const isRoot = node.id === tree.root.id;
    return [
      this.renderHead(node, isRoot),
      <div class="panel-body">
        {isBranch(node)
          ? [
              this.renderBranchBasics(node, isRoot),
              this.renderTable(node),
              this.renderClasses(node),
              this.renderLayout(node),
              this.renderPlacement(node),
              GROUPS.map((g) => {
                const count = g.fields.filter(([p]) => node.styles[state.display as DisplayId]?.[p] !== undefined).length;
                return (
                  <details class="group" open={count > 0}>
                    <summary>
                      {g.title}
                      {count ? <span class="count">{count}</span> : null}
                    </summary>
                    <div class="group-body">{g.fields.map(([prop, label]) => this.styleField(node, prop, label))}</div>
                  </details>
                );
              }),
              this.renderDeclarations(node),
              this.renderAttributes(node),
              !isRoot && this.renderActions(),
            ]
          : [this.renderLeaf(node), this.renderActions()]}
        {isRoot && tree.root.children.length === 0 ? <p class="hint" style={{ padding: '0 12px' }}>Select a branch in the canvas or outline to edit it.</p> : null}
        {this.renderDatalists()}
      </div>,
      isRoot ? null : (
        <button class="sr-only" onClick={() => select(null)}>
          Clear selection
        </button>
      ),
    ];
  }
}

