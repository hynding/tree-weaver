import { isBranch, type TreeNode } from '@tree-weaver/core';

/** Short label for a node in the outline, breadcrumbs and inspector. */
export function nodeLabel(node: TreeNode): string {
  if (!isBranch(node)) {
    if (node.type === 'image') return node.attrs?.alt || node.value.split('/').pop() || 'Image';
    const t = node.value.trim();
    return t ? (t.length > 40 ? `${t.slice(0, 40)}…` : t) : '(empty text)';
  }
  if (node.name) return node.name;
  const textChild = node.children.find((c) => !isBranch(c) && c.type === 'text');
  if (textChild && !isBranch(textChild) && textChild.value.trim()) {
    const t = textChild.value.trim();
    return t.length > 30 ? `${t.slice(0, 30)}…` : t;
  }
  return node.type ?? node.tag;
}

export function nodeKind(node: TreeNode): string {
  if (!isBranch(node)) return node.type === 'image' ? 'img' : 'text';
  return node.tag;
}

/** Read a file chosen by the user as text. */
export function readFileText(file: File): Promise<string> {
  return file.text();
}
