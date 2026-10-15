import { Config } from '@stencil/core';

export const config: Config = {
  namespace: 'treeweaver',
  globalStyle: 'src/global/app.css',
  taskQueue: 'async',
  sourceMap: true,
  outputTargets: [
    {
      type: 'www',
      serviceWorker: null,
      baseUrl: '/',
      copy: [{ src: 'favicon.svg' }],
    },
  ],
};
