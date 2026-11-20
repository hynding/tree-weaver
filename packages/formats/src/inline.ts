import { INLINE_TAGS } from '@tree-weaver/core';

/** Elements that sit in a line of text by default, beyond core's phrasing tags. */
const MORE_INLINE = new Set([
  'audio', 'canvas', 'iframe', 'math', 'meter', 'object', 'output', 'picture', 'progress', 'ruby', 'slot', 'svg', 'tspan', 'video',
]);

/** Whether an element is inline by default: a phrasing tag, or a custom element (`my-badge`). */
export const isInlineTag = (tag: string): boolean => INLINE_TAGS.has(tag) || MORE_INLINE.has(tag) || tag.includes('-');

/** Elements whose whitespace is kept as written. */
export const PRE_TAGS = new Set(['pre', 'textarea', 'listing', 'plaintext', 'xmp']);
