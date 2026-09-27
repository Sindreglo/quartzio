import type { GanttController, HistoryState, ViewState } from '@quartzio/gantt';
import { type RefObject, useEffect, useState } from 'react';

/** A part of the state of the chart behind `ref`, kept up to date (`initial` until it's mounted). */
export function useGanttState<T>(
  ref: RefObject<GanttController | null>,
  pick: (state: ViewState) => T,
  initial: T,
): T {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    const gantt = ref.current;
    if (!gantt) return;
    setValue(pick(gantt.getState()));
    return gantt.subscribe((state) => {
      setValue(pick(state));
    });
    // `pick` is expected to be a stable selector (defined outside the component).
  }, [ref]);
  return value;
}

const pickHistory = (state: ViewState) => state.history;
const NO_HISTORY: HistoryState = { canUndo: false, canRedo: false };

/** The history state of the chart behind `ref` (for Undo and Redo buttons). */
export function useHistory(ref: RefObject<GanttController | null>): HistoryState {
  return useGanttState(ref, pickHistory, NO_HISTORY);
}
