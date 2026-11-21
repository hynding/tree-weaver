import { Component, State, h } from '@stencil/core';
import {
  COMPONENT_PROP_TYPES,
  componentProps,
  DISPLAYS,
  findNode,
  isBranch,
  isPropName,
  isPropOn,
  type Branch,
  type ComponentDef,
  type ComponentInstance,
  type ComponentProp,
  type ComponentPropType,
  type DisplayId,
} from '@tree-weaver/core';
import {
  componentUses,
  currentTree,
  deleteComponent,
  detachInstanceAt,
  editComponent,
  editComponentDef,
  editingComponent,
  instanceOwner,
  leaveComponent,
  saveAsComponent,
  select,
  setComponentVariant,
  updateInstance,
} from '../../store/actions';
import { state } from '../../store/editor';
import { Icon } from '../../utils/icons';

/**
 * Reusable components in the inspector: the component being edited (name, props, variants),
 * the instance the selection belongs to (prop values, a variant per display), or a button to
 * save the selected branch as a component.
 */
@Component({ tag: 'tw-component-panel' })
export class TwComponentPanel {
  @State() saveName = '';
  @State() saving = false;
  @State() newProp = '';
  @State() newVariant = '';

  /* ------------------------------------------------------ editing a component */

  private setProp(def: ComponentDef, name: string, patch: Partial<ComponentProp>) {
    const all = componentProps(def);
    const props = all.map((p) => (p.name === name ? { ...p, ...patch } : p));
    editComponentDef(def.id, (d) => ({ ...d, props }));
  }

  private addProp(def: ComponentDef) {
    const name = this.newProp.trim();
    if (!isPropName(name) || componentProps(def).some((p) => p.name === name)) return;
    editComponentDef(def.id, (d) => ({ ...d, props: [...componentProps(d), { name, type: 'text', default: '' }] }));
    this.newProp = '';
  }

  private removeProp(def: ComponentDef, name: string) {
    editComponentDef(def.id, (d) => ({ ...d, props: d.props.filter((p) => p.name !== name) }));
  }

  private addVariant(def: ComponentDef) {
    const name = this.newVariant.trim();
    if (!name || name === '-' || def.variants.some((v) => v.name === name)) return;
    editComponentDef(def.id, (d) => ({ ...d, variants: [...d.variants, { name, styles: {} }] }), `Added variant “${name}”`);
    this.newVariant = '';
    setComponentVariant(name);
  }

  private removeVariant(def: ComponentDef, name: string) {
    if (state.componentVariant === name) setComponentVariant(null);
    editComponentDef(def.id, (d) => ({ ...d, variants: d.variants.filter((v) => v.name !== name) }));
  }

