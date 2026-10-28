import { Component, h } from '@stencil/core';
import { setTab } from '../../store/actions';
import { state, type SidebarTab } from '../../store/editor';

const TABS: { id: SidebarTab; label: string }[] = [
  { id: 'branches', label: 'Branches' },
  { id: 'outline', label: 'Outline' },
  { id: 'classes', label: 'Classes' },
  { id: 'kits', label: 'Kits' },
  { id: 'forest', label: 'Forest' },
];

@Component({ tag: 'tw-sidebar' })
export class TwSidebar {
  render() {
    return [
      <div class="tabs" role="tablist" aria-label="Panels">
        {TABS.map((t) => (
          <button role="tab" id={`tab-${t.id}`} aria-selected={String(state.tab === t.id)} aria-controls="sidebar-panel" onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>,
      <div class="panel-body" id="sidebar-panel" role="tabpanel" aria-labelledby={`tab-${state.tab}`}>
        {state.tab === 'branches' && <tw-palette />}
        {state.tab === 'outline' && <tw-outline />}
        {state.tab === 'classes' && <tw-classes-panel />}
        {state.tab === 'kits' && <tw-kits-panel />}
        {state.tab === 'forest' && <tw-forest-panel />}
      </div>,
    ];
  }
}
