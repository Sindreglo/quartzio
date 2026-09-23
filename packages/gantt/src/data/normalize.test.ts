import { describe, expect, it } from 'vitest';
import { QuartzioError } from '../util/errors';
import { createProjectState } from './normalize';

const JAN_5 = Date.UTC(2026, 0, 5);

describe('createProjectState', () => {
  it('creates an empty project by default', () => {
    const state = createProjectState();
    expect(state.tasks.order).toEqual([]);
    expect(state.dependencies.order).toEqual([]);
  });

  it('fills in defaults so every field is present', () => {
    const state = createProjectState({ tasks: [{ id: 1 }] });
    expect(state.tasks.byId.get(1)).toEqual({
      id: 1,
      parentId: null,
      name: '',
      startDate: null,
      endDate: null,
      duration: null,
      durationUnit: 'day',
      percentDone: 0,
    });
  });

  it('converts Date values to epoch milliseconds', () => {
    const state = createProjectState({ tasks: [{ id: 'a', startDate: new Date(JAN_5), endDate: JAN_5 }] });
    expect(state.tasks.byId.get('a')).toMatchObject({ startDate: JAN_5, endDate: JAN_5 });
  });

  it('flattens nested children depth-first and sets their parentId', () => {
    const state = createProjectState({
      tasks: [
        { id: 'p', children: [{ id: 'c1', children: [{ id: 'g' }] }, { id: 'c2' }] },
        { id: 'q', parentId: null },
      ],
    });
    expect(state.tasks.order).toEqual(['p', 'c1', 'g', 'c2', 'q']);
    expect(state.tasks.byId.get('g')?.parentId).toBe('c1');
    expect(state.tasks.byId.get('c2')?.parentId).toBe('p');
  });

  it('accepts flat tasks with parentId, in any order', () => {
    const state = createProjectState({ tasks: [{ id: 'child', parentId: 'parent' }, { id: 'parent' }] });
    expect(state.tasks.byId.get('child')?.parentId).toBe('parent');
  });

  it('normalizes dependencies with defaults', () => {
    const state = createProjectState({
      tasks: [{ id: 1 }, { id: 2 }],
      dependencies: [{ id: 'd', from: 1, to: 2 }],
    });
    expect(state.dependencies.byId.get('d')).toEqual({
      id: 'd',
      from: 1,
      to: 2,
      type: 'FS',
      lag: 0,
      lagUnit: 'day',
    });
  });

  it.each([
    ['duplicate task ids', { tasks: [{ id: 1 }, { id: 1 }] }, /defined more than once/],
    ['a missing parent', { tasks: [{ id: 1, parentId: 99 }] }, /does not exist/],
    [
      'a parent cycle',
      {
        tasks: [
          { id: 1, parentId: 2 },
          { id: 2, parentId: 1 },
        ],
      },
      /parent cycle/,
    ],
    [
      'conflicting nesting and parentId',
      { tasks: [{ id: 1, children: [{ id: 2, parentId: 3 }] }] },
      /nested/,
    ],
    ['an invalid date', { tasks: [{ id: 1, startDate: new Date('nope') }] }, /startDate/],
    ['a negative duration', { tasks: [{ id: 1, duration: -1 }] }, /duration/],
    ['percentDone above 100', { tasks: [{ id: 1, percentDone: 120 }] }, /percentDone/],
    ['an empty id', { tasks: [{ id: '' }] }, /id must be/],
    [
      'a dependency to a missing task',
      { tasks: [{ id: 1 }], dependencies: [{ id: 'd', from: 1, to: 2 }] },
      /"to"/,
    ],
    ['a self-dependency', { tasks: [{ id: 1 }], dependencies: [{ id: 'd', from: 1, to: 1 }] }, /itself/],
  ])('rejects %s', (_, input, message) => {
    expect(() => createProjectState(input)).toThrow(QuartzioError);
    expect(() => createProjectState(input)).toThrow(message);
  });
});
