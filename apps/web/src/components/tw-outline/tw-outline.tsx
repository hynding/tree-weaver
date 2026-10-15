import { Component, State, h } from '@stencil/core';
import { canHaveChildren, isBranch, type Branch, type TreeNode } from '@tree-weaver/core';
import {
  currentTree,
  duplicateSelected,
  insertBlueprint,
  moveTo,
  nudge,
  pathTo,
  removeSelected,
  select,
  type DropPosition,
} from '../../store/actions';
import { state } from '../../store/editor';
import { nodeKind, nodeLabel } from '../../utils/describe';
import { BLUEPRINT_MIME, NODE_MIME, dropPosition, hasType, isTreeDrag } from '../../utils/dnd';
import { Icon } from '../../utils/icons';

/** The tree as a collapsible list of branches and leaves, with drag and drop reordering. */
@Component({ tag: 'tw-outline' })
export class TwOutline {
  @State() collapsed = new Set<string>();
  @State() drop: { id: string; position: DropPosition } | null = null;

  private toggle(id: string) {
    const next = new Set(this.collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.collapsed = next;
  }

  componentWillRender() {
    // Keep the selection visible: expand its ancestors.
    if (!state.selectedId) return;
    const hidden = pathTo(state.selectedId).filter((b) => this.collapsed.has(b.id));
    if (hidden.length) {
      const next = new Set(this.collapsed);
      hidden.forEach((b) => next.delete(b.id));
      this.collapsed = next;
    }
  }

  private onDragOver(e: DragEvent, node: TreeNode, isRoot: boolean) {
    if (!isTreeDrag(e)) return;
    const dragging = state.dragNodeId;
    if (dragging && (dragging === node.id || pathTo(node.id).some((b) => b.id === dragging))) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = hasType(e, NODE_MIME) ? 'move' : 'copy';
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const position = isRoot ? 'inside' : dropPosition(rect, e.clientY, canHaveChildren(node));
    if (this.drop?.id !== node.id || this.drop.position !== position) this.drop = { id: node.id, position };
  }

  private onDrop(e: DragEvent) {
    e.preventDefault();
    const drop = this.drop;
    this.drop = null;
    if (!drop) return;
    const blueprint = e.dataTransfer!.getData(BLUEPRINT_MIME);
    const nodeId = e.dataTransfer!.getData(NODE_MIME);
    if (blueprint) insertBlueprint(blueprint, drop.id, drop.position);
    else if (nodeId) moveTo(nodeId, drop.id, drop.position);
  }

  private renderNode(node: TreeNode, depth: number, isRoot = false): unknown[] {
    const branch = isBranch(node) ? (node as Branch) : null;
    const open = !this.collapsed.has(node.id);
    const selected = state.selectedId === node.id;
    const drop = this.drop?.id === node.id ? this.drop.position : null;
    const overrides = branch ? Object.keys(branch.styles).filter((d) => d !== 'lg').length : 0;
    const row = (
      <div
        class={{ 'node-row': true, selected, [`drop-${drop}`]: !!drop }}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        role="treeitem"
        aria-selected={String(selected)}
        aria-expanded={branch && branch.children.length ? String(open) : undefined}
        draggable={!isRoot}
        onClick={() => select(node.id)}
        onDragStart={(e) => {
          e.stopPropagation();
          e.dataTransfer!.setData(NODE_MIME, node.id);
          e.dataTransfer!.effectAllowed = 'move';
          state.dragNodeId = node.id;
        }}
        onDragEnd={() => {
          state.dragNodeId = null;
          this.drop = null;
        }}
        onDragOver={(e) => this.onDragOver(e, node, isRoot)}
        onDragLeave={() => {
          if (this.drop?.id === node.id) this.drop = null;
        }}
        onDrop={(e) => this.onDrop(e)}
      >
        {branch && branch.children.length ? (
          <button
            class="twisty"
            aria-label={open ? 'Collapse' : 'Expand'}
            onClick={(e) => {
              e.stopPropagation();
              this.toggle(node.id);
            }}
          >
            {open ? '▾' : '▸'}
          </button>
        ) : (
          <span class="twisty" />
        )}
        <span class={{ kind: true, leaf: !branch }}>{nodeKind(node)}</span>
        <span class="label">
          {nodeLabel(node)}
          {branch?.classes.length ? <span class="sub">.{branch.classes.join('.')}</span> : null}
        </span>
        {overrides ? (
          <span class="badge" title={`Styles overridden on ${overrides} display${overrides === 1 ? '' : 's'}`}>
            ◐{overrides}
          </span>
        ) : null}
        {!isRoot && selected ? (
          <span class="row-actions">
            <button class="icon-btn" title="Move up" onClick={(e) => (e.stopPropagation(), nudge(node.id, -1))}>
              <Icon name="up" />
            </button>
            <button class="icon-btn" title="Move down" onClick={(e) => (e.stopPropagation(), nudge(node.id, 1))}>
              <Icon name="down" />
            </button>
            <button class="icon-btn" title="Duplicate (Ctrl+D)" onClick={(e) => (e.stopPropagation(), duplicateSelected())}>
              <Icon name="copy" />
            </button>
            <button class="icon-btn danger" title="Delete (Del)" onClick={(e) => (e.stopPropagation(), removeSelected())}>
              <Icon name="trash" />
            </button>
          </span>
        ) : null}
      </div>
    );
    const kids = branch && open ? branch.children.flatMap((c) => this.renderNode(c, depth + 1)) : [];
    return [row, ...kids];
  }

  render() {
    const tree = currentTree();
    if (!tree) return <p class="empty">No tree selected.</p>;
    return (
      <div class="outline" role="tree" aria-label={`Outline of ${tree.name}`}>
        {this.renderNode(tree.root, 0, true)}
        {tree.root.children.length === 0 ? <p class="empty">This tree is bare. Add branches from the Branches tab.</p> : null}
      </div>
    );
  }
}
