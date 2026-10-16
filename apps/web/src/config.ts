import { Env } from '@stencil/core';
import { parseCssUrls } from '@tree-weaver/kits';

/**
 * Deployment settings, read from environment variables when the app is built
 * (see `stencil.config.ts` and the README).
 */

/** `TW_CSS_URLS`: stylesheets every forest loads first, in this order. */
export const ENV_CSS_URLS: string[] = parseCssUrls(Env.TW_CSS_URLS);

/** `TW_DISABLE_CSS_URLS`: when true, the kits panel has no field for linking stylesheet URLs. */
export const CSS_URL_INPUT_ENABLED: boolean = !/^(1|true|yes|on)$/i.test((Env.TW_DISABLE_CSS_URLS ?? '').trim());
