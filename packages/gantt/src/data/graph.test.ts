import { describe, expect, it } from 'vitest';
import { QuartzioError } from '../util/errors';
import { getDependencyIndex, getScheduleGraph } from './graph';
import { createProjectState } from './normalize';
import { createProject } from './project';
import type { DependencyInput, ProjectInput } from './types';

const deps = (...pairs: [string, string][]): DependencyInput[] =>
  pairs.map(([from, to], i) => ({ id: `d${String(i)}`, from, to }));

describe('getDependencyIndex', () => {
  const state = createProjectState({
    tasks: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    dependencies: deps(['a', 'b'], ['a', 'c'], ['b', 'c']),
  });

  it('lists incoming and outgoing dependencies per task', () => {
    const index = getDependencyIndex(state.dependencies);
    expect(index.outgoing('a').map((d) => d.to)).toEqual(['b', 'c']);
    expect(index.incoming('c').map((d) => d.from)).toEqual(['a', 'b']);
    expect(index.incoming('a')).toEqual([]);
    expect(index.outgoing('unknown')).toEqual([]);
  });

  it('is cached per table', () => {
    expect(getDependencyIndex(state.dependencies)).toBe(getDependencyIndex(state.dependencies));
  });
});

describe('getScheduleGraph', () => {
  // Position of a task's "in" (requirements) and "out" (result) node in the scheduling order.
  const positions = (input: ProjectInput) => {
    const state = createProjectState(input);
    const graph = getScheduleGraph(state);
    const at = new Map<string, number>();
    graph.order.forEach((node, position) => {
      at.set(`${String(graph.ids[node >> 1])}.${node & 1 ? 'out' : 'in'}`, position);
    });
    return (node: string) => at.get(node) ?? -1;
  };

  it('orders predecessors before successors, children before parents, and parents’ requirements first', () => {
    const at = positions({
      tasks: [{ id: 'p', children: [{ id: 'c1' }, { id: 'c2' }] }, { id: 'x' }, { id: 'y' }],
      dependencies: deps(['x', 'p'], ['p', 'y']),
    });
    expect(at('x.out')).toBeLessThan(at('p.in'));
    expect(at('p.in')).toBeLessThan(at('c1.in'));
    expect(at('c1.out')).toBeLessThan(at('p.out'));
    expect(at('c2.out')).toBeLessThan(at('p.out'));
    expect(at('p.out')).toBeLessThan(at('y.in'));
  });

  it('is cached, also across edits that only change fields', () => {
    const project = createProject({ tasks: [{ id: 'a' }, { id: 'b' }], dependencies: deps(['a', 'b']) });
    const graph = getScheduleGraph(project.getState());
    project.transact((tx) => {
      tx.tasks.update('a', { name: 'Renamed' });
    });
    expect(getScheduleGraph(project.getState())).toBe(graph);
  });

  it('is cached across edits of dependency fields other than the ends, also for controlled data', () => {
    const input: ProjectInput = { tasks: [{ id: 'a' }, { id: 'b' }], dependencies: deps(['a', 'b']) };
    const project = createProject(input);
    const graph = getScheduleGraph(project.getState());
    project.transact((tx) => {
      tx.dependencies.update('d0', { lag: 2, type: 'SS' });
    });
    expect(getScheduleGraph(project.getState())).toBe(graph);
    const reloaded = createProjectState(
      { ...input, dependencies: [{ id: 'd0', from: 'a', to: 'b', lag: 5 }] },
      project.getState(),
    );
    expect(getScheduleGraph(reloaded)).toBe(graph);
    // New ends: a new graph.
    project.transact((tx) => {
      tx.dependencies.update('d0', { from: 'b', to: 'a' });
    });
    expect(getScheduleGraph(project.getState())).not.toBe(graph);
  });

  it('handles long chains without deep recursion', () => {
    const ids = Array.from({ length: 20_000 }, (_, i) => `t${String(i)}`);
    const state = createProjectState({
      tasks: ids.map((id) => ({ id })),
      dependencies: ids.slice(1).map((id, i) => ({ id: `d${String(i)}`, from: ids[i] as string, to: id })),
    });
    expect(getScheduleGraph(state).order).toHaveLength(40_000);
  });
});

