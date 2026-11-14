import { Component, State, h } from '@stencil/core';
import { state } from '../../store/editor';
import { setMyName, startSharing, stopSharing } from '../../store/collab';
import { Icon } from '../../utils/icons';
import { PEER_COLORS } from '../../utils/peers';

/** Share the open forest by link and see who is editing it. */
@Component({ tag: 'tw-share-dialog' })
export class TwShareDialog {
  @State() copied = false;

  private dialogEl?: HTMLElement;

  componentDidLoad() {
    this.dialogEl?.querySelector<HTMLElement>('input, button.primary')?.focus();
  }

  private close = () => {
    state.dialog = null;
  };

  private async copy() {
    try {
      await navigator.clipboard.writeText(state.collabLink);
      this.copied = true;
      setTimeout(() => (this.copied = false), 1600);
    } catch {
      this.dialogEl?.querySelector<HTMLInputElement>('#share-link')?.select();
    }
  }

  private renderOff() {
    return [
      <p class="hint" style={{ margin: '0' }}>
        Anyone with the link can open <strong>{state.forest?.name}</strong> and edit it with you in real time. Changes go straight between your browsers, encrypted
        with a key that is only in the link; nothing is stored on a server. Each person keeps a copy of the forest in their own browser.
      </p>,
      <p class="hint">Changes merge branch by branch, so you can work on the same tree at once. Undo takes back only your own changes.</p>,
    ];
  }

  private renderPeople() {
    const peers = state.collabPeers;
    return (
      <section>
        <h3 class="sub-title">People here</h3>
        <ul class="people">
          <li>
            <span class="peer-dot" style={{ background: PEER_COLORS[state.collabColor] }} />
            <input
              class="input grow"
              aria-label="Your name"
              value={state.collabName}
              onChange={(e) => setMyName((e.target as HTMLInputElement).value)}
              title="The name others see"
            />
            <span class="hint">you</span>
          </li>
          {peers.map((p) => (
            <li key={p.id}>
              <span class="peer-dot" style={{ background: PEER_COLORS[p.color] }} />
              <span class="grow">{p.name}</span>
              <span class="hint">{state.forest?.trees.find((t) => t.id === p.treeId)?.name ?? ''}</span>
            </li>
          ))}
        </ul>
        {!peers.length && <p class="hint">Nobody else is here yet. Send the link, and people show up here when they open it.</p>}
      </section>
    );
  }

  render() {
    const status = state.collabStatus;
    return (
      <div class="dialog-backdrop" onClick={(e) => e.target === e.currentTarget && this.close()} onKeyDown={(e) => e.key === 'Escape' && this.close()}>
        <div class="dialog share-dialog" role="dialog" aria-modal="true" aria-labelledby="share-title" ref={(el) => (this.dialogEl = el)}>
          <header>
            <h2 id="share-title">{status === 'joining' ? 'Joining a shared forest' : 'Share this forest'}</h2>
            <button class="icon-btn" aria-label="Close" onClick={this.close}>
              <Icon name="x" />
            </button>
          </header>
          <div class="dialog-body">
            {status === 'off' && this.renderOff()}
            {status === 'joining' && (
              <p class="notice" role="status">
                Waiting for someone in the room to send the forest. This needs at least one person who has it open; it appears as soon as they connect.
              </p>
            )}
            {status !== 'off' && (
              <div class="row">
                <input id="share-link" class="input grow mono" readOnly value={state.collabLink} aria-label="Share link" onFocus={(e) => (e.target as HTMLInputElement).select()} />
                <button class="btn" onClick={() => void this.copy()}>
                  <Icon name="copy" /> {this.copied ? 'Copied' : 'Copy link'}
                </button>
              </div>
            )}
            {status !== 'off' && this.renderPeople()}
          </div>
          <footer>
            {status === 'off' ? (
              [
                <button class="btn" onClick={this.close}>
                  Cancel
                </button>,
                <button class="btn primary" onClick={() => startSharing()}>
                  <Icon name="link" /> Start sharing
                </button>,
              ]
            ) : (
              [
                <button class="btn danger" onClick={() => stopSharing()}>
                  {status === 'joining' ? 'Cancel' : 'Stop sharing'}
                </button>,
                <button class="btn primary" onClick={this.close}>
                  Done
                </button>,
              ]
            )}
          </footer>
        </div>
      </div>
    );
  }
}
