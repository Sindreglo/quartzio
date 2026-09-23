import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig } from 'vite';

// The "@quartzio/source" condition makes workspace packages resolve to their src/ instead of dist/,
// so edits show up instantly via HMR without building the packages.
export default defineConfig({
  plugins: [react()],
  resolve: {
    conditions: ['@quartzio/source', ...defaultClientConditions],
  },
});