describe('dependency cycles', () => {
  const load = (input: ProjectInput) => () => createProjectState(input);

  it.each<[string, ProjectInput, RegExp]>([
    [
      'two tasks',
      { tasks: [{ id: 'a' }, { id: 'b' }], dependencies: deps(['a', 'b'], ['b', 'a']) },
      /"a" → "b" → "a"|"b" → "a" → "b"/,
    ],
    [
      'three tasks',
      {
        tasks: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
        dependencies: deps(['a', 'b'], ['b', 'c'], ['c', 'a']),
      },
      /cycle/,
    ],
    [
      'a child on its parent',
      { tasks: [{ id: 'p', children: [{ id: 'c' }] }], dependencies: deps(['c', 'p']) },
      /cycle/,
    ],
    [
      'a parent on its child',
      { tasks: [{ id: 'p', children: [{ id: 'c' }] }], dependencies: deps(['p', 'c']) },
      /cycle/,
    ],
    [
      'through the hierarchy',
      // c belongs to p; c → q, and q → p, which c inherits.
      {
        tasks: [{ id: 'p', children: [{ id: 'c' }] }, { id: 'q' }],
        dependencies: deps(['c', 'q'], ['q', 'p']),
      },
      /cycle/,
    ],
    [
      'a grandchild on its grandparent',
      {
        tasks: [{ id: 'g', children: [{ id: 'p', children: [{ id: 'c' }] }] }],
        dependencies: deps(['c', 'g']),
      },
      /cycle/,
    ],
  ])('rejects %s when loading', (_, input, message) => {
    expect(load(input)).toThrow(QuartzioError);
    expect(load(input)).toThrow(message);
  });

  it('finds a cycle at the end of a long chain', () => {
    const ids = Array.from({ length: 10_000 }, (_, i) => `t${String(i)}`);
    const chain = ids.slice(1).map((id, i): [string, string] => [ids[i] as string, id]);
    expect(
      load({ tasks: ids.map((id) => ({ id })), dependencies: deps(...chain, ['t9999', 't5000']) }),
    ).toThrow(/cycle/);
  });

  it('accepts diamonds, parallel chains and dependencies between different branches', () => {
    expect(
      load({
        tasks: [
          { id: 'p', children: [{ id: 'p1' }, { id: 'p2' }] },
          { id: 'q', children: [{ id: 'q1' }] },
          { id: 'a' },
          { id: 'b' },
          { id: 'c' },
          { id: 'd' },
        ],
        dependencies: deps(
          ['a', 'b'],
          ['a', 'c'],
          ['b', 'd'],
          ['c', 'd'],
          ['p1', 'q1'],
          ['p', 'q'],
          ['p1', 'p2'],
        ),
      }),
    ).not.toThrow();
  });

  it('rejects a cycle created in a transaction or by raw operations, and changes nothing', () => {
    const project = createProject({
      tasks: [{ id: 'p', children: [{ id: 'c' }] }, { id: 'a' }, { id: 'b' }],
      dependencies: deps(['a', 'b']),
    });
    const state = project.getState();
    expect(() =>
      project.transact((tx) => {
        tx.dependencies.add({ from: 'b', to: 'a' });
      }),
    ).toThrow(/cycle/);
    // Moving a task under the parent it depends on makes a cycle through the hierarchy.
    project.transact((tx) => {
      tx.dependencies.add({ id: 'cp', from: 'b', to: 'c' });
    });
    const withDependency = project.getState();
    expect(() =>
      project.transact((tx) => {
        tx.tasks.move('b', { parentId: 'c' });
      }),
    ).toThrow(/cycle/);
    expect(() =>
      project.apply([{ type: 'update', store: 'dependencies', id: 'd0', changes: { from: 'c', to: 'b' } }]),
    ).toThrow(/cycle/);
    expect(project.getState()).toBe(withDependency);
    expect(state.dependencies.byId.size).toBe(1);
  });
});
