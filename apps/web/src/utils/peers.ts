/** Colours for collaborators, by index. Chosen to stand apart from the editor's blue selection. */
export const PEER_COLORS = ['#e11d48', '#d97706', '#059669', '#7c3aed', '#db2777', '#0891b2', '#65a30d', '#c2410c'];

/** Outlines the canvas draws around what each collaborator has selected. */
export const PEER_CANVAS_CSS = PEER_COLORS.map(
  (c, i) => `[data-tw-peer="${i}"] { outline: 2px dashed ${c} !important; outline-offset: 1px; }\nsvg [data-tw-peer="${i}"] { outline: none !important; filter: drop-shadow(0 0 1.5px ${c}); }`,
).join('\n');
