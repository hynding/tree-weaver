import type { DropPosition } from '../store/actions';

export const BLUEPRINT_MIME = 'application/x-tree-weaver-blueprint';
export const NODE_MIME = 'application/x-tree-weaver-node';

export const hasType = (e: DragEvent, type: string): boolean => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes(type);

/** Is this drag carrying something Tree Weaver can drop? */
export const isTreeDrag = (e: DragEvent): boolean => hasType(e, BLUEPRINT_MIME) || hasType(e, NODE_MIME);

/** Pick before / inside / after from the pointer's position over a row or element. */
export function dropPosition(rect: DOMRect, clientY: number, canContain: boolean): DropPosition {
  const y = (clientY - rect.top) / Math.max(rect.height, 1);
  if (!canContain) return y < 0.5 ? 'before' : 'after';
  if (y < 0.25) return 'before';
  if (y > 0.75) return 'after';
  return 'inside';
}
