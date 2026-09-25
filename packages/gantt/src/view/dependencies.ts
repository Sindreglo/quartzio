import { getTreeIndex } from '../data/tree';
import type { Dependency, DependencyType, Id, ProjectState, Task } from '../data/types';
import type { TimeAxis } from '../timeaxis/timeAxis';
import { computeBar, type Bar } from './bars';
import { taskDates } from './dates';
import { rowKey, type RowsState } from './rows';

/** A dependency drawn as an arrow between two bars, in timeline coordinates. */
export interface DependencyLine {
  /** Unique string key for rendering lists (ids 1 and "1" are different dependencies). */
  readonly key: string;
  readonly id: Id;
  readonly from: Id;
  readonly to: Id;
  readonly type: DependencyType;
  /** SVG path data, orthogonal, ending at the successor (put the arrowhead there with `marker-end`). */
  readonly path: string;
}

/** Horizontal distance a line runs straight out of a bar, and straight into one. */
const STUB = 8;
/** Half the width of a milestone diamond, so lines end at its tips (matches the default `--qz-milestone-size`). */
const MILESTONE_RADIUS = 7;

const EMPTY: readonly DependencyLine[] = [];

export interface DependencyLinesInput {
  readonly project: ProjectState;
  readonly timeAxis: TimeAxis;
  readonly rows: RowsState;
  /** Row index of every visible task (collapsed-away tasks are missing). */
  readonly rowIndex: ReadonlyMap<Id, number>;
}

/**
 * Lines for the dependencies near the rendered rows: those with an end in them, or passing through them.
 * Dependencies to unscheduled or collapsed-away tasks aren't drawn. The array is reused while nothing it
 * depends on changes (e.g. while scrolling within the rendered rows).
 */
export function createDependencyView(): {
  linesFor: (input: DependencyLinesInput) => readonly DependencyLine[];
} {
  let cache: { key: unknown[]; lines: readonly DependencyLine[] } | undefined;
  // Lines by key from the last call: unchanged ones keep their identity, so renderers can skip them.
  let previous = new Map<string, DependencyLine>();

  const linesFor = ({
    project,
    timeAxis,
    rows,
    rowIndex,
  }: DependencyLinesInput): readonly DependencyLine[] => {
    const key = [project.dependencies, project.tasks, timeAxis, rows.items, rowIndex];
    if (cache && key.every((part, i) => part === cache?.key[i])) return cache.lines;

    const first = rows.items[0]?.index;
    const last = rows.items.at(-1)?.index;
    let lines: readonly DependencyLine[] = EMPTY;
    if (first !== undefined && last !== undefined && project.dependencies.order.length > 0) {
      const tree = getTreeIndex(project.tasks);
      // Bars of rendered rows, and of other tasks computed once per call (a task can have many dependencies).
      const bars = new Map<Id, Bar | null>(rows.items.map((row) => [row.id, row.bar]));
      const barOf = (id: Id): Bar | null => {
        let bar = bars.get(id);
        if (bar === undefined) {
          const task = project.tasks.byId.get(id) as Task;
          bar = computeBar(task, taskDates(task), !tree.isLeaf(id), timeAxis);
          bars.set(id, bar);
        }
        return bar;
      };
      const result: DependencyLine[] = [];
      const kept = new Map<string, DependencyLine>();
      for (const id of project.dependencies.order) {
        const dependency = project.dependencies.byId.get(id) as Dependency;
        const fromRow = rowIndex.get(dependency.from);
        const toRow = rowIndex.get(dependency.to);
        if (fromRow === undefined || toRow === undefined) continue;
        if (Math.max(fromRow, toRow) < first || Math.min(fromRow, toRow) > last) continue;
        const fromBar = barOf(dependency.from);
        const toBar = barOf(dependency.to);
        if (!fromBar || !toBar) continue;
        const lineKey = rowKey(id);
        const path = route(dependency.type, fromBar, fromRow, toBar, toRow, rows.rowHeight);
        const old = previous.get(lineKey);
        const line =
          old?.path === path &&
          old.from === dependency.from &&
          old.to === dependency.to &&
          old.type === dependency.type
            ? old
            : { key: lineKey, id, from: dependency.from, to: dependency.to, type: dependency.type, path };
        kept.set(lineKey, line);
        result.push(line);
      }
      lines = result;
      previous = kept;
    }
    cache = { key, lines };
    return lines;
  };

  return { linesFor };
}

function edge(bar: Bar, side: 'start' | 'end'): number {
  if (bar.kind === 'milestone') return bar.x + (side === 'start' ? -MILESTONE_RADIUS : MILESTONE_RADIUS);
  return side === 'start' ? bar.x : bar.x + bar.width;
}

const round = (value: number) => Math.round(value * 10) / 10;

/**
 * An orthogonal path, like Bryntum's: straight out of the predecessor's side (its end for FS/FF, its start for
 * SS/SF), one vertical run, and straight into the successor's side (its start for FS/SS, its end for FF/SF).
 * When no single vertical run leaves room for both straight parts, the line goes around along the boundary of
 * the successor's row.
 */
function route(
  type: DependencyType,
  from: Bar,
  fromRow: number,
  to: Bar,
  toRow: number,
  rowHeight: number,
): string {
  const fromEnd = type === 'FS' || type === 'FF';
  const toStart = type === 'FS' || type === 'SS';
  const x1 = edge(from, fromEnd ? 'end' : 'start');
  const x2 = edge(to, toStart ? 'start' : 'end');
  const y1 = fromRow * rowHeight + rowHeight / 2;
  const y2 = toRow * rowHeight + rowHeight / 2;
  const out = fromEnd ? 1 : -1; // direction out of the predecessor
  const into = toStart ? 1 : -1; // direction into the successor

  // Where the vertical run can be: at least STUB out of the predecessor and STUB before the successor.
  const lower = Math.max(out === 1 ? x1 + STUB : -Infinity, into === 1 ? -Infinity : x2 + STUB);
  const upper = Math.min(out === 1 ? Infinity : x1 - STUB, into === 1 ? x2 - STUB : Infinity);
  const f = (...values: number[]) => values.map((value) => String(round(value)));
  if (lower <= upper) {
    const [a, b, c, d, e] = f(x1, y1, out === 1 ? lower : upper, y2, x2);
    return `M${a} ${b} H${c} V${d} H${e}`;
  }
  const boundary = toRow > fromRow ? y2 - rowHeight / 2 : y2 + rowHeight / 2;
  const [a, b, c, d, e, g, h] = f(x1, y1, x1 + out * STUB, boundary, x2 - into * STUB, y2, x2);
  return `M${a} ${b} H${c} V${d} H${e} V${g} H${h}`;
}
