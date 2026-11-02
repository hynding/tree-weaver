import { Component, State, h } from '@stencil/core';
import {
  changedDisplaySettings,
  DISPLAY_MAX_PX,
  DISPLAY_MIN_PX,
  DISPLAYS,
  formatDisplaySettings,
  getDefaultDisplay,
  type DisplayDef,
  type DisplayField,
} from '@tree-weaver/core';
import { DISPLAYS_LOCKED, ENV_DISPLAYS } from '../../config';
import { effectiveDisplaySettings, isDisplayFieldLocked, resetDisplaySettings, setDisplaySetting, toast } from '../../store/actions';
import { state } from '../../store/editor';
import { DisplayIcon, Icon } from '../../utils/icons';

const FIELD_LABEL: Record<DisplayField, string> = { width: 'Width', height: 'Height', breakpoint: 'Breakpoint' };

/** Preview sizes and breakpoints of the display types, and how to fix them with environment variables. */
@Component({ tag: 'tw-display-settings' })
export class TwDisplaySettings {
  @State() copied = false;

  private dialogEl?: HTMLElement;

  componentDidLoad() {
    this.dialogEl?.querySelector<HTMLElement>('input:not(:disabled), button')?.focus();
  }

  private close = () => {
    state.dialog = null;
  };

  private onInput(d: DisplayDef, field: DisplayField, input: HTMLInputElement) {
    const raw = input.value.trim();
    if (!raw) return setDisplaySetting(d.id, field, null);
    const n = Number(raw);
    if (!Number.isInteger(n) || n < DISPLAY_MIN_PX || n > DISPLAY_MAX_PX) {
      toast(`${d.label} ${FIELD_LABEL[field].toLowerCase()} must be a whole number from ${DISPLAY_MIN_PX} to ${DISPLAY_MAX_PX}.`, 'error');
      input.value = String(d[field] ?? '');
      return;
    }
    setDisplaySetting(d.id, field, n);
  }

