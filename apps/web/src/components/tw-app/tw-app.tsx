import { Component, Host, Listen, State, h } from '@stencil/core';
import { init, toast } from '../../store/actions';
import { state } from '../../store/editor';
import { handleShortcut } from '../../utils/shortcuts';

@Component({ tag: 'tw-app' })
export class TwApp {
  @State() leftOpen = false;
  @State() rightOpen = false;

  async componentWillLoad() {
    try {
      await init();
    } catch (err) {
      console.error(err);
      toast(`Tree Weaver could not start: ${(err as Error).message}`, 'error');
    }
  }

  @Listen('keydown', { target: 'window' })
  onKey(ev: KeyboardEvent) {
    handleShortcut(ev);
  }

  @Listen('twTogglePanel')
  onToggle(ev: CustomEvent<'left' | 'right'>) {
    if (ev.detail === 'left') {
      this.leftOpen = !this.leftOpen;
      this.rightOpen = false;
    } else {
      this.rightOpen = !this.rightOpen;
      this.leftOpen = false;
    }
  }

  render() {
    return (
      <Host class={{ 'left-open': this.leftOpen, 'right-open': this.rightOpen }}>
        {state.ready && state.forest ? (
          [<tw-toolbar />, <tw-sidebar />, <tw-canvas />, <tw-inspector />, state.dialog ? <tw-io-dialog mode={state.dialog} /> : null]
        ) : (
          <div class="app-loading">Gathering your forests…</div>
        )}
        <div class="toasts" role="status" aria-live="polite">
          {state.toasts.map((t) => (
            <div class={`toast ${t.tone}`} key={t.id}>
              {t.message}
            </div>
          ))}
        </div>
      </Host>
    );
  }
}
