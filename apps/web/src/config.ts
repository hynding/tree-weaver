import { Env } from '@stencil/core';
import { parseCssUrls } from '@tree-weaver/kits';
import { parseDisplaySettings, type ParsedDisplaySettings } from '@tree-weaver/core';

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
