import { BRANCH_ATTR, LEAF_ATTR } from '@tree-weaver/core';

/** The canvas's document, once its frame has loaded, so other views can inspect what it shows. */
let canvasDoc: Document | null = null;

export function setCanvasDocument(doc: Document | null): void {
  canvasDoc = doc;
}

/** The canvas element showing a branch or leaf. */
export function canvasElement(id: string | null): Element | null {
  if (!canvasDoc || !id) return null;
  const esc = (window.CSS?.escape ?? ((s: string) => s))(id);
  return canvasDoc.querySelector(`[${BRANCH_ATTR}="${esc}"], [${LEAF_ATTR}="${esc}"]`);
}
