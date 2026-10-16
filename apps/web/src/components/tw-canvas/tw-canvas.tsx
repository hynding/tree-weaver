import { Component, Element, State, h } from '@stencil/core';
import {
  BASE_CSS,
  BRANCH_ATTR,
  canHaveChildren,
  findNode,
  formatSpan,
  formatTracks,
  getDisplay,
  inheritedStyles,
  isBranch,
  LEAF_ATTR,
  parseSpan,
  parseTracks,
  resizeTracks,
  resolveStyles,
  trackLabel,
  renderTreeBody,
  renderTreeCss,
  type Branch,
  type DesignKit,
  type DisplayId,
  type GridTrack,
} from '@tree-weaver/core';
import { allKits, currentTree, insertBlueprint, moveTo, pathTo, select, selectedNode, setStyleValue, updateLeaf, type DropPosition } from '../../store/actions';
import { onChange, state } from '../../store/editor';
import { nodeKind, nodeLabel } from '../../utils/describe';
import { BLUEPRINT_MIME, NODE_MIME, dropPosition, hasType, isTreeDrag } from '../../utils/dnd';
import { handleShortcut } from '../../utils/shortcuts';

/** Outlines for hover, selection and drop targets, plus room to drop into empty branches. */
const EDITOR_CSS = `
[data-tw-hover] { outline: 1px dashed #2563eb !important; outline-offset: -1px; }
[data-tw-selected] { outline: 2px solid #2563eb !important; outline-offset: -2px; }
[data-tw]:not(img, hr, br, input, body):empty { min-height: 2.25rem; min-width: 2.25rem; outline: 1px dashed #b7c2bc; outline-offset: -1px;
  background: repeating-linear-gradient(45deg, rgba(47,111,79,.04) 0 6px, transparent 6px 12px); }
[data-tw-drop="inside"] { box-shadow: inset 0 0 0 2px #2563eb !important; background-color: rgba(37,99,235,.06) !important; }
[data-tw-drop="before"] { box-shadow: 0 -3px 0 0 #2563eb !important; }
[data-tw-drop="after"] { box-shadow: 0 3px 0 0 #2563eb !important; }
[${LEAF_ATTR}][contenteditable] { outline: 2px solid #f59e0b !important; cursor: text; }
a, button { cursor: default; }
html { min-height: 100%; }
body { min-height: 100vh; }
#tw-grid-overlay { position: absolute; left: 0; top: 0; width: 0; height: 0; pointer-events: none; z-index: 2147483646;
  font: 600 11px/1.2 system-ui, sans-serif; }
#tw-grid-overlay .col { position: absolute; box-sizing: border-box; background: rgba(37,99,235,.06);
  border-left: 1px dashed rgba(37,99,235,.6); border-right: 1px dashed rgba(37,99,235,.6); }
#tw-grid-overlay .gap { position: absolute; background: repeating-linear-gradient(45deg, rgba(37,99,235,.14) 0 3px, transparent 3px 7px); }
#tw-grid-overlay .row-line { position: absolute; border-top: 1px dashed rgba(37,99,235,.45); }
#tw-grid-overlay .label { position: absolute; transform: translate(-50%, 3px); padding: 2px 6px; border-radius: 3px; white-space: nowrap;
  color: #fff; background: #2563eb; box-shadow: 0 1px 2px rgba(0,0,0,.2); }
#tw-grid-overlay .handle { position: absolute; width: 14px; margin-left: -7px; pointer-events: auto; cursor: col-resize; touch-action: none; }
#tw-grid-overlay .handle::after { content: ''; position: absolute; left: 5px; top: 50%; width: 4px; height: 32px; margin-top: -16px;
  border-radius: 2px; background: #2563eb; box-shadow: 0 0 0 2px #fff; }
#tw-grid-overlay .handle:hover::after { background: #1d4ed8; height: 40px; margin-top: -20px; }
#tw-grid-overlay .handle.span { cursor: ew-resize; }
#tw-grid-overlay .handle.span::after { background: #f59e0b; }
#tw-grid-overlay .label.span { background: #b45309; }
#tw-grid-overlay.dragging > :not(.live) { display: none; }
`;

