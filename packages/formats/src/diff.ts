import { diffForests, type Forest, type ForestDiff } from '@tree-weaver/core';
import type { TreeDocument } from './types';

function asForest(doc: TreeDocument, treeId?: string): Forest {
  if (doc.kind === 'forest') return doc.forest;
  const tree = treeId ? { ...doc.tree, id: treeId } : doc.tree;
  return { id: '', name: '', version: 1, trees: [tree], kits: doc.kits, createdAt: tree.createdAt, updatedAt: tree.updatedAt };
}

/**
 * Differences between two documents. Two trees are compared as versions of one tree even when
 * their ids differ; a tree and a forest compare the tree with the forest's trees.
 */
export function diffDocuments(before: TreeDocument, after: TreeDocument): ForestDiff {
  if (before.kind === 'tree' && after.kind === 'tree') return diffForests(asForest(before), asForest(after, before.tree.id));
  const diff = diffForests(asForest(before), asForest(after));
  // A tree has no forest name; don't report the wrapper's empty name as a rename.
  if (before.kind !== after.kind && diff.renamed) {
    const { renamed: _, ...rest } = diff;
    return { ...rest, empty: !rest.trees.length && !rest.kits.length };
  }
  return diff;
}
