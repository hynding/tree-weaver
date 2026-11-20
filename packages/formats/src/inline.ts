import { isInlineByDefault } from '@tree-weaver/core';

/** Whether an element is inline by default: a phrasing tag, `<svg>`, `<progress>` …, or a custom element (`my-badge`). */
export const isInlineTag = (tag: string): boolean => isInlineByDefault(tag);

/** Elements whose whitespace is kept as written. */
export const PRE_TAGS = new Set(['pre', 'textarea', 'listing', 'plaintext', 'xmp']);
