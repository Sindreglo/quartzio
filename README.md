# Quartzio

[![npm @quartzio/gantt](https://img.shields.io/npm/v/@quartzio/gantt?label=%40quartzio%2Fgantt)](https://www.npmjs.com/package/@quartzio/gantt) [![npm @quartzio/gantt-react](https://img.shields.io/npm/v/@quartzio/gantt-react?label=%40quartzio%2Fgantt-react)](https://www.npmjs.com/package/@quartzio/gantt-react) [![license](https://img.shields.io/npm/l/@quartzio/gantt)](https://github.com/Sindreglo/quartzio/blob/main/LICENSE)

A Gantt chart library: a headless TypeScript engine that does the scheduling, layout and interaction, with thin
framework wrappers that only draw.

- **Real scheduling:** dependencies of all four types with lag, tasks scheduled as soon as possible, parents that
  span their children, manually scheduled tasks, and the computed dates written back into your data.
- **Working time:** durations in working days and hours, calendars with working hours and holidays, in any time zone.
- **Interaction:** drag to move, resize, draw, link and set progress; cell editing, a task editor, context menus,
  selection, keyboard navigation, undo and redo.
- **Your data:** controlled or uncontrolled, with every change reported as a patch you can save or send.
- **Fast:** virtualized rows, tried with 10 000 tasks.
- **No dependencies**, ESM only, MIT licensed.

| Package                                         | Description                                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------------------ |
| [`@quartzio/gantt-react`](packages/gantt-react) | The React component                                                            |
| [`@quartzio/gantt`](packages/gantt)             | The headless engine: data model, scheduling, time axis, layout and interaction |

## Getting started

```bash
npm install @quartzio/gantt-react @quartzio/gantt
```

```tsx
import type { ProjectInput } from '@quartzio/gantt';
import { Gantt } from '@quartzio/gantt-react';
import '@quartzio/gantt-react/styles.css';

const plan: ProjectInput = {
  settings: { timeZone: 'Europe/Oslo' },
  tasks: [
    { id: 1, name: 'Design', startDate: '2026-10-05', duration: 3 },
    { id: 2, name: 'Build', duration: 10 },
  ],
  dependencies: [{ id: 1, from: 1, to: 2 }],
};

export function App() {
  return <Gantt defaultData={plan} style={{ height: 500 }} />;
}
```

Read more in the [React package](packages/gantt-react) and the [API reference](packages/gantt/API.md).

## Development

Requires Node 24+ and pnpm.

```bash
pnpm install
pnpm dev        # start the playground
pnpm check      # lint, typecheck, test, build
```

## Links

- [API reference](https://github.com/Sindreglo/quartzio/blob/main/packages/gantt/API.md)
- [Release notes](https://github.com/Sindreglo/quartzio/tree/main/release-notes)
- [Report an issue](https://github.com/Sindreglo/quartzio/issues)

## License

MIT © Sindre Glomnes
