import { duplicateSelected, redo, removeSelected, selectParent, undo } from '../store/actions';
import { state } from '../store/editor';

/** Is the event coming from somewhere the user is typing? Shortcuts must not steal those keys. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

/** Keyboard shortcuts shared by the app window and the canvas frame. */
export function handleShortcut(ev: KeyboardEvent): void {
  if (isTypingTarget(ev.target) || state.dialog || state.preview) return;
  const mod = ev.metaKey || ev.ctrlKey;
  const key = ev.key.toLowerCase();
  if (mod && key === 'z') {
    ev.preventDefault();
    if (ev.shiftKey) redo();
    else undo();
  } else if (mod && key === 'y') {
    ev.preventDefault();
    redo();
  } else if (mod && key === 'd') {
    ev.preventDefault();
    duplicateSelected();
  } else if ((key === 'delete' || key === 'backspace') && state.selectedId) {
    ev.preventDefault();
    removeSelected();
  } else if (key === 'escape') {
    selectParent();
  }
}
