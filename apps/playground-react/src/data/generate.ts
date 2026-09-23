import type { ProjectInput, TaskInput } from '@quartzio/gantt';

/** A large project for performance demos: `groups` phases of `perGroup` tasks, spread over working days. */
export function generateProject(groups: number, perGroup: number): ProjectInput {
  const start = Date.UTC(2026, 0, 5, 8);
  const day = 86_400_000;
  const tasks: TaskInput[] = Array.from({ length: groups }, (_, g) => ({
    id: `g${String(g)}`,
    name: `Phase ${String(g + 1)}`,
    children: Array.from({ length: perGroup }, (_, t) => ({
      id: `g${String(g)}t${String(t)}`,
      name: `Task ${String(g + 1)}.${String(t + 1)}`,
      startDate: start + ((g * 3 + t) % 400) * day,
      duration: 1 + ((g + t) % 5),
      percentDone: ((g * 7 + t * 13) % 11) * 10,
    })),
  }));
  return { settings: { timeZone: 'UTC' }, tasks };
}
