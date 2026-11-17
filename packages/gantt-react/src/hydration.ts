import type { GanttOptions, ProjectState } from '@quartzio/gantt';
import { useSyncExternalStore } from 'react';

// Nothing to subscribe to: the value only changes once, from the server snapshot to the client's.
const unsubscribe = (): void => undefined;
const subscribe = () => unsubscribe;

/**
 * `false` while rendering on the server and while hydrating the server's HTML, `true` from then on (and right
 * away in an app that only renders on the client). What differs between the server and the browser (the host's
 * time zone and language, the current time) waits for `true`, so the browser's first render matches the HTML.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

/**
 * Whether the chart would render differently on the server than in the browser: with the host's language or time
 * zone, or with a timeline range taken from the clock (no range given and no dated task), which moves on between
 * rendering the HTML and hydrating it.
 */
export function dependsOnHost(options: GanttOptions, project: ProjectState): boolean {
  if (options.locale === undefined || project.settings.timeZone === 'local') return true;
  if (options.startDate !== undefined && options.endDate !== undefined) return false;
  for (const task of project.tasks.byId.values()) {
    if (task.startDate !== null || task.endDate !== null) return false;
  }
  return true;
}