  private renderEditing(def: ComponentDef) {
    const props = componentProps(def);
    const uses = componentUses(def.id);
    return (
      <section class="component-panel editing">
        <div class="component-banner">
          <Icon name="component" />
          <span class="grow">
            Editing component <strong>{def.name}</strong>
            <span class="meta"> · {uses === 1 ? '1 instance' : `${uses} instances`} follow</span>
          </span>
          <button class="btn small" onClick={() => leaveComponent()}>
            Done
          </button>
        </div>
        <div class="field">
          <label htmlFor="component-name">Name</label>
          <input id="component-name" class="input" value={def.name} onChange={(e) => editComponentDef(def.id, (d) => ({ ...d, name: (e.target as HTMLInputElement).value.trim() || d.name }))} />
        </div>
        <div class="field">
          <label htmlFor="component-variant">Showing</label>
          <select id="component-variant" class="input" onChange={(e) => setComponentVariant((e.target as HTMLSelectElement).value || null)}>
            <option value="" selected={!state.componentVariant}>
              Base styles
            </option>
            {def.variants.map((v) => (
              <option value={v.name} selected={v.name === state.componentVariant}>
                Variant: {v.name}
              </option>
            ))}
          </select>
        </div>
        <p class="hint">
          {state.componentVariant
            ? `Style changes now go into the “${state.componentVariant}” variant, per display. Text and structure changes go into the component.`
            : 'Changes here update every instance. Use {{name}} in text, links, image URLs or classes for props; add data-show-if="prop" to a branch to show it only when the prop is set.'}
        </p>

        <h4 class="sub-title">Props</h4>
        {props.length === 0 ? <p class="hint">No props yet. Type {'{{title}}'} into a text, or add one here.</p> : null}
        {props.map((p) => (
          <div class="prop-row" key={p.name}>
            <code class="prop-name">{p.name}</code>
            <select class="token-kind" aria-label={`Type of ${p.name}`} onChange={(e) => this.setProp(def, p.name, { type: (e.target as HTMLSelectElement).value as ComponentPropType })}>
              {COMPONENT_PROP_TYPES.map((t) => (
                <option value={t} selected={t === p.type}>
                  {t}
                </option>
              ))}
            </select>
            {p.type === 'boolean' ? (
              <label class="check">
                <input type="checkbox" checked={isPropOn(p.default)} onChange={(e) => this.setProp(def, p.name, { default: (e.target as HTMLInputElement).checked ? 'true' : '' })} /> on
              </label>
            ) : (
              <input class="input grow" placeholder="Default" aria-label={`Default ${p.name}`} value={p.default} onChange={(e) => this.setProp(def, p.name, { default: (e.target as HTMLInputElement).value })} />
            )}
            <button class="icon-btn" title="Remove prop (its placeholders stay)" disabled={!def.props.some((q) => q.name === p.name)} onClick={() => this.removeProp(def, p.name)}>
              <Icon name="trash" />
            </button>
            {p.type === 'enum' ? (
              <input
                class="input prop-options"
                placeholder="Options, comma separated"
                aria-label={`Options of ${p.name}`}
                value={(p.options ?? []).join(', ')}
                onChange={(e) =>
                  this.setProp(def, p.name, {
                    options: (e.target as HTMLInputElement).value
                      .split(',')
                      .map((o) => o.trim())
                      .filter(Boolean),
                  })
                }
              />
            ) : null}
          </div>
        ))}
        <div class="row">
          <input class="input grow" placeholder="New prop name" aria-label="New prop name" value={this.newProp} onInput={(e) => (this.newProp = (e.target as HTMLInputElement).value)} onKeyDown={(e) => e.key === 'Enter' && (this.addProp(def), ((e.target as HTMLInputElement).value = this.newProp))} />
          <button class="btn small" disabled={!isPropName(this.newProp.trim())} onClick={() => this.addProp(def)}>
            Add prop
          </button>
        </div>

        <h4 class="sub-title">Variants</h4>
        {def.variants.length === 0 ? <p class="hint">Variants are named sets of style changes, such as “compact” or “stacked”. Instances can use a different one on each display.</p> : null}
        {def.variants.map((v) => (
          <div class="list-item" key={v.name}>
            <span class="title" onClick={() => setComponentVariant(v.name)}>
              {v.name}
              <span class="meta"> · {Object.keys(v.styles).length} branches styled</span>
            </span>
            <button class="icon-btn" title="Show and edit this variant" aria-pressed={String(state.componentVariant === v.name)} onClick={() => setComponentVariant(v.name)}>
              <Icon name="edit" />
            </button>
            <button class="icon-btn danger" title="Delete variant" onClick={() => this.removeVariant(def, v.name)}>
              <Icon name="trash" />
            </button>
          </div>
        ))}
        <div class="row">
          <input class="input grow" placeholder="New variant name" aria-label="New variant name" value={this.newVariant} onInput={(e) => (this.newVariant = (e.target as HTMLInputElement).value)} onKeyDown={(e) => e.key === 'Enter' && (this.addVariant(def), ((e.target as HTMLInputElement).value = this.newVariant))} />
          <button class="btn small" disabled={!this.newVariant.trim()} onClick={() => this.addVariant(def)}>
            Add variant
          </button>
        </div>
        <div class="row" style={{ marginTop: '10px' }}>
          <button class="btn small danger" onClick={() => confirm(`Delete the component “${def.name}”? Its instances keep their content as plain branches.`) && deleteComponent(def.id)}>
            <Icon name="trash" /> Delete component
          </button>
        </div>
      </section>
    );
  }

  /* ------------------------------------------------------------- an instance */

  private setValue(inst: Branch, name: string, value: string) {
    updateInstance(inst.id, (i) => {
      const props = { ...i.props, [name]: value };
      return { ...i, props };
    });
  }

  private setVariant(inst: Branch, display: DisplayId, value: string) {
    updateInstance(inst.id, (i): ComponentInstance => {
      const variants = { ...i.variants };
      if (value === '') delete variants[display];
      else variants[display] = value;
      const out: ComponentInstance = { ...i, variants };
      if (!Object.keys(variants).length) delete out.variants;
      return out;
    });
  }

