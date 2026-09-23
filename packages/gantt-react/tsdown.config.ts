import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  platform: 'browser',
  dts: true,
  sourcemap: true,
  copy: [{ from: 'src/styles.css', to: 'dist' }],
  // The component uses hooks, so frameworks with React Server Components must treat it as client code.
  banner: { js: "'use client';" },
});