const SKELETON = `<!doctype html><html><head><meta charset="utf-8">
<style id="tw-base">${BASE_CSS}</style><style id="tw-tree"></style><style id="tw-editor">${EDITOR_CSS}</style>
</head><body></body></html>`;

/** Whether two kit lists load the same stylesheets in the same order. */
const sameKits = (a: DesignKit[], b: DesignKit[]) =>
  a.length === b.length && a.every((k, i) => k.id === b[i].id && k.href === b[i].href && (k.href ? true : k.css === b[i].css));

@Component({ tag: 'tw-canvas' })
export class TwCanvas {
  @Element() host!: HTMLElement;
  @State() stageWidth = 0;
  @State() stageHeight = 0;

  private iframe?: HTMLIFrameElement;
  private stage?: HTMLElement;
  private observer?: ResizeObserver;
  private frameObserver?: ResizeObserver;
  private loaded = false;
  private editing: HTMLElement | null = null;
  // What the frame currently shows, so updates only touch what changed.
  private shownRoot: Branch | null = null;
  private shownKits: DesignKit[] = [];
  private dropMark: { el: Element; position: DropPosition; id: string } | null = null;
  private unsubscribe: (() => void)[] = [];
  /** Set while a grid handle is dragged, so redraws and clicks leave it alone. */
  private gridDrag = false;
  private suppressClick = false;
  /** What each overlay handle does when pressed. */
  private handles = new WeakMap<Element, (e: PointerEvent) => void>();
  /** How much the frame is shrunk to fit, so overlay labels stay readable. */
  private scale = 1;

  componentDidLoad() {
    this.observer = new ResizeObserver(([entry]) => {
      this.stageWidth = entry.contentRect.width;
      this.stageHeight = entry.contentRect.height;
    });
    if (this.stage) this.observer.observe(this.stage);
    // Hover does not change what this component renders, so follow it directly.
    this.unsubscribe.push(onChange('hoverId', () => this.sync()));
    if (this.iframe) {
      this.iframe.addEventListener('load', () => this.onFrameLoad());
      this.iframe.srcdoc = SKELETON;
    }
  }

  disconnectedCallback() {
    this.observer?.disconnect();
    this.frameObserver?.disconnect();
    this.unsubscribe.forEach((off) => off());
  }

  componentDidRender() {
    this.sync();
  }

  private get doc(): Document | null {
    return this.loaded ? (this.iframe?.contentDocument ?? null) : null;
  }

  private onFrameLoad() {
    const doc = this.iframe?.contentDocument;
    if (!doc) return;
    this.loaded = true;
    this.shownRoot = null;
    this.shownKits = [];
    doc.addEventListener('click', (e) => this.onClick(e), true);
    doc.addEventListener('dblclick', (e) => this.onDblClick(e), true);
    doc.addEventListener('mouseover', (e) => this.onHover(e));
    doc.addEventListener('mouseleave', () => this.setHover(null));
    doc.addEventListener('submit', (e) => e.preventDefault(), true);
    doc.addEventListener('keydown', (e) => handleShortcut(e));
    doc.addEventListener('pointerdown', (e) => {
      const handle = (e.target as Element).closest?.('#tw-grid-overlay .handle');
      if (handle) this.handles.get(handle)?.(e);
    });
    doc.addEventListener('dragover', (e) => this.onDragOver(e));
    doc.addEventListener('dragleave', (e) => {
      if (!e.relatedTarget) this.clearDrop();
    });
    doc.addEventListener('drop', (e) => this.onDrop(e));
    doc.addEventListener('dragstart', (e) => this.onDragStart(e));
    doc.addEventListener('dragend', () => {
      state.dragNodeId = null;
      this.clearDrop();
    });
    // Keep the grid overlay on top of the layout as images load and the frame resizes.
    this.frameObserver?.disconnect();
    this.frameObserver = new ResizeObserver(() => this.drawGrid());
    this.frameObserver.observe(doc.body);
    this.sync();
  }

