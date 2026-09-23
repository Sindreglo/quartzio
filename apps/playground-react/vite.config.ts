import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig } from 'vite';

// The "@quartzio/source" condition makes workspace packages resolve to their src/ instead of dist/,
// so edits show up instantly via HMR without building the packages.
export default defineConfig({
  plugins: [react()],
  resolve: {
    conditions: ['@quartzio/source', ...defaultClientConditions],
    alias: [
      // CSS @import doesn't use `conditions`, so without this the wrapper's styles.css would pull in the
      // engine's built dist/styles.css, and style edits wouldn't show up until the next build.
      {
        find: /^@quartzio\/gantt\/styles\.css$/,
        replacement: fileURLToPath(new URL('../../packages/gantt/src/styles.css', import.meta.url)),
      },
    ],
  },
});
