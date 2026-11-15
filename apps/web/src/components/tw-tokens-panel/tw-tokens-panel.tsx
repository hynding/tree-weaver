import { Component, State, h } from '@stencil/core';
import { isTokenName, parseColor, themeTokens, TOKEN_GROUPS, TOKEN_KINDS, type ThemeToken, type TokenKind } from '@tree-weaver/core';
import { resetTokenValue, setTab, setTokenValue } from '../../store/actions';
import { state } from '../../store/editor';
import { Icon } from '../../utils/icons';

const KIND_LABEL: Record<TokenKind, string> = {
  color: 'Colour',
  space: 'Spacing',
  radius: 'Radius',
  'font-family': 'Font family',
  'font-size': 'Font size',
  'font-weight': 'Font weight',
  'line-height': 'Line height',
  shadow: 'Shadow',
  other: 'Other',
};

/** `#rrggbb` for a colour the picker can show, or null. */
function hexOf(value: string): string | null {
  const c = parseColor(value);
  if (!c) return null;
  return `#${c
    .slice(0, 3)
    .map((n) => Math.round(n).toString(16).padStart(2, '0'))
    .join('')}`;
}

/**
 * Design tokens: the colours, spacing and type sizes the forest's kits define as `:root`
 * custom properties. Edits go into the forest's token kit, so every `var(--name)` on the
 * canvas and in every export follows, and the kit's own CSS stays as imported.
 */
@Component({ tag: 'tw-tokens-panel' })
export class TwTokensPanel {
  @State() filter = '';
  @State() newName = '';
  @State() newValue = '';
  @State() newKind: TokenKind | '' = '';

  private set(t: ThemeToken, value: string) {
    const v = value.trim();
    if (!v || v === t.value) return;
    setTokenValue({ name: t.name, value: v });
  }

  private setKind(t: ThemeToken, kind: TokenKind) {
    setTokenValue({ name: t.name, value: t.value, kind });
  }

  private add() {
    const raw = this.newName.trim();
    const name = raw.startsWith('--') ? raw : `--${raw}`;
    if (!isTokenName(name)) return;
    if (setTokenValue({ name, value: this.newValue, ...(this.newKind ? { kind: this.newKind } : {}) })) {
      this.newName = '';
      this.newValue = '';
      this.newKind = '';
    }
  }

  private renderToken(t: ThemeToken) {
    const hex = t.kind === 'color' ? hexOf(t.resolved) : null;
    const id = `token-${t.name.slice(2)}`;
    return (
      <div class={{ 'token-row': true, edited: t.edited }} key={t.name}>
        <div class="token-head">
          {t.kind === 'color' ? (
            <input
              type="color"
              class="token-swatch"
              aria-label={`Pick ${t.name}`}
              value={hex ?? '#000000'}
              disabled={!hex}
              title={hex ? 'Pick a colour' : 'This value is not a plain colour; edit it as text'}
              onChange={(e) => this.set(t, (e.target as HTMLInputElement).value)}
            />
          ) : null}
          <label class="token-name" htmlFor={id} title={t.description ?? `${t.name} from ${t.source}`}>
            {t.name}
          </label>
          <select class="token-kind" aria-label={`Kind of ${t.name}`} onChange={(e) => this.setKind(t, (e.target as HTMLSelectElement).value as TokenKind)}>
            {TOKEN_KINDS.map((k) => (
              <option value={k} selected={k === t.kind}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
          {t.edited ? (
            <button class="icon-btn" title={t.kitValue ? `Back to the kit value, ${t.kitValue}` : 'Remove this token'} onClick={() => resetTokenValue(t.name)}>
              <Icon name={t.kitValue ? 'undo' : 'trash'} />
            </button>
          ) : null}
        </div>
        <input
          id={id}
          class="input token-value"
          value={t.value}
          spellcheck={false}
          onChange={(e) => this.set(t, (e.target as HTMLInputElement).value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <p class="meta token-meta">
          {t.resolved !== t.value ? `= ${t.resolved} · ` : ''}
          {t.edited ? (t.kitValue ? `edited (kit: ${t.kitValue})` : 'added here') : t.source}
        </p>
      </div>
    );
  }

  render() {
    const kits = state.forest?.kits ?? [];
    const tokens = themeTokens(kits);
    const q = this.filter.trim().toLowerCase();
    const shown = q ? tokens.filter((t) => t.name.toLowerCase().includes(q) || t.value.toLowerCase().includes(q)) : tokens;
    const validNew = isTokenName(this.newName.trim().startsWith('--') ? this.newName.trim() : `--${this.newName.trim()}`) && !!this.newValue.trim();
    return [
      <section class="panel-section">
        <h3 class="panel-title">Design tokens</h3>
        <p class="hint">
          Colours, spacing and type from your kits’ <code>:root</code> variables. Change one here and everything that uses <code>var(--name)</code> follows, on the canvas and in every export (tokens.json, a
          Tailwind theme, and DesignTokens in SwiftUI and Flutter).
        </p>
        {tokens.length > 8 ? (
          <input class="input" type="search" placeholder="Filter tokens" aria-label="Filter tokens" value={this.filter} onInput={(e) => (this.filter = (e.target as HTMLInputElement).value)} />
        ) : null}
        {tokens.length === 0 ? (
          <p class="hint">
            No tokens yet. Add one below, or add a kit with <code>:root {'{'} --brand: #2f6f4f; {'}'}</code> in the{' '}
            <a href="#" onClick={(e) => (e.preventDefault(), setTab('kits'))}>
              Kits tab
            </a>
            .
          </p>
        ) : null}
      </section>,
      ...TOKEN_GROUPS.map((g) => {
        const list = shown.filter((t) => g.kinds.includes(t.kind));
        if (!list.length) return null;
        return (
          <section class="panel-section">
            <h3 class="panel-title">
              {g.label} <span class="meta">{list.length}</span>
            </h3>
            {list.map((t) => this.renderToken(t))}
          </section>
        );
      }),
      <section class="panel-section">
        <h3 class="panel-title">Add a token</h3>
        <div class="row">
          <input class="input grow" placeholder="--name" aria-label="New token name" value={this.newName} onInput={(e) => (this.newName = (e.target as HTMLInputElement).value)} />
          <select class="token-kind" aria-label="New token kind" onChange={(e) => (this.newKind = (e.target as HTMLSelectElement).value as TokenKind | '')}>
            <option value="" selected={!this.newKind}>
              Kind: auto
            </option>
            {TOKEN_KINDS.map((k) => (
              <option value={k} selected={k === this.newKind}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
        <div class="row" style={{ marginTop: '6px' }}>
          <input
            class="input grow"
            placeholder="Value, e.g. #2f6f4f or 1.5rem"
            aria-label="New token value"
            value={this.newValue}
            onInput={(e) => (this.newValue = (e.target as HTMLInputElement).value)}
            onKeyDown={(e) => e.key === 'Enter' && validNew && this.add()}
          />
          <button class="btn small" disabled={!validNew} onClick={() => this.add()}>
            Add
          </button>
        </div>
        <p class="hint">Edits are kept in a “Tokens” kit that loads after your other kits, so the kits themselves stay as imported.</p>
      </section>,
    ];
  }
}
