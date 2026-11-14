import { Env } from '@stencil/core';
import { parseCssUrls } from '@tree-weaver/kits';
import { parseDisplaySettings, type ParsedDisplaySettings } from '@tree-weaver/core';
import { parseTitleGlobs } from '@tree-weaver/formats';

/**
 * Deployment settings, read from environment variables when the app is built
 * (see `stencil.config.ts` and the README).
 */

/** `TW_CSS_URLS`: stylesheets every forest loads first, in this order. */
export const ENV_CSS_URLS: string[] = parseCssUrls(Env.TW_CSS_URLS);

/** `TW_DISABLE_CSS_URLS`: when true, the kits panel has no field for linking stylesheet URLs. */
export const CSS_URL_INPUT_ENABLED: boolean = !/^(1|true|yes|on)$/i.test((Env.TW_DISABLE_CSS_URLS ?? '').trim());

/**
 * `TW_DISPLAYS`: display sizes and breakpoints fixed by the deployment, such as
 * `xl.breakpoint=1600,tablet.size=768x1024`. Values set here can't be changed in the app.
 */
export const ENV_DISPLAYS: ParsedDisplaySettings = parseDisplaySettings(Env.TW_DISPLAYS);

/** `TW_LOCK_DISPLAYS`: when true, no display setting can be changed in the app. */
export const DISPLAYS_LOCKED: boolean = /^(1|true|yes|on)$/i.test((Env.TW_LOCK_DISPLAYS ?? '').trim());

/**
 * `TW_STORYBOOK_URLS`: compiled Storybooks offered in the Storybook import. Ones on this
 * site's origin also load into the palette as "From Storybook" libraries on startup.
 */
export const ENV_STORYBOOK_URLS: string[] = (Env.TW_STORYBOOK_URLS ?? '')
  .split(/\s+/)
  .map((u) => u.trim())
  .filter(Boolean);

/** `TW_STORYBOOK_INCLUDE`: title globs such as `Components/**` that limit which stories show up. */
export const ENV_STORYBOOK_INCLUDE: string[] = parseTitleGlobs(Env.TW_STORYBOOK_INCLUDE);

/** `TW_DISABLE_STORYBOOK_IMPORT`: when true, there is no Storybook import. */
export const STORYBOOK_IMPORT_ENABLED: boolean = !/^(1|true|yes|on)$/i.test((Env.TW_DISABLE_STORYBOOK_IMPORT ?? '').trim());

/** `TW_DISABLE_COLLAB`: when true, there is no Share button and `#collab=` links are ignored. */
export const COLLAB_ENABLED: boolean = !/^(1|true|yes|on)$/i.test((Env.TW_DISABLE_COLLAB ?? '').trim());

/**
 * `TW_COLLAB_SIGNALING`: WebSocket signaling servers that introduce collaborators to each other
 * (comma or space separated). They see only encrypted room names and connection offers; edits go
 * browser to browser. Default: the public y-webrtc server.
 */
export const COLLAB_SIGNALING: string[] = (Env.TW_COLLAB_SIGNALING ?? '')
  .split(/[\s,]+/)
  .map((u) => u.trim())
  .filter((u) => /^wss?:\/\//.test(u));
// Tests point the editor at a local server before it starts (scripts/e2e-collab.mjs).
const testSignaling = (globalThis as { __TW_COLLAB_SIGNALING__?: unknown }).__TW_COLLAB_SIGNALING__;
if (Array.isArray(testSignaling)) COLLAB_SIGNALING.splice(0, COLLAB_SIGNALING.length, ...testSignaling.map(String));
if (!COLLAB_SIGNALING.length) COLLAB_SIGNALING.push('wss://y-webrtc-eu.fly.dev');

/**
 * `TW_COLLAB_ICE`: STUN/TURN servers for WebRTC as JSON, e.g.
 * `[{"urls":"turn:turn.example.com","username":"u","credential":"p"}]`. A TURN server lets
 * people behind strict firewalls connect. Default: the browser's own STUN defaults.
 */
export const COLLAB_ICE_SERVERS: RTCIceServer[] = (() => {
  const raw = (Env.TW_COLLAB_ICE ?? '').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as RTCIceServer[]) : [];
  } catch {
    console.warn('TW_COLLAB_ICE is not valid JSON; using the default ICE servers');
    return [];
  }
})();
