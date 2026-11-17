import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  platform: 'neutral',
  // With declaration maps (and src/ in the package), go-to-definition lands in the TypeScript source.
  dts: { sourcemap: true },
  sourcemap: true,
  copy: [{ from: 'src/styles.css', to: 'dist' }],
});
