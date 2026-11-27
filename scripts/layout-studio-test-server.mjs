import { createServer } from 'node:http';
import { build } from 'esbuild';
import { imageConfigDefault } from 'next/dist/shared/lib/image-config.js';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';

// Next replaces this value at build time for `next/image`. This fixture bundles
// the real client component outside Next, so provide the framework's default
// image config instead of leaving a Node-only `process.env` reference in the
// browser bundle (which prevents React from mounting the fixture at all).
const bundled = await build({
  entryPoints: ['tests/fixtures/layout-studio-entry.tsx'],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  define: {
    'process.env.NODE_ENV': '"test"',
    'process.env.__NEXT_IMAGE_OPTS': JSON.stringify(imageConfigDefault),
  },
});
const code = bundled.outputFiles[0].contents;
const css = (await postcss([tailwindcss({ content: ['components/admin/layout-studio.tsx', 'components/admin/layout-widget-preview.tsx', 'tests/fixtures/layout-studio-entry.tsx'] })]).process('@tailwind base; @tailwind components; @tailwind utilities;', { from: undefined })).css;
const server = createServer((request, response) => {
  if (request.url === '/style.css') { response.setHeader('Content-Type', 'text/css'); response.end(css); }
  else if (request.url === '/bundle.js') { response.setHeader('Content-Type', 'application/javascript'); response.end(code); }
  else if (request.url === '/approved-image.svg') { response.setHeader('Content-Type', 'image/svg+xml'); response.end('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="green"/><text x="20" y="40">Approved local test image</text></svg>'); }
  else if (request.url === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><html><head><link rel="stylesheet" href="/style.css"/></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>'); }
  else { response.writeHead(404); response.end(); }
});
server.listen(3147, '127.0.0.1');
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