  private renderInstance(inst: Branch, selected: boolean) {
    const def = state.forest?.components?.find((c) => c.id === inst.instance!.component);
    if (!def)
      return (
        <section class="component-panel">
          <p class="hint">This branch was an instance of a component that is not in this forest.</p>
          <button class="btn small" onClick={() => detachInstanceAt(inst.id)}>
            Keep as plain branches
          </button>
        </section>
      );
    const values = inst.instance!.props ?? {};
    const picks = inst.instance!.variants ?? {};
    return (
      <section class="component-panel">
        <div class="component-banner">
          <Icon name="component" />
          <span class="grow">
            Instance of <strong>{def.name}</strong>
          </span>
          <button class="btn small" title="Open the component to change it everywhere" onClick={() => editComponent(def.id)}>
            Edit component
          </button>
        </div>
        {!selected ? (
          <p class="hint">
            This branch is part of the instance and follows the component.{' '}
            <a href="#" onClick={(e) => (e.preventDefault(), select(inst.id))}>
              Select the instance
            </a>{' '}
            to set its props, or detach it to edit freely.
          </p>
        ) : null}
        {componentProps(def).map((p) => {
          const value = values[p.name] ?? p.default;
          const id = `prop-${inst.id}-${p.name}`;
          return (
            <div class="field" key={p.name}>
              <label htmlFor={id}>{p.name}</label>
              {p.type === 'boolean' ? (
                <input id={id} type="checkbox" checked={isPropOn(value)} onChange={(e) => this.setValue(inst, p.name, (e.target as HTMLInputElement).checked ? 'true' : '')} />
              ) : p.type === 'enum' && p.options?.length ? (
                <select id={id} class="input" onChange={(e) => this.setValue(inst, p.name, (e.target as HTMLSelectElement).value)}>
                  {(p.options.includes(value) ? p.options : [value, ...p.options]).map((o) => (
                    <option value={o} selected={o === value}>
                      {o || '(none)'}
                    </option>
                  ))}
                </select>
              ) : (
                <input id={id} class="input" type={p.type === 'url' || p.type === 'image' ? 'url' : 'text'} value={value} placeholder={p.default} onChange={(e) => this.setValue(inst, p.name, (e.target as HTMLInputElement).value)} />
              )}
            </div>
          );
        })}
        {def.variants.length ? (
          <div class="variant-grid">
            <p class="hint">Variant per display. Displays set to “inherit” use the variant of the display they inherit from.</p>
            {DISPLAYS.map((d) => (
              <div class="field" key={d.id}>
                <label htmlFor={`variant-${inst.id}-${d.id}`} class={{ current: state.display === d.id }}>
                  {d.label}
                </label>
                <select id={`variant-${inst.id}-${d.id}`} class="input" onChange={(e) => this.setVariant(inst, d.id, (e.target as HTMLSelectElement).value)}>
                  <option value="" selected={picks[d.id] === undefined}>
                    {d.id === 'lg' ? 'Base' : 'Inherit'}
                  </option>
                  {d.id !== 'lg' ? (
                    <option value="-" selected={picks[d.id] === '-'}>
                      Base
                    </option>
                  ) : null}
                  {def.variants.map((v) => (
                    <option value={v.name} selected={picks[d.id] === v.name}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        ) : null}
        <div class="row">
          <button class="btn small" title="Keep the content as plain branches, no longer linked to the component" onClick={() => detachInstanceAt(inst.id)}>
            Detach
          </button>
        </div>
      </section>
    );
  }

  /* ------------------------------------------------------------- save as */

  private save(node: Branch) {
    const def = saveAsComponent(node.id, this.saveName || node.name || 'Component');
    if (def) {
      this.saving = false;
      this.saveName = '';
    }
  }

  private renderSave(node: Branch, isRoot: boolean) {
    if (!this.saving)
      return (
        <div class="row component-save">
          <button class="btn small" title="Reuse this branch in any tree, with props and variants" onClick={() => ((this.saving = true), (this.saveName = node.name ?? ''))}>
            <Icon name="component" /> {isRoot ? 'Save tree as component' : 'Save as component'}
          </button>
        </div>
      );
    return (
      <div class="row component-save">
        <input
          class="input grow"
          placeholder="Component name"
          aria-label="Component name"
          value={this.saveName}
          ref={(el) => el?.focus()}
          onInput={(e) => (this.saveName = (e.target as HTMLInputElement).value)}
          onKeyDown={(e) => (e.key === 'Enter' ? this.save(node) : e.key === 'Escape' && (this.saving = false))}
        />
        <button class="btn small" onClick={() => this.save(node)}>
          Save
        </button>
      </div>
    );
  }

  render() {
    const editing = editingComponent();
    if (editing) return this.renderEditing(editing);
    const tree = currentTree();
    if (!tree) return null;
    const node = (state.selectedId && findNode(tree.root, state.selectedId)) || tree.root;
    if (!isBranch(node)) return null;
    const owner = instanceOwner(tree.root, node.id);
    if (owner) return this.renderInstance(owner, owner.id === node.id);
    if (tree.root.tag === 'svg') return null;
    return this.renderSave(node, node.id === tree.root.id);
  }
}
