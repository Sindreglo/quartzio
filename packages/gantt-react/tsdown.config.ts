import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  platform: 'browser',
  dts: true,
  sourcemap: true,
  copy: [{ from: 'src/styles.css', to: 'dist' }],
});
