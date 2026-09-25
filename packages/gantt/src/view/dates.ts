import type { Task } from '../data/types';

/** A task's dates as shown (scheduling keeps them in the task itself, see ADR 0008). */
export interface TaskDates {
  readonly start: number;
  readonly end: number;
}

/** Start and end; zero-length when only one is set (unscheduled data); `null` when neither is. */
export function taskDates(task: Task): TaskDates | null {
  const start = task.startDate ?? task.endDate;
  const end = task.endDate ?? task.startDate;
  return start === null || end === null ? null : { start, end: Math.max(start, end) };
}
