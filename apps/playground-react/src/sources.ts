// The playground's own source files, as text, so a demo can show the code that renders it: it is the same file,
// so it can't fall out of step with what runs.
// Only the scenarios show their code.
const files = import.meta.glob<string>(
  ['./demos/version-0-1/*.tsx', './demos/useHistory.ts', './data/renovation.ts', './data/construction.ts'],
  {
    query: '?raw',
    import: 'default',
    eager: true,
  },
);

/** A file's source, by its path from src/ (e.g. `demos/drag.tsx`). */
export function sourceOf(path: string): string | undefined {
  return files[`./${path}`];
}