  /**
   * One element per kit, in load order, between the base styles and the tree's styles:
   * `<link>` for linked kits, `<style>` for the rest. Separate elements keep each kit's
   * `@import` rules valid and let linked stylesheets load from their URLs.
   */
  private showKits(doc: Document, kits: DesignKit[]) {
    doc.head.querySelectorAll('[data-tw-kit]').forEach((el) => el.remove());
    const before = doc.getElementById('tw-tree');
    for (const kit of kits) {
      let el: HTMLElement;
      if (kit.href) {
        const link = doc.createElement('link');
        link.rel = 'stylesheet';
        link.href = kit.href;
        el = link;
      } else {
        el = doc.createElement('style');
        el.textContent = kit.css;
      }
      el.setAttribute('data-tw-kit', kit.id);
      doc.head.insertBefore(el, before);
    }
  }

  /** Bring the frame in line with the store: kits, styles, markup, selection. */
  private sync() {
    const doc = this.doc;
    const tree = currentTree();
    const forest = state.forest;
    if (!doc || !tree || !forest) return;
    const kits = allKits().filter((k) => k.enabled);
    if (!sameKits(this.shownKits, kits)) {
      this.showKits(doc, kits);
      this.shownKits = kits;
    }
    if (this.shownRoot !== tree.root && !this.editing) {
      const root = tree.root;
      doc.getElementById('tw-tree')!.textContent = renderTreeCss(root);
      const body = doc.body;
      for (const attr of Array.from(body.attributes)) body.removeAttribute(attr.name);
      body.setAttribute(BRANCH_ATTR, root.id);
      if (root.classes.length) body.className = root.classes.join(' ');
      for (const [k, v] of Object.entries(root.attrs)) {
        try {
          body.setAttribute(k, v);
        } catch {
          // Ignore attribute names the DOM refuses.
        }
      }
      body.innerHTML = renderTreeBody(root, { designer: true });
      body.querySelectorAll(`[${BRANCH_ATTR}]`).forEach((el) => el.setAttribute('draggable', 'true'));
      this.shownRoot = root;
    }
    this.mark('data-tw-selected', state.selectedId);
    this.mark('data-tw-hover', state.hoverId && state.hoverId !== state.selectedId ? state.hoverId : null);
    this.drawGrid();
  }

  private find(id: string | null): Element | null {
    const doc = this.doc;
    if (!doc || !id) return null;
    const esc = (window.CSS?.escape ?? ((s: string) => s))(id);
    return doc.querySelector(`[${BRANCH_ATTR}="${esc}"], [${LEAF_ATTR}="${esc}"]`);
  }

  private mark(attr: string, id: string | null) {
    const doc = this.doc;
    if (!doc) return;
    doc.querySelectorAll(`[${attr}]`).forEach((el) => el.removeAttribute(attr));
    const el = this.find(id);
    if (!el) return;
    el.setAttribute(attr, '');
    if (attr === 'data-tw-selected') {
      const rect = el.getBoundingClientRect();
      const view = doc.defaultView!;
      if (rect.bottom < 0 || rect.top > view.innerHeight) el.scrollIntoView({ block: 'nearest' });
    }
  }

  private idOf(target: EventTarget | null): string | null {
    const el = (target as Element | null)?.closest?.(`[${LEAF_ATTR}], [${BRANCH_ATTR}]`);
    return el?.getAttribute(LEAF_ATTR) ?? el?.getAttribute(BRANCH_ATTR) ?? null;
  }

