import type { CellEdit, GanttController, ScrollRequest } from '@quartzio/gantt';
import { type FocusEvent, type KeyboardEvent, type RefObject, useLayoutEffect, useRef } from 'react';

const isEditable = (target: EventTarget) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/** In the context menu or the task editor: they take focus on purpose. */
const inPopup = (target: EventTarget) =>
  target instanceof HTMLElement && target.closest('.qz-menu, .qz-task-editor') !== null;

/**
 * Keyboard and focus for the treegrid root: one tab stop that keeps focus (it carries aria-activedescendant).
 * The engine decides what a key does; this stops the keys it used and scrolls the cursor into view.
 */
export function useGridKeyboard(
  gantt: GanttController,
  scrollerRef: RefObject<HTMLDivElement | null>,
  editing: CellEdit | null,
  scrollTo: ScrollRequest | null,
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
  // Scrolling the engine asks for (after zooming, or to show a new task): once per request.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !scrollTo) return;
    if (scrollTo.left !== undefined) scroller.scrollLeft = scrollTo.left;
    if (scrollTo.top !== undefined) scroller.scrollTop = scrollTo.top;
  }, [scrollerRef, scrollTo]);
  return {
    tabIndex: 0,
    onKeyDown(event) {
      if (isEditable(event.target)) return; // typing in an input inside the chart
      const { key, code, shiftKey: shift, ctrlKey: ctrl, metaKey: meta, altKey: alt } = event;
      if (!gantt.keyDown({ key, code, shift, ctrl, meta, alt })) return;
      event.preventDefault();
      const { activeId, menu } = gantt.getState();
      // A menu opened with the keyboard stays where it is (scrolling would close it).
      if (menu) return;
      const top = activeId === null ? null : gantt.revealTop(activeId);
      if (top !== null && scrollerRef.current) scrollerRef.current.scrollTop = top;
    },
    onFocus(event) {
      const { target } = event;
      if (pressing.current && target !== event.currentTarget && !isEditable(target) && !inPopup(target)) {
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
