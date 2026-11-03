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
    TW_DISPLAYS: process.env.TW_DISPLAYS ?? '',
    TW_LOCK_DISPLAYS: process.env.TW_LOCK_DISPLAYS ?? '',
  },
  outputTargets: [
    {
      type: 'www',
      serviceWorker: null,
      baseUrl: '/',
      copy: [
        { src: 'favicon.svg' },
        // Agent-facing files, published next to the editor (see AGENTS.md and llms.txt).
        { src: '../../../llms.txt', dest: 'llms.txt' },
        { src: '../../../AGENTS.md', dest: 'AGENTS.md' },
        { src: '../../../schema', dest: 'schema' },
        { src: '../../../docs', dest: 'docs' },
        { src: '../../../examples', dest: 'examples' },
      ],
    },
  ],
};
