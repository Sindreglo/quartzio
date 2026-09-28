import { QuartzioError } from '../util/errors';

/** The task list is never narrower than this, so the divider can always be found and dragged back. */
export const MIN_LIST_WIDTH = 80;
/** Room the timeline keeps when the list is widened. */
export const MIN_TIMELINE_WIDTH = 120;
const KEY_STEP = 10;
const BIG_KEY_STEP = 50;

/**
 * The width of the task list (its pane, border included), as the divider between it and the timeline sets it.
 * `width: null` means automatic: as wide as the columns, up to `--qz-list-max-width`.
 */
export interface ListPaneState {
  readonly width: number | null;
  /** The divider is being dragged. */
  readonly resizing: boolean;
  /** Bounds for the divider: at most as wide as the columns (the chart may show it narrower). */
  readonly min: number;
  readonly max: number;
}

/**
 * What the divider does, sent from the renderer with measured sizes: `width` is the list pane as shown now,
 * `chartWidth` the whole chart's. `x` is any horizontal coordinate that moves with the pointer.
 */
export type ListResizeAction =
  | { readonly type: 'start'; readonly x: number; readonly width: number; readonly chartWidth: number }
  | { readonly type: 'move'; readonly x: number }
  | { readonly type: 'end' }
  | { readonly type: 'cancel' }
  | {
      readonly type: 'key';
      readonly key: string;
      readonly shift?: boolean | undefined;
      readonly width: number;
      readonly chartWidth: number;
    }
  /** Back to automatic (double-click on the divider). */
  | { readonly type: 'reset' };

/** The `listWidth` option: a positive number of pixels, or `null`/`undefined` for automatic. */
export function toListWidth(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 100_000) {
    throw new QuartzioError('Gantt options: "listWidth" must be a positive number of pixels, or null.');
  }
  return value;
}

const finite = (...values: readonly unknown[]): boolean =>
  values.every((value) => typeof value === 'number' && Number.isFinite(value));

export interface ListWidth {
  readonly state: () => ListPaneState;
  /** A new `listWidth` option. The same value again keeps a dragged width; another one ends a drag. */
  readonly setOption: (value: number | null) => void;
  /** The columns' total width changed (it bounds the list). */
  readonly setColumnsWidth: (width: number) => void;
  /**
   * Applies an action: `used` says whether it was one the divider acts on, `changed` the new width to report
   * (`undefined` when there's nothing to report).
   */
  readonly act: (action: ListResizeAction) => { used: boolean; changed?: number | null };
}

/**
 * The divider between the task list and the timeline. Like zooming and the `preset` option: dragging overrides
 * the `listWidth` option until the option changes (compared by value), and the new width is reported.
 */
export function createListWidth(option: number | null, columnsWidth: number): ListWidth {
  // undefined: nothing dragged since the option was set.
  let override: number | null | undefined;
  let columns = columnsWidth;
  let drag: {
    x: number;
    width: number;
    chartWidth: number;
    // What to go back to on cancel, and what the drop is compared with.
    override: number | null | undefined;
    effective: number | null;
  } | null = null;

  function maxOf(columnsTotal: number): number {
    return Math.max(MIN_LIST_WIDTH, Math.round(columnsTotal) + 1);
  }
  // An option below the minimum (a width stored from another layout, say) is shown at the minimum.
  const effective = (): number | null => {
    const width = override === undefined ? option : override;
    return width === null ? null : Math.max(MIN_LIST_WIDTH, width);
  };
  const clamp = (width: number, chartWidth: number) =>
    Math.round(
      Math.min(
        Math.max(width, MIN_LIST_WIDTH),
        Math.max(MIN_LIST_WIDTH, Math.min(maxOf(columns), chartWidth - MIN_TIMELINE_WIDTH)),
      ),
    );
  let current: ListPaneState = {
    width: effective(),
    resizing: false,
    min: MIN_LIST_WIDTH,
    max: maxOf(columns),
  };
  const update = (): void => {
    const next = { width: effective(), resizing: drag !== null, min: MIN_LIST_WIDTH, max: maxOf(columns) };
    if (next.width !== current.width || next.resizing !== current.resizing || next.max !== current.max) {
      current = next;
    }
  };

  return {
    state: () => current,

    setOption(value) {
      if (value === option) return;
      option = value;
      override = undefined;
      drag = null;
      update();
    },

    setColumnsWidth(width) {
      columns = width;
      update();
    },

    act(action) {
      // Plain JavaScript may pass anything.
      if (typeof action !== 'object' || (action as unknown) === null) return { used: false };
      switch (action.type) {
        case 'start': {
          // One drag at a time: a second finger doesn't restart it.
          if (drag || !finite(action.x, action.width, action.chartWidth) || action.chartWidth <= 0)
            return { used: false };
          drag = {
            x: action.x,
            width: action.width,
            chartWidth: action.chartWidth,
            override,
            effective: effective(),
          };
          update();
          return { used: true };
        }
        case 'move': {
          if (!drag || !finite(action.x)) return { used: false };
          const width = clamp(drag.width + action.x - drag.x, drag.chartWidth);
          // A press that hasn't moved the width yet (a click) leaves an automatic width automatic.
          if (override !== drag.override || width !== Math.round(drag.width)) override = width;
          update();
          return { used: true };
        }
        case 'end': {
          if (!drag) return { used: false };
          const moved = effective() !== drag.effective;
          drag = null;
          update();
          return moved ? { used: true, changed: effective() } : { used: true };
        }
        case 'cancel': {
          if (!drag) return { used: false };
          override = drag.override;
          drag = null;
          update();
          return { used: true };
        }
        case 'key': {
          if (drag || !finite(action.width, action.chartWidth) || action.chartWidth <= 0)
            return { used: false };
          const step = action.shift ? BIG_KEY_STEP : KEY_STEP;
          const target =
            action.key === 'ArrowLeft'
              ? action.width - step
              : action.key === 'ArrowRight'
                ? action.width + step
                : action.key === 'Home'
                  ? MIN_LIST_WIDTH
                  : action.key === 'End'
                    ? Number.POSITIVE_INFINITY
                    : null;
          if (target === null) return { used: false };
          // A key at a bound is used, but moves nothing (an automatic width stays automatic).
          const width = clamp(target, action.chartWidth);
          if (width === Math.round(action.width)) return { used: true };
          override = width;
          update();
          return { used: true, changed: width };
        }
        case 'reset': {
          if (drag || effective() === null) return { used: false };
          override = null;
          update();
          return { used: true, changed: null };
        }
        default:
          return { used: false };
      }
    },
  };
}