  private async copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      this.copied = true;
      setTimeout(() => (this.copied = false), 1600);
    } catch {
      toast('Could not copy. Select the text and copy it instead.', 'error');
    }
  }

  private renderField(d: DisplayDef, field: DisplayField) {
    if (field === 'breakpoint' && d.breakpoint === null) {
      return (
        <td class="muted" title="The base display's styles apply to every screen width">
          Base
        </td>
      );
    }
    const locked = isDisplayFieldLocked(d.id, field);
    const def = getDefaultDisplay(d.id)[field];
    const changed = d[field] !== def;
    const label = `${d.label} ${FIELD_LABEL[field].toLowerCase()}`;
    return (
      <td>
        <div class={{ 'px-input': true, changed: changed && !locked, locked }}>
          {field === 'breakpoint' ? <span class="px-op">{d.id === 'xl' ? '≥' : '≤'}</span> : null}
          <input
            class="input mono"
            type="number"
            inputMode="numeric"
            min={DISPLAY_MIN_PX}
            max={DISPLAY_MAX_PX}
            step={1}
            value={String(d[field])}
            placeholder={String(def)}
            disabled={locked}
            aria-label={label}
            title={locked ? 'Set by the deployment (TW_DISPLAYS). Change it there and rebuild.' : `Default ${def}px`}
            onChange={(e) => this.onInput(d, field, e.target as HTMLInputElement)}
          />
          {locked ? (
            <span class="px-lock" aria-hidden="true">
              <Icon name="lock" />
            </span>
          ) : changed ? (
            <button class="icon-btn" title={`Back to ${def}px`} aria-label={`Reset ${label} to ${def}px`} onClick={() => setDisplaySetting(d.id, field, null)}>
              <Icon name="undo" />
            </button>
          ) : null}
        </div>
      </td>
    );
  }

  private renderEnv() {
    const value = formatDisplaySettings(changedDisplaySettings(effectiveDisplaySettings()));
    const line = value ? `TW_DISPLAYS="${value}"` : '';
    const fromEnv = Object.keys(ENV_DISPLAYS.settings).length > 0;
    return (
      <section class="env-help" aria-labelledby="env-help-title">
        <h3 id="env-help-title">Hard-code these with environment variables</h3>
        <p class="hint">
          Changes here are saved in this browser only. To give everyone who uses this deployment the same sizes and breakpoints, and stop them being changed here,
          set <code>TW_DISPLAYS</code> when the app is built.
        </p>
        {line ? (
          <div class="env-line">
            <code class="mono">{line}</code>
            <button class="btn small" onClick={() => this.copy(line)}>
              <Icon name="copy" /> {this.copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        ) : (
          <p class="hint">Everything uses its default now, so there is nothing to set. Change a value above and its setting appears here.</p>
        )}
        <ol class="env-steps">
          <li>
            <strong>Building yourself:</strong> put it before the build command, as in <code class="mono">{line || 'TW_DISPLAYS="tablet.size=768x1024"'} pnpm build</code>.
          </li>
          <li>
            <strong>GitHub Pages:</strong> in the repository, open Settings → Secrets and variables → Actions → Variables, add a variable named <code>TW_DISPLAYS</code>{' '}
            with the value{value ? <code class="mono"> {value}</code> : ' you want'}, then run the Pages workflow again.
          </li>
          <li>
            Add <code>TW_LOCK_DISPLAYS=true</code> to stop every display setting being changed in the app, including ones <code>TW_DISPLAYS</code> leaves at the default.
          </li>
        </ol>
        <p class="hint">
          Format: <code class="mono">display.field=pixels</code>, separated by commas. Displays are <code>lg</code>, <code>xl</code>, <code>tablet</code>, <code>mobile-landscape</code> and{' '}
          <code>mobile-portrait</code>. Fields are <code>width</code>, <code>height</code>, <code>size</code> (as <code>768x1024</code>) and <code>breakpoint</code>. JSON such as{' '}
          <code class="mono">{'{"tablet":{"breakpoint":900}}'}</code> works too.
        </p>
        {fromEnv && !DISPLAYS_LOCKED ? <p class="hint">Values with a lock come from this deployment's <code>TW_DISPLAYS</code> and already apply to everyone.</p> : null}
      </section>
    );
  }

  render() {
    void state.displaysVersion;
    const custom = Object.keys(state.displaySettings).length > 0 && !DISPLAYS_LOCKED;
    return (
      <div class="dialog-backdrop" onClick={(e) => e.target === e.currentTarget && this.close()} onKeyDown={(e) => e.key === 'Escape' && this.close()}>
        <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="displays-title" ref={(el) => (this.dialogEl = el)}>
          <header>
            <h2 id="displays-title">Display settings</h2>
            <button class="icon-btn" aria-label="Close" onClick={this.close}>
              <Icon name="x" />
            </button>
          </header>
          <div class="dialog-body">
            {DISPLAYS_LOCKED ? (
              <p class="notice">
                <Icon name="lock" /> This deployment fixes the display settings (<code>TW_LOCK_DISPLAYS</code>), so they can't be changed here.
              </p>
            ) : (
              <p class="hint" style={{ margin: '0' }}>
                <strong>Width</strong> and <strong>height</strong> set the canvas and preview size. The <strong>breakpoint</strong> is the screen width where a display's
                styles start to apply in exported CSS: at or above it for Desktop XL, at or below it for the others.
              </p>
            )}
            {ENV_DISPLAYS.errors.length ? (
              <div class="error-box" role="alert">
                Parts of <code>TW_DISPLAYS</code> were ignored: {ENV_DISPLAYS.errors.join(' ')}
              </div>
            ) : null}
            <div class="table-scroll">
              <table class="display-table">
                <thead>
                  <tr>
                    <th scope="col">Display</th>
                    <th scope="col">Width (px)</th>
                    <th scope="col">Height (px)</th>
                    <th scope="col">Breakpoint (px)</th>
                  </tr>
                </thead>
                <tbody>
                  {DISPLAYS.map((d) => (
                    <tr>
                      <th scope="row">
                        <span class="row">
                          <DisplayIcon display={d.id} />
                          {d.label}
                        </span>
                        <span class="hint mono">{d.media ? `@media ${d.media}` : 'Base styles, every width'}</span>
                      </th>
                      {this.renderField(d, 'width')}
                      {this.renderField(d, 'height')}
                      {this.renderField(d, 'breakpoint')}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {this.renderEnv()}
          </div>
          <footer>
            <button class="btn" disabled={!custom} onClick={resetDisplaySettings} title="Undo every change made in this browser">
              Reset to defaults
            </button>
            <button class="btn primary" onClick={this.close}>
              Done
            </button>
          </footer>
        </div>
      </div>
    );
  }
}
