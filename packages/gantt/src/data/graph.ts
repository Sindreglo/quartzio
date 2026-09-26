import { QuartzioError } from '../util/errors';
import { getTreeIndex, type TreeIndex } from './tree';
import type { Dependency, Id, ProjectState, Table } from './types';

const NONE: readonly Dependency[] = [];

export interface DependencyIndex {
  /** Dependencies where the task is the successor (`to`). */
  incoming: (taskId: Id) => readonly Dependency[];
  /** Dependencies where the task is the predecessor (`from`). */
  outgoing: (taskId: Id) => readonly Dependency[];
}

const dependencyCache = new WeakMap<Table<Dependency>, DependencyIndex>();

/** Dependencies per task, in table order. Built in O(n); cached per table. */
export function getDependencyIndex(dependencies: Table<Dependency>): DependencyIndex {
  let index = dependencyCache.get(dependencies);
  if (!index) {
    const incoming = new Map<Id, Dependency[]>();
    const outgoing = new Map<Id, Dependency[]>();
    const add = (map: Map<Id, Dependency[]>, key: Id, dependency: Dependency) => {
      const list = map.get(key);
      if (list) list.push(dependency);
      else map.set(key, [dependency]);
    };
    for (const id of dependencies.order) {
      const dependency = dependencies.byId.get(id) as Dependency;
      add(incoming, dependency.to, dependency);
      add(outgoing, dependency.from, dependency);
    }
    index = {
      incoming: (taskId) => incoming.get(taskId) ?? NONE,
      outgoing: (taskId) => outgoing.get(taskId) ?? NONE,
    };
    dependencyCache.set(dependencies, index);
  }
  return index;
}

/**
 * The order to schedule in. Every task has two nodes: `in` (its requirements) and `out` (its dates). Node
 * `2i` is the `in` node and `2i + 1` the `out` node of task `ids[i]`. Edges:
 * - `out(predecessor) → in(successor)` for each dependency;
 * - `in(parent) → in(child)`: requirements on a parent apply to its children;
 * - `out(child) → out(parent)`: a parent spans its children;
 * - `in(task) → out(task)`.
 * Splitting parents in two is what lets a parent both pass requirements down and roll dates up.
 */
export interface ScheduleGraph {
  readonly ids: readonly Id[];
  /** Node numbers in topological order. */
  readonly order: Int32Array;
}

const graphCache = new WeakMap<TreeIndex, WeakMap<Table<Dependency>, ScheduleGraph>>();
// Dependency tables with the same ends (`from`/`to`, in the same order) as an earlier table, so the graph is
// shared when only other fields (lag, type) change. Points at the first table of such a run, never along a
// chain, so it keeps at most one old table alive.
const sameEnds = new WeakMap<Table<Dependency>, Table<Dependency>>();

/** Records that `next` has the same dependency ends as `previous`, so they can share a schedule graph. */
export function shareDependencyEnds(previous: Table<Dependency>, next: Table<Dependency>): void {
  if (previous !== next) sameEnds.set(next, sameEnds.get(previous) ?? previous);
}

/** Whether two dependency tables have the same records in the same order with the same ends. */
export function sameDependencyEnds(table: Table<Dependency>, previous: Table<Dependency>): boolean {
  if (previous.order.length !== table.order.length) return false;
  for (let i = 0; i < table.order.length; i++) {
    const id = table.order[i] as Id;
    const a = table.byId.get(id);
    const b = previous.byId.get(id);
    if (previous.order[i] !== id || a?.from !== b?.from || a?.to !== b?.to) return false;
  }
  return true;
}

/**
 * Builds the scheduling order in O(n), cached per task structure and dependency table (so field edits reuse it).
 * Throws QuartzioError when dependencies form a cycle, directly or through the hierarchy (e.g. a task that
 * depends on its own parent).
 */
export function getScheduleGraph(state: ProjectState): ScheduleGraph {
  const tree = getTreeIndex(state.tasks);
  const dependencyKey = sameEnds.get(state.dependencies) ?? state.dependencies;
  let byDependencies = graphCache.get(tree);
  const cached = byDependencies?.get(dependencyKey);
  if (cached) return cached;
  const graph = buildScheduleGraph(state);
  if (!byDependencies) {
    byDependencies = new WeakMap();
    graphCache.set(tree, byDependencies);
  }
  byDependencies.set(dependencyKey, graph);
  return graph;
}

