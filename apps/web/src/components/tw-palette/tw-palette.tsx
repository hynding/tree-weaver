import { Component, State, h } from '@stencil/core';
import { BLUEPRINT_CATEGORIES, BLUEPRINTS } from '@tree-weaver/branches';
import { insertBlueprint } from '../../store/actions';
import { BLUEPRINT_MIME } from '../../utils/dnd';

@Component({ tag: 'tw-palette' })
export class TwPalette {
  @State() query = '';

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
      matches.length === 0 ? <p class="empty">No branches match “{this.query}”.</p> : null,
    ];
  }
}
