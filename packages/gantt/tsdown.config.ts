import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  platform: 'neutral',
  dts: true,
  sourcemap: true,
  copy: [{ from: 'src/styles.css', to: 'dist' }],
});