/** Builds the graph (uncached), optionally with one more dependency, e.g. to try it for cycles. */
function buildScheduleGraph(state: ProjectState, extra?: { from: Id; to: Id }): ScheduleGraph {
  const ids = state.tasks.order;
  const indexOf = new Map<Id, number>();
  ids.forEach((id, i) => indexOf.set(id, i));

  // Edges as linked lists in flat arrays: fast to build for 10 000s of tasks.
  const nodeCount = ids.length * 2;
  const head = new Int32Array(nodeCount).fill(-1);
  const next: number[] = [];
  const target: number[] = [];
  const inDegree = new Int32Array(nodeCount);
  const edge = (from: number, to: number) => {
    target.push(to);
    next.push(head[from] as number);
    head[from] = target.length - 1;
    inDegree[to] = (inDegree[to] as number) + 1;
  };

  ids.forEach((id, i) => {
    edge(2 * i, 2 * i + 1);
    const parentId = state.tasks.byId.get(id)?.parentId ?? null;
    const p = parentId === null ? undefined : indexOf.get(parentId);
    if (p !== undefined) {
      edge(2 * p, 2 * i);
      edge(2 * i + 1, 2 * p + 1);
    }
  });
  const ends: Iterable<{ from: Id; to: Id }> = extra
    ? [...state.dependencies.byId.values(), extra]
    : state.dependencies.byId.values();
  for (const dependency of ends) {
    const from = indexOf.get(dependency.from);
    const to = indexOf.get(dependency.to);
    if (from !== undefined && to !== undefined) edge(2 * from + 1, 2 * to);
  }

  // Kahn's algorithm, iterative.
  const order = new Int32Array(nodeCount);
  let size = 0;
  for (let node = 0; node < nodeCount; node++) if (inDegree[node] === 0) order[size++] = node;
  for (let read = 0; read < size; read++) {
    for (let e = head[order[read] as number] as number; e !== -1; e = next[e] as number) {
      const to = target[e] as number;
      inDegree[to] = (inDegree[to] as number) - 1;
      if (inDegree[to] === 0) order[size++] = to;
    }
  }
  if (size < nodeCount) throw cycleError(ids, head, next, target, inDegree);

  return { ids, order };
}

/**
 * Names the tasks of one cycle. Nodes left over by Kahn's algorithm (in-degree > 0) all have a leftover
 * predecessor, so walking predecessors from any of them must come back around.
 */
function cycleError(
  ids: readonly Id[],
  head: Int32Array,
  next: readonly number[],
  target: readonly number[],
  inDegree: Int32Array,
): QuartzioError {
  const predecessor = new Map<number, number>();
  for (let from = 0; from < head.length; from++) {
    if (inDegree[from] === 0) continue;
    for (let e = head[from] as number; e !== -1; e = next[e] as number) {
      const to = target[e] as number;
      if ((inDegree[to] as number) > 0 && !predecessor.has(to)) predecessor.set(to, from);
    }
  }
  let node = predecessor.keys().next().value as number;
  const seen = new Map<number, number>();
  const path: number[] = [];
  while (!seen.has(node)) {
    seen.set(node, path.length);
    path.push(node);
    node = predecessor.get(node) as number;
  }
  const cycle = path.slice(seen.get(node)).reverse();
  // Two nodes per task: name each task once, in order around the cycle.
  const names: string[] = [];
  for (const n of cycle) {
    const name = `"${String(ids[n >> 1])}"`;
    if (names[names.length - 1] !== name) names.push(name);
  }
  if (names.length > 1 && names[0] === names[names.length - 1]) names.pop();
  names.push(names[0] as string);
  return new QuartzioError(
    `Dependencies form a cycle: ${names.join(' → ')}. (A task can't depend on its own parent or child, ` +
      `and a task inherits the dependencies of its parents.)`,
  );
}

const cycleCache = new WeakMap<ProjectState, Map<string, boolean>>();

/**
 * Whether a dependency from `from` to `to` would form a cycle (also through the hierarchy). Tries it: builds the
 * graph with it added, in O(n). Cached per state and pair, since a drag asks again on every pointer move.
 */
export function wouldCreateCycle(state: ProjectState, from: Id, to: Id): boolean {
  let byPair = cycleCache.get(state);
  if (!byPair) cycleCache.set(state, (byPair = new Map<string, boolean>()));
  const key = `${typeof from}:${String(from)}→${typeof to}:${String(to)}`;
  const known = byPair.get(key);
  if (known !== undefined) return known;
  let cycle = false;
  try {
    buildScheduleGraph(state, { from, to });
  } catch (error) {
    if (!(error instanceof QuartzioError)) throw error;
    cycle = true;
  }
  byPair.set(key, cycle);
  return cycle;
}
