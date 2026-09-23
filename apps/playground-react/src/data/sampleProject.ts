import type { ProjectInput } from '@quartzio/gantt';

const day = (month: number, date: number) => new Date(Date.UTC(2026, month - 1, date));

/** A small, realistic project used across demos. Nested on purpose, to exercise input normalization. */
export const sampleProject: ProjectInput = {
  tasks: [
    {
      id: 'plan',
      name: 'Planning',
      children: [
        { id: 'scope', name: 'Define scope', startDate: day(10, 5), duration: 3, percentDone: 100 },
        { id: 'budget', name: 'Approve budget', startDate: day(10, 8), duration: 2, percentDone: 50 },
      ],
    },
    {
      id: 'build',
      name: 'Build',
      children: [
        { id: 'design', name: 'Design', startDate: day(10, 12), duration: 5 },
        { id: 'develop', name: 'Develop', startDate: day(10, 19), duration: 10 },
        { id: 'test', name: 'Test', startDate: day(11, 2), duration: 5 },
      ],
    },
    { id: 'launch', name: 'Launch', startDate: day(11, 9), duration: 0 },
  ],
  dependencies: [
    { id: 'd1', from: 'scope', to: 'budget' },
    { id: 'd2', from: 'budget', to: 'design' },
    { id: 'd3', from: 'design', to: 'develop' },
    { id: 'd4', from: 'develop', to: 'test' },
    { id: 'd5', from: 'test', to: 'launch' },
  ],
};
