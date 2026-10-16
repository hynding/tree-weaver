import { Component, State, h } from '@stencil/core';
import {
  countTracks,
  DISPLAYS,
  equalColumns,
  findNode,
  formatAutoColumns,
  formatSpan,
  formatTracks,
  getDisplay,
  inheritedStyles,
  isBranch,
  parseAutoColumns,
  parseSpan,
  parseTracks,
  resolveStyles,
  tableSize,
  trackLabel,
  type Branch,
  type DisplayId,
  type GridSpan,
  type GridTrack,
  type Leaf,
  type StyleMap,
} from '@tree-weaver/core';
import { kitClasses } from '@tree-weaver/kits';
import {
  allKits,
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
          {kitClasses(allKits()).map((c) => (
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
            this.renderColumns(branch, effective),
            this.styleField(branch, 'gap', 'Gap'),
            this.styleField(branch, 'justify-items', 'Justify items'),
            this.styleField(branch, 'align-items', 'Align items'),
            <details class="advanced">
              <summary>Advanced grid CSS</summary>
              {this.styleField(branch, 'grid-template-columns', 'Columns')}
              {this.styleField(branch, 'grid-template-rows', 'Rows')}
              {this.styleField(branch, 'grid-auto-flow', 'Flow')}
            </details>,
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
            ? this.renderGridPlacement(branch, parent)
            : [
                this.styleField(branch, 'flex', 'Flex', { placeholder: '0 1 auto' }),
                this.styleField(branch, 'align-self', 'Align self'),
                this.styleField(branch, 'order', 'Order'),
              ]}
        </div>
      </details>
    );
  }

  /** Write a grid value; the default (`null`) still overrides an inherited value with `auto`. */
  private setGridValue(branch: Branch, prop: string, value: string | null) {
    const inherited = inheritedStyles(branch.styles, state.display as DisplayId)[prop];
    setStyleValue(branch.id, prop, value ?? (inherited && inherited !== 'auto' ? 'auto' : null));
  }

  /** Columns as a list of plain choices, with a proportional preview. */
  private renderColumns(branch: Branch, effective: StyleMap) {
    const display = state.display as DisplayId;
    const template = effective['grid-template-columns'];
    const own = branch.styles[display]?.['grid-template-columns'];
    const inherited = inheritedStyles(branch.styles, display)['grid-template-columns'];
    const auto = parseAutoColumns(template);
    const tracks = auto ? null : parseTracks(template);
    const set = (value: string) => setStyleValue(branch.id, 'grid-template-columns', value);
    const setTracks = (next: GridTrack[]) => set(formatTracks(next));
    const count = tracks ? tracks.length : countTracks(template);
    const equal = tracks?.every((t) => t.kind === 'share' && t.value === 1) ?? false;
    return (
      <div class="grid-columns" key={`${branch.id}:${display}:columns`}>
        <div class="grid-columns-head">
          <span class={{ 'grid-label': true, overridden: !!own }}>Columns</span>
          <div class="segmented" role="group" aria-label="How columns are set">
            <button aria-pressed={String(!auto)} title="A set number of columns" onClick={() => auto && setTracks([1, 2, 3].map(() => ({ kind: 'share', value: 1 })))}>
              Set number
            </button>
            <button aria-pressed={String(!!auto)} title="As many columns as fit; they wrap onto new rows on smaller screens" onClick={() => !auto && set(formatAutoColumns({ minWidth: '220px' }))}>
              Wrap to fit
            </button>
          </div>
        </div>
        {auto ? (
          [
            <div class="field">
              <label htmlFor="grid-min-width">Min width</label>
              <input
                id="grid-min-width"
                class="input mono"
                value={auto.minWidth}
                onChange={(e) => {
                  const minWidth = (e.target as HTMLInputElement).value.trim();
                  if (minWidth) set(formatAutoColumns({ minWidth }));
                }}
              />
              <span />
            </div>,
            <p class="hint">Fits as many columns as it can, each at least this wide. Extra boxes wrap onto new rows as the screen narrows.</p>,
          ]
        ) : (
          [
            <div class="row wrap grid-quick">
              <span class="grid-sub">Equal</span>
              <div class="segmented" role="group" aria-label="Equal columns">
                {[1, 2, 3, 4, 6].map((n) => (
                  <button aria-pressed={String(equal && count === n)} onClick={() => set(n === 1 ? 'minmax(0, 1fr)' : equalColumns(n))}>
                    {n}
                  </button>
                ))}
              </div>
            </div>,
            tracks ? (
              [
                tracks.length ? this.renderColumnPreview(tracks, getDisplay(display).width) : null,
                <ol class="tracks">
                  {tracks.map((track, i) => this.renderTrack(track, i, tracks, setTracks))}
                </ol>,
                <div class="row">
                  <button class="btn small" onClick={() => setTracks([...tracks, { kind: 'share', value: 1 }])}>
                    <Icon name="plus" /> Add column
                  </button>
                </div>,
              ]
            ) : (
              <p class="hint">These columns use a custom CSS pattern. Edit it under Advanced, or pick a number above to start over.</p>
            ),
          ]
        )}
        {own && inherited && display !== 'lg' ? (
          <button class="link-btn" onClick={() => setStyleValue(branch.id, 'grid-template-columns', null)}>
            Use the same columns as {getDisplay(getDisplay(display).inherits.slice(-1)[0] ?? 'lg').label}
          </button>
        ) : !own && inherited ? (
          <p class="hint">Same as {getDisplay(getDisplay(display).inherits.slice(-1)[0] ?? 'lg').label}. Changes here apply to {getDisplay(display).label} only.</p>
        ) : null}
      </div>
    );
  }

  private renderTrack(track: GridTrack, index: number, tracks: GridTrack[], setTracks: (next: GridTrack[]) => void) {
    const replace = (next: GridTrack) => setTracks(tracks.map((t, i) => (i === index ? next : t)));
    const changeKind = (kind: GridTrack['kind']) => {
      if (kind === 'share') replace({ kind, value: 1 });
      else if (kind === 'fixed') replace({ kind, value: '240px' });
      else if (kind === 'fit') replace({ kind });
      else replace({ kind, value: track.kind === 'custom' ? track.value : formatTracks([track]) });
    };
    return (
      <li class="track" key={`track-${index}`}>
        <span class="track-num" aria-hidden="true">
          {index + 1}
        </span>
        <select class="select" aria-label={`Column ${index + 1} sizing`} onChange={(e) => changeKind((e.target as HTMLSelectElement).value as GridTrack['kind'])}>
          {(
            [
              ['share', 'Share of space'],
              ['fixed', 'Fixed width'],
              ['fit', 'Fit content'],
              ['custom', 'Custom CSS'],
            ] as const
          ).map(([kind, label]) => (
            <option value={kind} selected={track.kind === kind}>
              {label}
            </option>
          ))}
        </select>
        {track.kind === 'share' ? (
          <input
            class="input"
            type="number"
            min="0.25"
            step="0.25"
            value={String(track.value)}
            aria-label={`Column ${index + 1} shares`}
            title="How many shares of the free space this column gets"
            onChange={(e) => {
              const value = Number((e.target as HTMLInputElement).value);
              if (value > 0) replace({ kind: 'share', value });
            }}
          />
        ) : track.kind === 'fit' ? (
          <span class="track-fit">auto</span>
        ) : (
          <input
            class="input mono"
            value={track.value}
            aria-label={`Column ${index + 1} width`}
            onChange={(e) => {
              const value = (e.target as HTMLInputElement).value.trim();
              if (value) replace({ kind: track.kind, value });
            }}
          />
        )}
        <button class="icon-btn" title="Remove column" aria-label={`Remove column ${index + 1}`} disabled={tracks.length <= 1} onClick={() => setTracks(tracks.filter((_, i) => i !== index))}>
          <Icon name="x" />
        </button>
      </li>
    );
  }

  /** A bar showing how wide each column is on the current display. */
  private renderColumnPreview(tracks: GridTrack[], width: number) {
    const px = (len: string): number | null => {
      const m = /^([\d.]+)(px|rem|em|%|vw)$/.exec(len);
      if (!m) return null;
      const n = Number(m[1]);
      return m[2] === 'px' ? n : m[2] === '%' || m[2] === 'vw' ? (n / 100) * width : n * 16;
    };
    const fixed = tracks.map((t) => (t.kind === 'fixed' ? px(t.value) : t.kind === 'fit' ? 120 : null));
    const shares = tracks.map((t, i) => (fixed[i] !== null ? 0 : t.kind === 'share' ? t.value : 1));
    const free = Math.max(0, width - fixed.reduce<number>((a, b) => a + (b ?? 0), 0));
    const totalShares = shares.reduce((a, b) => a + b, 0) || 1;
    const sizes = tracks.map((_, i) => fixed[i] ?? (shares[i] / totalShares) * free);
    const total = sizes.reduce((a, b) => a + b, 0) || 1;
    return (
      <div class="grid-preview" aria-hidden="true">
        {tracks.map((t, i) => (
          <span style={{ flexGrow: String(sizes[i] / total), flexBasis: '0' }} title={trackLabel(t)}>
            {trackLabel(t)}
          </span>
        ))}
      </div>
    );
  }

  /** Span and start controls for a branch inside a grid. */
  private renderGridPlacement(branch: Branch, parent: Branch) {
    const display = state.display as DisplayId;
    const parentStyles = resolveStyles(parent.styles, display);
    const own = resolveStyles(branch.styles, display);
    const tracks = parseTracks(parentStyles['grid-template-columns']);
    const count = tracks?.length ?? 0;
    const col = parseSpan(own['grid-column']);
    const row = parseSpan(own['grid-row']);
    const setCol = (next: GridSpan) => this.setGridValue(branch, 'grid-column', formatSpan(next));
    const setRow = (next: GridSpan) => this.setGridValue(branch, 'grid-row', formatSpan(next));
    const spans = Array.from({ length: Math.min(Math.max(count, 3), 6) }, (_, i) => i + 1);
    return [
      col ? (
        [
          <div class="field" key={`${branch.id}:${display}:wide`}>
            <label title="grid-column">Width</label>
            <div class="segmented" role="group" aria-label="Columns wide">
              {spans.map((n) => (
                <button aria-pressed={String(!col.full && col.span === n)} title={`${n} ${n === 1 ? 'column' : 'columns'} wide`} onClick={() => setCol({ start: col.start, span: n, full: false })}>
                  {n}
                </button>
              ))}
              <button aria-pressed={String(col.full)} title="Stretch across the whole row" onClick={() => setCol({ start: 1, span: 1, full: true })}>
                Full
              </button>
            </div>
            <span />
          </div>,
          count > 1 && !col.full ? (
            <div class="field" key={`${branch.id}:${display}:start`}>
              <label htmlFor="grid-start">Start in</label>
              <select
                id="grid-start"
                class="select"
                onChange={(e) => {
                  const v = (e.target as HTMLSelectElement).value;
                  setCol({ start: v ? Number(v) : null, span: col.span, full: false });
                }}
              >
                <option value="" selected={col.start === null}>
                  Next free spot
                </option>
                {Array.from({ length: count }, (_, i) => (
                  <option value={String(i + 1)} selected={col.start === i + 1}>
                    Column {i + 1}
                  </option>
                ))}
              </select>
              <span />
            </div>
          ) : null,
        ]
      ) : (
        <p class="hint">Placed with custom CSS ({own['grid-column']}). Change it under Advanced.</p>
      ),
      row ? (
        <div class="field" key={`${branch.id}:${display}:tall`}>
          <label title="grid-row">Height</label>
          <div class="segmented" role="group" aria-label="Rows tall">
            {[1, 2, 3].map((n) => (
              <button aria-pressed={String(!row.full && row.span === n)} title={`${n} ${n === 1 ? 'row' : 'rows'} tall`} onClick={() => setRow({ start: row.start, span: n, full: false })}>
                {n} {n === 1 ? 'row' : 'rows'}
              </button>
            ))}
          </div>
          <span />
        </div>
      ) : null,
      this.styleField(branch, 'justify-self', 'Justify self'),
      this.styleField(branch, 'align-self', 'Align self'),
      <p class="hint">Tip: drag the handle on the right edge of the selected box in the canvas to change how many columns it covers.</p>,
      <details class="advanced">
        <summary>Advanced grid CSS</summary>
        {this.styleField(branch, 'grid-column', 'Column')}
        {this.styleField(branch, 'grid-row', 'Row')}
      </details>,
    ];
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

