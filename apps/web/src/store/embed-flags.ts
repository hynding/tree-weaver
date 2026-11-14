/**
 * How the editor was opened, from its URL. Kept apart from `embed.ts` so the store can
 * read it without importing the host bridge.
 *
 * - `?embed=1`: running inside a host page (an iframe or `<tree-weaver-editor>`). Documents
 *   stay in memory and the `postMessage` API is on.
 * - `?origin=https://host.example`: the origins allowed to drive an embedded editor
 *   (comma-separated). Without it, the first host page to send a message is the one allowed.
 * - `?src=<url>` or `#doc=<base64url>`: a document to open on startup.
 */
const params = typeof location === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search);

export const isEmbedded = (): boolean => /^(1|true|yes|on|)$/i.test(params.get('embed') ?? 'no');

export const allowedOrigins = (): string[] =>
  (params.get('origin') ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => /^https?:\/\/[^/\s]+$/i.test(o));

/** Read live: the URL is cleaned once the document has opened. */
export const sourceUrl = (): string | null => new URLSearchParams(location.search).get('src');
