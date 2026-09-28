import type { GanttController, ListPaneState } from '@quartzio/gantt';
import { type ReactElement, type RefObject, useEffect, useRef } from 'react';

/**
 * The divider between the task list and the timeline (a window splitter). The engine decides the width, the
 * bounds and what each key does; this sends it the pointer and the measured sizes.
 */
export function ListDivider({
  gantt,
  list,
  paneWidth,
  rootRef,
}: {
  gantt: GanttController;
  list: ListPaneState;
  paneWidth: number;
  rootRef: RefObject<HTMLDivElement | null>;
}): ReactElement {
  const dragging = useRef(false);
  const chartWidth = () => rootRef.current?.clientWidth ?? 0;
  // Escape drops the drag (focus is on the chart by then), and goes no further, as for dragging bars.
  useEffect(() => {
    if (!list.resizing) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && gantt.resizeList({ type: 'cancel' })) {
        dragging.current = false;
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
    };
  }, [list.resizing, gantt]);
  return (
    <div
      className={`qz-divider${list.resizing ? ' qz-divider--resizing' : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize task list"
      aria-valuenow={paneWidth}
      aria-valuemin={list.min}
      aria-valuemax={list.max}
      tabIndex={0}
      onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary) return;
        const started = gantt.resizeList({
          type: 'start',
          x: event.clientX,
          width: paneWidth,
          chartWidth: chartWidth(),
        });
        if (!started) return;
        dragging.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault(); // no text selection while dragging
      }}
      onPointerMove={(event) => {
        if (dragging.current) gantt.resizeList({ type: 'move', x: event.clientX });
      }}
      onPointerUp={() => {
        dragging.current = false;
        gantt.resizeList({ type: 'end' });
      }}
      // Interrupted (a touch taken over by the browser, say): as if Escape was pressed.
      onPointerCancel={() => {
        if (!dragging.current) return;
        dragging.current = false;
        gantt.resizeList({ type: 'cancel' });
      }}
      onLostPointerCapture={() => {
        if (!dragging.current) return;
        dragging.current = false;
        gantt.resizeList({ type: 'end' });
      }}
      onDoubleClick={() => {
        gantt.resizeList({ type: 'reset' });
      }}
      onKeyDown={(event) => {
        // Tab, Escape and shortcuts (undo, redo) go on to the chart; its other keys (moving between rows) don't
        // apply here.
        if (event.key === 'Tab' || event.key === 'Escape' || event.ctrlKey || event.metaKey || event.altKey)
          return;
        event.stopPropagation();
        const used = gantt.resizeList({
          type: 'key',
          key: event.key,
          shift: event.shiftKey,
          width: paneWidth,
          chartWidth: chartWidth(),
        });
        if (used) event.preventDefault();
      }}
    />
  );
}
