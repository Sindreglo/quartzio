import type { CellEdit, GanttController } from '@quartzio/gantt';
import { type FocusEvent, type KeyboardEvent, type RefObject, useLayoutEffect, useRef } from 'react';

const isEditable = (target: EventTarget) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/**
 * Keyboard and focus for the treegrid root: one tab stop that keeps focus (it carries aria-activedescendant).
 * The engine decides what a key does; this stops the keys it used and scrolls the cursor into view.
 */
export function useGridKeyboard(
  gantt: GanttController,
  scrollerRef: RefObject<HTMLDivElement | null>,
  editing: CellEdit | null,
): {
  tabIndex: number;
  onKeyDown: (event: KeyboardEvent) => void;
  onFocus: (event: FocusEvent<HTMLElement>) => void;
  onPointerDownCapture: () => void;
  onPointerUpCapture: () => void;
} {
  // A press focuses what's under it (the scroll area, a toggle button). Only focus that comes from a press is
  // moved back to the root: moving focus reached with Tab would trap the keyboard in the chart.
  const pressing = useRef(false);
  // An edit that moved to another row (Tab) is scrolled into view, so its field is rendered and gets focus.
  const editedTask = editing?.taskId;
  useLayoutEffect(() => {
    const top = editedTask === undefined ? null : gantt.revealTop(editedTask);
    if (top !== null && scrollerRef.current) scrollerRef.current.scrollTop = top;
  }, [gantt, scrollerRef, editedTask]);
  return {
    tabIndex: 0,
    onKeyDown(event) {
      if (isEditable(event.target)) return; // typing in an input inside the chart
      const { key, code, shiftKey: shift, ctrlKey: ctrl, metaKey: meta, altKey: alt } = event;
      if (!gantt.keyDown({ key, code, shift, ctrl, meta, alt })) return;
      event.preventDefault();
      const { activeId } = gantt.getState();
      const top = activeId === null ? null : gantt.revealTop(activeId);
      if (top !== null && scrollerRef.current) scrollerRef.current.scrollTop = top;
    },
    onFocus(event) {
      if (pressing.current && event.target !== event.currentTarget && !isEditable(event.target)) {
        event.currentTarget.focus({ preventScroll: true });
      }
    },
    onPointerDownCapture() {
      pressing.current = true;
    },
    onPointerUpCapture() {
      pressing.current = false;
    },
  };
}
