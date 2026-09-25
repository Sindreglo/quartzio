import type { ProjectInput } from '@quartzio/gantt';

const day = (month: number, date: number) => new Date(Date.UTC(2026, month - 1, date));

/**
 * A small, realistic project used across demos. Nested on purpose, to exercise input normalization. Tasks are
 * scheduled automatically: only the first one has a start (the project start); the rest follow dependencies.
 */
export const sampleProject: ProjectInput = {
  tasks: [
    {
      id: 'plan',
      name: 'Planning',
      children: [
        { id: 'scope', name: 'Define scope', startDate: day(10, 5), duration: 3, percentDone: 100 },
        { id: 'budget', name: 'Approve budget', duration: 2, percentDone: 50 },
      ],
    },
    {
      id: 'build',
      name: 'Build',
      children: [
        { id: 'design', name: 'Design', duration: 5 },
        { id: 'develop', name: 'Develop', duration: 10 },
        { id: 'test', name: 'Test', duration: 5 },
      ],
    },
    { id: 'launch', name: 'Launch', duration: 0 },
  ],
  dependencies: [
    { id: 'd1', from: 'scope', to: 'budget' },
    { id: 'd2', from: 'budget', to: 'design' },
    { id: 'd3', from: 'design', to: 'develop' },
    { id: 'd4', from: 'develop', to: 'test' },
    { id: 'd5', from: 'test', to: 'launch' },
  ],
};
