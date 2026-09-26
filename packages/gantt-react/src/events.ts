import type { KeyModifiers } from '@quartzio/gantt';
import type { MouseEvent } from 'react';

/** A mouse event's point in the chart's coordinates (from the root element's corner), for menus. */
export function chartPoint(event: MouseEvent): { x: number; y: number } {
  const root = (event.currentTarget as HTMLElement).closest('.qz-gantt');
  const box = root?.getBoundingClientRect();
  return { x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0) };
}

export const modifiersOf = (event: MouseEvent): KeyModifiers => ({
  shift: event.shiftKey,
  ctrl: event.ctrlKey,
  meta: event.metaKey,
  alt: event.altKey,
});

/**
 * Gives focus back to the chart once an element that had it is really gone (a closed menu or editor): checked
 * after a microtask, as StrictMode runs effect cleanups once without removing anything.
 */
export function focusBackWhenGone(element: HTMLElement | null, focusChart: () => void): void {
  if (!element?.contains(document.activeElement)) return;
  queueMicrotask(() => {
    const now = document.activeElement;
    if (!element.isConnected && (now === null || now === document.body)) focusChart();
  });
}
