import { Config } from '@stencil/core';

export const config: Config = {
  namespace: 'treeweaver',
  globalStyle: 'src/global/app.css',
  taskQueue: 'async',
  sourceMap: true,
  // Build-time settings, read in src/config.ts. See "Deployment settings" in the README.
  env: {
    TW_CSS_URLS: process.env.TW_CSS_URLS ?? '',
    TW_DISABLE_CSS_URLS: process.env.TW_DISABLE_CSS_URLS ?? '',
  },
  outputTargets: [
    {
      type: 'www',
      serviceWorker: null,
      baseUrl: '/',
      copy: [{ src: 'favicon.svg' }],
    },
  ],
};
