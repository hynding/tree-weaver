/**
 * The Tree Weaver vocabulary:
 *
 * - A **forest** is a project. It holds trees and the design kits they share.
 * - A **tree** is one layout (a page, a screen, a section template).
 * - A **branch** is a component: an element with a tag, classes, attributes,
 *   per-display styles and children.
 * - A **leaf** is content: text or an image that hangs off a branch.
 */

/** Identifier of a display type. `lg` is the base display every other display inherits from. */
export type DisplayId = 'xl' | 'lg' | 'tablet' | 'mobile-landscape' | 'mobile-portrait';

/** CSS declarations keyed by kebab-case property name, e.g. `{ 'grid-template-columns': '1fr 1fr' }`. */
export type StyleMap = Record<string, string>;

/** Styles per display. Missing displays inherit (see `DISPLAYS`). */
export type DisplayStyles = Partial<Record<DisplayId, StyleMap>>;

export type LeafType = 'text' | 'image';

export interface Leaf {
  kind: 'leaf';
  id: string;
  type: LeafType;
  /** Text content for `text`, the image URL for `image`. */
  value: string;
  /** Extra attributes, e.g. `alt` for images. */
  attrs?: Record<string, string>;
}

export interface Branch {
  kind: 'branch';
  id: string;
  /** HTML tag the branch renders as. */
  tag: string;
  /** Optional catalog type the branch was created from (`grid`, `flex-row`, `table`, ...). */
  type?: string;
  /** Optional human friendly name shown in the outline. */
  name?: string;
  classes: string[];
  attrs: Record<string, string>;
  styles: DisplayStyles;
  children: TreeNode[];
}

export type TreeNode = Branch | Leaf;

export interface Tree {
  id: string;
  name: string;
  root: Branch;
  createdAt: string;
  updatedAt: string;
}

export interface DesignKit {
  id: string;
  name: string;
  /** Raw CSS of the kit. */
  css: string;
  enabled: boolean;
  /** Where the kit came from: a file name, a URL, or `builtin`. */
  source?: string;
}

export interface Forest {
  id: string;
  name: string;
  /** Schema version of the forest document. */
  version: 1;
  trees: Tree[];
  kits: DesignKit[];
  createdAt: string;
  updatedAt: string;
}

/** A light listing entry for a stored forest. */
export interface ForestSummary {
  id: string;
  name: string;
  treeCount: number;
  updatedAt: string;
}

export const SCHEMA_VERSION = 1 as const;

export const isBranch = (node: TreeNode | null | undefined): node is Branch => node?.kind === 'branch';
export const isLeaf = (node: TreeNode | null | undefined): node is Leaf => node?.kind === 'leaf';
