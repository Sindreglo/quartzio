import type { DependencyInput, ProjectInput, TaskInput } from '@quartzio/gantt';

/**
 * A large project for performance demos: `groups` phases of `perGroup` tasks. Tasks in a phase follow each
 * other (finish-to-start), and each phase starts three days after the previous one (start-to-start), in runs of
 * 100 phases, so the project is scheduled like a real one instead of piling up on the project start.
 */
export function generateProject(groups: number, perGroup: number): ProjectInput {
  const tasks: TaskInput[] = Array.from({ length: groups }, (_, g) => ({
    id: `g${String(g)}`,
    name: `Phase ${String(g + 1)}`,
    children: Array.from({ length: perGroup }, (_, t) => ({
      id: `g${String(g)}t${String(t)}`,
      name: `Task ${String(g + 1)}.${String(t + 1)}`,
      duration: 1 + ((g + t) % 5),
      percentDone: ((g * 7 + t * 13) % 11) * 10,
    })),
  }));
  const dependencies: DependencyInput[] = [];
  for (let g = 0; g < groups; g++) {
    for (let t = 1; t < perGroup; t++) {
      dependencies.push({
        id: `g${String(g)}d${String(t)}`,
        from: `g${String(g)}t${String(t - 1)}`,
        to: `g${String(g)}t${String(t)}`,
      });
    }
    if (g % 100 !== 0) {
      dependencies.push({
        id: `g${String(g)}p`,
        from: `g${String(g - 1)}`,
        to: `g${String(g)}`,
        type: 'SS',
        lag: 3,
      });
    }
  }
  return { settings: { timeZone: 'UTC', startDate: '2026-01-05' }, tasks, dependencies };
}