  private onClick(e: MouseEvent) {
    if (this.editing && this.editing.contains(e.target as Node)) return;
    if (this.suppressClick || (e.target as Element).closest?.('#tw-grid-overlay')) {
      this.suppressClick = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    select(this.idOf(e.target));
  }

  private setHover(id: string | null) {
    if (state.hoverId !== id) state.hoverId = id;
  }

  private onHover(e: MouseEvent) {
    this.setHover(this.idOf(e.target));
  }

  /** Double-click a text leaf to edit it in place. Enter commits, Escape cancels. */
  private onDblClick(e: MouseEvent) {
    const span = (e.target as Element).closest?.(`[${LEAF_ATTR}]`) as HTMLElement | null;
    if (!span || span.tagName === 'IMG') return;
    e.preventDefault();
    const id = span.getAttribute(LEAF_ATTR)!;
    const original = span.textContent ?? '';
    this.editing = span;
    span.setAttribute('contenteditable', 'plaintext-only');
    if (span.contentEditable !== 'plaintext-only') span.setAttribute('contenteditable', 'true');
    span.focus();
    const sel = span.ownerDocument.getSelection();
    sel?.selectAllChildren(span);
    const finish = (save: boolean) => {
      span.removeEventListener('blur', onBlur);
      span.removeEventListener('keydown', onKey);
      span.removeAttribute('contenteditable');
      this.editing = null;
      const value = span.textContent ?? '';
      if (save && value !== original) updateLeaf(id, { value });
      else {
        span.textContent = original;
        this.sync();
      }
    };
    const onBlur = () => finish(true);
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        span.blur();
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        span.removeEventListener('blur', onBlur);
        finish(false);
      }
    };
    span.addEventListener('blur', onBlur);
    span.addEventListener('keydown', onKey);
    select(id);
  }

  private onDragStart(e: DragEvent) {
    const id = this.idOf(e.target);
    const tree = currentTree();
    if (!id || !tree || id === tree.root.id || this.editing) {
      e.preventDefault();
      return;
    }
    e.dataTransfer!.setData(NODE_MIME, id);
    e.dataTransfer!.effectAllowed = 'move';
    state.dragNodeId = id;
  }

  private clearDrop() {
    this.dropMark?.el.removeAttribute('data-tw-drop');
    this.dropMark = null;
  }

  private onDragOver(e: DragEvent) {
    if (!isTreeDrag(e)) return;
    const tree = currentTree();
    if (!tree) return;
    let el = (e.target as Element).closest?.(`[${LEAF_ATTR}], [${BRANCH_ATTR}]`) ?? this.doc!.body;
    let id = el.getAttribute(LEAF_ATTR) ?? el.getAttribute(BRANCH_ATTR) ?? tree.root.id;
    const dragging = state.dragNodeId;
    if (dragging) {
      // Never drop a branch into itself: climb to the dragged branch's parent level.
      const inside = id === dragging || pathTo(id).some((b) => b.id === dragging);
      if (inside) {
        const draggedEl = this.find(dragging);
        if (!draggedEl) return;
        el = draggedEl;
        id = dragging;
      }
    }
    e.preventDefault();
    e.dataTransfer!.dropEffect = hasType(e, NODE_MIME) ? 'move' : 'copy';
    const node = findNode(tree.root, id);
    const position: DropPosition = id === tree.root.id ? 'inside' : dropPosition(el.getBoundingClientRect(), e.clientY, canHaveChildren(node));
    if (this.dropMark?.el === el && this.dropMark.position === position) return;
    this.clearDrop();
    if (dragging === id && position === 'inside') return;
    el.setAttribute('data-tw-drop', position);
    this.dropMark = { el, position, id };
  }

  private onDrop(e: DragEvent) {
    e.preventDefault();
    const mark = this.dropMark;
    this.clearDrop();
    if (!mark) return;
    const blueprint = e.dataTransfer!.getData(BLUEPRINT_MIME);
    const nodeId = e.dataTransfer!.getData(NODE_MIME);
    state.dragNodeId = null;
    if (blueprint) insertBlueprint(blueprint, mark.id, mark.position);
    else if (nodeId && nodeId !== mark.id) moveTo(nodeId, mark.id, mark.position);
  }

  /* ---------------------------------------------------------- grid overlay */

  /** Track positions of a rendered grid, in document coordinates. */
  private gridGeometry(el: HTMLElement) {
    const view = el.ownerDocument.defaultView!;
    const cs = getComputedStyle(el);
    const sizes = (value: string) => value.split(/\s+/).filter((t) => t.endsWith('px')).map(parseFloat);
    const widths = sizes(cs.gridTemplateColumns);
    const heights = sizes(cs.gridTemplateRows);
    const colGap = parseFloat(cs.columnGap) || 0;
    const rowGap = parseFloat(cs.rowGap) || 0;
    const rect = el.getBoundingClientRect();
    const left = rect.left + view.scrollX + (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.paddingLeft) || 0);
    const top = rect.top + view.scrollY + (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.paddingTop) || 0);
    const starts = (list: number[], origin: number, gap: number) => {
      let at = origin;
      return list.map((w) => {
        const start = at;
        at += w + gap;
        return start;
      });
    };
    const xs = starts(widths, left, colGap);
    const ys = starts(heights, top, rowGap);
    const height = heights.reduce((a, b) => a + b, 0) + rowGap * Math.max(0, heights.length - 1);
    const width = widths.reduce((a, b) => a + b, 0) + colGap * Math.max(0, widths.length - 1);
    return { widths, heights, xs, ys, colGap, rowGap, left, top, width, height: Math.max(height, 24) };
  }

  private overlay(doc: Document): HTMLElement {
    let overlay = doc.getElementById('tw-grid-overlay');
    if (!overlay) {
      overlay = doc.createElement('div');
      overlay.id = 'tw-grid-overlay';
      overlay.setAttribute('aria-hidden', 'true');
      doc.documentElement.appendChild(overlay);
    }
    return overlay;
  }

  private isGridEl(el: Element | null): el is HTMLElement {
    if (!el || !el.hasAttribute(BRANCH_ATTR)) return false;
    const display = getComputedStyle(el).display;
    return display === 'grid' || display === 'inline-grid';
  }

  /**
   * Show the selected grid's columns, gaps and rows, with handles to resize columns.
   * When a box inside a grid is selected, show its parent grid and a handle to change its span.
   */
  private drawGrid() {
    const doc = this.doc;
    if (!doc || this.gridDrag) return;
    const overlay = this.overlay(doc);
    overlay.replaceChildren();
    overlay.style.fontSize = `${Math.round(11 / this.scale)}px`;
    const tree = currentTree();
    const selected = this.find(state.selectedId);
    if (!tree || !selected || this.editing) return;
    let gridEl: HTMLElement | null = null;
    let child: HTMLElement | null = null;
    if (this.isGridEl(selected)) gridEl = selected;
    else if (selected.hasAttribute(BRANCH_ATTR) && this.isGridEl(selected.parentElement)) {
      gridEl = selected.parentElement as HTMLElement;
      child = selected as HTMLElement;
    }
    if (!gridEl) return;
    const gridNode = findNode(tree.root, gridEl.getAttribute(BRANCH_ATTR)!);
    if (!gridNode || !isBranch(gridNode)) return;
    const geo = this.gridGeometry(gridEl);
    if (!geo.widths.length) return;
    const display = state.display as DisplayId;
    const tracks = parseTracks(resolveStyles(gridNode.styles, display)['grid-template-columns']);
    const editable = tracks && tracks.length === geo.widths.length ? tracks : null;
    const add = (cls: string, box: { left: number; top: number; width?: number; height?: number }, text?: string) => {
      const el = doc.createElement('div');
      el.className = cls;
      el.style.left = `${box.left}px`;
      el.style.top = `${box.top}px`;
      if (box.width !== undefined) el.style.width = `${box.width}px`;
      if (box.height !== undefined) el.style.height = `${box.height}px`;
      if (text) el.textContent = text;
      overlay.appendChild(el);
      return el;
    };
    geo.widths.forEach((w, i) => {
      add('col', { left: geo.xs[i], top: geo.top, width: w, height: geo.height });
      if (i < geo.widths.length - 1 && geo.colGap) add('gap', { left: geo.xs[i] + w, top: geo.top, width: geo.colGap, height: geo.height });
    });
    geo.ys.slice(1).forEach((y) => {
      if (geo.rowGap) add('gap', { left: geo.left, top: y - geo.rowGap, width: geo.width, height: geo.rowGap });
      else add('row-line', { left: geo.left, top: y, width: geo.width });
    });
    if (!child) {
      geo.widths.forEach((w, i) => add('label', { left: geo.xs[i] + w / 2, top: geo.top }, editable ? `${trackLabel(editable[i])} · ${Math.round(w)}px` : `${Math.round(w)}px`));
      if (editable) {
        for (let i = 0; i < geo.widths.length - 1; i++) {
          const handle = add('handle', { left: geo.xs[i] + geo.widths[i] + geo.colGap / 2, top: geo.top, height: geo.height });
          handle.title = 'Drag to resize these columns';
          this.handles.set(handle, (e) => this.startColumnDrag(e, gridEl!, gridNode.id, editable, geo.widths, i, geo.top));
        }
      }
    } else {
      const rect = child.getBoundingClientRect();
      const view = doc.defaultView!;
      const handle = add('handle span', { left: rect.right + view.scrollX, top: rect.top + view.scrollY, height: rect.height });
      handle.title = 'Drag to change how many columns this covers';
      this.handles.set(handle, (e) => this.startSpanDrag(e, child!, geo));
    }
  }

  /** Run a drag on the frame: `move` gets the pointer's x offset, `end` commits. */
  private drag(e: PointerEvent, move: (dx: number, x: number) => void, end: () => void) {
    const doc = this.doc;
    if (!doc || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const root = doc.documentElement;
    root.setPointerCapture(e.pointerId);
    this.gridDrag = true;
    const startX = e.clientX;
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - startX) > 2) moved = true;
      if (!moved) return;
      this.overlay(doc).classList.add('dragging');
      move(ev.clientX - startX, ev.clientX + doc.defaultView!.scrollX);
    };
    const onUp = () => {
      root.removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerup', onUp);
      root.removeEventListener('pointercancel', onUp);
      this.gridDrag = false;
      this.overlay(doc).classList.remove('dragging');
      this.suppressClick = true;
      // The click that follows a drag lands on whatever is under the pointer; ignore it once.
      setTimeout(() => (this.suppressClick = false), 0);
      if (moved) end();
      this.drawGrid();
    };
    root.addEventListener('pointermove', onMove);
    root.addEventListener('pointerup', onUp);
    root.addEventListener('pointercancel', onUp);
  }

  private startColumnDrag(e: PointerEvent, gridEl: HTMLElement, gridId: string, tracks: GridTrack[], widths: number[], index: number, top: number) {
    const doc = this.doc!;
    let next = tracks;
    const hint = this.overlay(doc).appendChild(doc.createElement('div'));
    hint.className = 'label live';
    this.drag(
      e,
      (_dx, x) => {
        next = resizeTracks(tracks, widths, index, _dx);
        gridEl.style.gridTemplateColumns = formatTracks(next);
        hint.textContent = `${trackLabel(next[index])}  |  ${trackLabel(next[index + 1])}`;
        hint.style.left = `${x}px`;
        hint.style.top = `${Math.max(2, top - 22)}px`;
      },
      () => {
        gridEl.style.removeProperty('grid-template-columns');
        setStyleValue(gridId, 'grid-template-columns', formatTracks(next));
      },
    );
    if (!this.gridDrag) hint.remove();
  }

  private startSpanDrag(e: PointerEvent, child: HTMLElement, geo: ReturnType<TwCanvas['gridGeometry']>) {
    const doc = this.doc!;
    const view = doc.defaultView!;
    const id = child.getAttribute(BRANCH_ATTR)!;
    const tree = currentTree();
    const node = tree && findNode(tree.root, id);
    if (!node || !isBranch(node)) return;
    const display = state.display as DisplayId;
    const rect = child.getBoundingClientRect();
    const childLeft = rect.left + view.scrollX;
    // The column the box starts in: the one whose left edge is closest.
    const startCol = geo.xs.reduce((best, x, i) => (Math.abs(x - childLeft) < Math.abs(geo.xs[best] - childLeft) ? i : best), 0);
    const ends = geo.xs.map((x, i) => x + geo.widths[i]);
    const count = geo.widths.length;
    const current = parseSpan(resolveStyles(node.styles, display)['grid-column']);
    const fixedStart = current && !current.full ? current.start : null;
    let value: string | null = null;
    const hint = this.overlay(doc).appendChild(doc.createElement('div'));
    hint.className = 'label span live';
    this.drag(
      e,
      (_dx, x) => {
        const end = ends.reduce((best, edge, i) => (Math.abs(edge - x) < Math.abs(ends[best] - x) ? i : best), 0);
        const span = Math.max(1, end - startCol + 1);
        value = span >= count && startCol === 0 ? '1 / -1' : formatSpan({ start: fixedStart, span: Math.min(span, count - startCol), full: false });
        child.style.gridColumn = value ?? 'auto';
        hint.textContent = value === '1 / -1' ? 'Full row' : `${Math.min(span, count - startCol)} ${span === 1 ? 'column' : 'columns'}`;
        hint.style.left = `${ends[end]}px`;
        hint.style.top = `${Math.max(2, rect.top + view.scrollY - 22)}px`;
      },
      () => {
        child.style.removeProperty('grid-column');
        const inherited = inheritedStyles(node.styles, display)['grid-column'];
        setStyleValue(id, 'grid-column', value ?? (inherited && inherited !== 'auto' ? 'auto' : null));
      },
    );
    if (!this.gridDrag) hint.remove();
  }

  private renderCrumbs() {
    const tree = currentTree();
    const sel = selectedNode();
    if (!tree) return null;
    const chain = sel ? [...pathTo(sel.id), sel] : [tree.root];
    return (
      <nav class="crumbs" aria-label="Selection path">
        {chain.map((node, i) => [
          i > 0 ? <span class="sep">›</span> : null,
          <button class={{ current: node.id === (sel?.id ?? tree.root.id) }} title={nodeLabel(node)} onClick={() => select(node.id)}>
            {nodeKind(node)}
            {isBranch(node) && node.classes.length ? `.${node.classes[0]}` : ''}
          </button>,
        ])}
      </nav>
    );
  }

  render() {
    const display = getDisplay(state.display as DisplayId);
    const pad = 40;
    const scale = this.stageWidth ? Math.min(1, (this.stageWidth - pad) / display.width) : 1;
    this.scale = scale;
    const isDesktop = display.id === 'lg' || display.id === 'xl';
    const height = isDesktop ? Math.max(display.height, (this.stageHeight - pad) / scale) : display.height;
    const framed = display.id === 'tablet' ? 'tablet' : display.id.startsWith('mobile') ? 'mobile' : '';
    const bezel = framed ? 20 : 0;
    return [
      <div class="canvas-head">
        {this.renderCrumbs()}
        <span class="canvas-size" title={display.media ?? 'Base styles apply to every display'}>
          {display.label} · {display.width}×{display.height}
          {scale < 1 ? ` · ${Math.round(scale * 100)}%` : ''}
        </span>
      </div>,
      <div class="stage" ref={(el) => (this.stage = el)}>
        <div
          class="stage-inner"
          style={{
            width: `${(display.width + bezel) * scale}px`,
            height: `${(height + bezel) * scale}px`,
          }}
        >
          <div
            class={`device ${framed}`}
            style={{ width: `${display.width + bezel}px`, transform: `scale(${scale})`, transformOrigin: 'top left' }}
          >
            <iframe
              ref={(el) => (this.iframe = el)}
              title={`Canvas preview: ${display.label}`}
              sandbox="allow-same-origin"
              style={{ width: `${display.width}px`, height: `${height}px` }}
            />
          </div>
        </div>
      </div>,
    ];
  }
}
