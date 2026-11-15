import { Component, State, h } from '@stencil/core';
import { BLUEPRINT_CATEGORIES, BLUEPRINTS } from '@tree-weaver/branches';
import { groupStories } from '@tree-weaver/formats';
import { STORYBOOK_IMPORT_ENABLED } from '../../config';
import { componentUses, editComponent, insertBlueprint, insertComponent } from '../../store/actions';
import { state, type StorybookLibrary } from '../../store/editor';
import { insertLibraryBranch, libraryDragData, refreshLibrary, removeLibrary } from '../../store/storybook';
import { BLUEPRINT_MIME, COMPONENT_MIME, LIBRARY_MIME } from '../../utils/dnd';
import { Icon } from '../../utils/icons';

/** Two-letter glyph for a Storybook component, e.g. `Bu` for `Example/Button`. */
const glyph = (title: string): string => (title.split('/').pop() ?? title).trim().slice(0, 2);

@Component({ tag: 'tw-palette' })
export class TwPalette {
  @State() query = '';

  /** The forest's reusable components: click to insert an instance, or open one to edit it. */
  private renderComponents(q: string) {
    const list = (state.forest?.components ?? []).filter((c) => !q || `${c.name} ${c.description ?? ''} component`.toLowerCase().includes(q));
    if (!list.length) return null;
    return (
      <section class="panel-section">
        <h3 class="panel-title">Components</h3>
        <div class="palette-grid">
          {list.map((c) => (
            <div class="component-tile">
              <button
                class="blueprint"
                title={`${c.description ?? 'Insert an instance'} · ${componentUses(c.id)} in use`}
                draggable={true}
                onDragStart={(e) => {
                  e.dataTransfer!.setData(COMPONENT_MIME, c.id);
                  e.dataTransfer!.setData('text/plain', c.name);
                  e.dataTransfer!.effectAllowed = 'copy';
                }}
                onClick={() => insertComponent(c.id)}
              >
                <span class="glyph" aria-hidden="true">
                  <Icon name="component" />
                </span>
                <span class="name">{c.name}</span>
              </button>
              <button class="icon-btn component-edit" title={`Edit ${c.name}`} aria-label={`Edit ${c.name}`} onClick={() => editComponent(c.id)}>
                <Icon name="edit" />
              </button>
            </div>
          ))}
        </div>
      </section>
    );
  }

  render() {
    const q = this.query.trim().toLowerCase();
    const matches = BLUEPRINTS.filter((b) => !q || `${b.label} ${b.description} ${b.category}`.toLowerCase().includes(q));
    return [
      <div class="palette-search">
        <input
          class="input"
          type="search"
          placeholder="Find a branch…"
          aria-label="Find a branch"
          value={this.query}
          onInput={(e) => (this.query = (e.target as HTMLInputElement).value)}
        />
        <p class="hint">Click to add into the selection, or drag onto the canvas or outline.</p>
      </div>,
      this.renderComponents(q),
      BLUEPRINT_CATEGORIES.map((category) => {
        const items = matches.filter((b) => b.category === category);
        if (!items.length) return null;
        return (
          <section class="panel-section">
            <h3 class="panel-title">{category}</h3>
            <div class="palette-grid">
              {items.map((b) => (
                <button
                  class="blueprint"
                  title={b.description}
                  draggable={true}
                  onDragStart={(e) => {
                    e.dataTransfer!.setData(BLUEPRINT_MIME, b.id);
                    e.dataTransfer!.setData('text/plain', b.label);
                    e.dataTransfer!.effectAllowed = 'copy';
                  }}
                  onClick={() => insertBlueprint(b.id)}
                >
                  <span class="glyph" aria-hidden="true">
                    {b.glyph}
                  </span>
                  <span class="name">{b.label}</span>
                </button>
              ))}
            </div>
          </section>
        );
      }),
      matches.length === 0 && !this.libraryMatches(q) ? <p class="empty">No branches match “{this.query}”.</p> : null,
      state.libraries.map((lib) => this.renderLibrary(lib, q)),
      STORYBOOK_IMPORT_ENABLED ? (
        <section class="panel-section">
          <button class="btn block" onClick={() => (state.dialog = 'storybook')}>
            <Icon name="upload" /> Import from Storybook…
          </button>
        </section>
      ) : null,
    ];
  }

  private libraryMatches(q: string): boolean {
    return state.libraries.some((lib) => lib.items.some((i) => !q || `${i.title} ${i.name}`.toLowerCase().includes(q)));
  }

  private renderLibrary(lib: StorybookLibrary, q: string) {
    const items = lib.items.filter((i) => !q || `${i.title} ${i.name} ${lib.name}`.toLowerCase().includes(q));
    if (q && !items.length) return null;
    const loading = state.librariesLoading.includes(lib.id);
    return (
      <section class="panel-section library">
        <h3 class="panel-title">
          <span class="grow" title={lib.source}>
            From Storybook: {lib.name}
          </span>
          <span class="row">
            <button class="icon-btn" aria-label={`Read “${lib.name}” again`} title="Read the Storybook again" disabled={loading} onClick={() => refreshLibrary(lib.id)}>
              <Icon name="refresh" />
            </button>
            {lib.env ? null : (
              <button class="icon-btn" aria-label={`Remove “${lib.name}”`} title="Remove this library from the palette" onClick={() => removeLibrary(lib.id)}>
                <Icon name="trash" />
              </button>
            )}
          </span>
        </h3>
        {loading ? <p class="hint">Reading stories…</p> : null}
        {groupStories(items).map((group) => (
          <div class="library-group">
            <h4 class="library-title">{group.title}</h4>
            <div class="palette-grid">
              {group.stories.map((item) => (
                <button
                  class="blueprint"
                  title={`${item.title} / ${item.name}`}
                  draggable={true}
                  onDragStart={(e) => {
                    e.dataTransfer!.setData(LIBRARY_MIME, libraryDragData(lib.id, item.id));
                    e.dataTransfer!.setData('text/plain', item.name);
                    e.dataTransfer!.effectAllowed = 'copy';
                  }}
                  onClick={() => insertLibraryBranch(lib.id, item.id)}
                >
                  <span class="glyph" aria-hidden="true">
                    {glyph(item.title)}
                  </span>
                  <span class="name">{item.name}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>
    );
  }
}
