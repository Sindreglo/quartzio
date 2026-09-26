import type {
  DependencyLine,
  GanttController,
  HeaderCell,
  HeaderState,
  Interactions,
  Row,
  TaskInteraction,
  TimelinePoint,
  TimeSpan,
  TodayLine,
} from '@quartzio/gantt';
import { memo, type PointerEvent, type ReactElement, useEffect, useId, useRef } from 'react';
import { BarHandles, TaskBar } from './Bars';
import { DraftBar, DraftLink } from './Drafts';

// Rows get the same array while scrolling within the rendered window, so memo skips most re-renders.
const HeaderRow = memo(function HeaderRow({
  cells,
  height,
}: {
  cells: readonly HeaderCell[];
  height: number;
}): ReactElement {
  return (
    <div className="qz-header__row" style={{ height }}>
      {cells.map((cell) => (
        <div
          key={cell.key}
          className="qz-header__cell"
          // `left`, not `transform`: sticky labels inside are positioned from the cell's layout position,
          // which a transform doesn't change (every label would stick as if its cell were at x = 0).
          style={{ left: cell.x, width: cell.width }}
          title={cell.label}
        >
          <span className="qz-header__label">{cell.label}</span>
        </div>
      ))}
    </div>
  );
});

export function TimelineHeader({ header }: { header: HeaderState }): ReactElement {
  return (
    <div className="qz-header">
      {header.rows.map((cells, row) => (
        <HeaderRow key={row} cells={cells} height={header.rowHeight} />
      ))}
    </div>
  );
}

const NonWorkingLayer = memo(function NonWorkingLayer({
  spans,
}: {
  spans: readonly TimeSpan[];
}): ReactElement {
  return (
    <div className="qz-timeline__layer">
      {spans.map((span) => (
        <div key={span.key} className="qz-nonworking" style={{ left: span.x, width: span.width }} />
      ))}
    </div>
  );
});

// Lines keep their array while scrolling within the rendered rows, so memo skips most re-renders.
const DependencyLayer = memo(function DependencyLayer({
  lines,
  width,
  height,
}: {
  lines: readonly DependencyLine[];
  width: number;
  height: number;
}): ReactElement {
  // One marker per chart: several charts on a page must not share (or clash on) the id.
  const arrow = `qz-arrow-${useId().replace(/[^\w-]/g, '')}`;
  return (
    <svg className="qz-dependencies" width={width} height={height}>
      <defs>
        {/* A fixed size (not scaled with the line width), no longer than the straight part into a bar. */}
        <marker
          id={arrow}
          viewBox="0 0 8 8"
          refX="8"
          refY="4"
          markerUnits="userSpaceOnUse"
          markerWidth="8"
          markerHeight="8"
          orient="auto"
        >
          <path className="qz-dependency__arrow" d="M0 0 L8 4 L0 8 Z" />
        </marker>
      </defs>
      {lines.map((line) => (
        <path
          key={line.key}
          className="qz-dependency"
          d={line.path}
          markerEnd={`url(#${arrow})`}
          data-type={line.type}
          data-from={String(line.from)}
          data-to={String(line.to)}
        />
      ))}
    </svg>
  );
});

// Rows keep their identity while unchanged (bars included), so memo skips them on most updates. Only the row
// of a dragged bar re-renders when a drag starts or ends.
const TimelineRow = memo(function TimelineRow({
  row,
  dragging,
  interactions,
}: {
  row: Row;
  dragging: boolean;
  interactions: Interactions;
}): ReactElement {
  // A row to draw a bar in (an unscheduled task): touching it draws instead of scrolling.
  const drawable = interactions.create && !row.bar && !row.hasChildren;
  const className = ['qz-timeline__row'];
  if (dragging) className.push('qz-timeline__row--dragging');
  if (drawable) className.push('qz-timeline__row--drawable');
  return (
    <div
      className={className.join(' ')}
      data-key={row.key}
      style={{ transform: `translateY(${String(row.y)}px)`, height: row.height }}
    >
      {row.bar && <TaskBar bar={row.bar} />}
      {row.bar && <BarHandles bar={row.bar} interactions={interactions} />}
    </div>
  );
});

/** Timeline coordinates of a pointer event: the body moves with scrolling, so its box is the origin. */
function pointOf(event: PointerEvent<HTMLElement>): TimelinePoint {
  const box = event.currentTarget.getBoundingClientRect();
  return { x: event.clientX - box.left, y: event.clientY - box.top };
}

/**
 * The timeline body, in layers from back to front: non-working time, dependency lines, rows with their bars,
 * the today line, and the bar being dragged.
 * Hidden from assistive tech: it repeats what the task list (the treegrid) already says.
 */
export function TimelineBody({
  gantt,
  rows,
  dependencies,
  nonWorkingTime,
  today,
  interaction,
  interactions,
  scrollBy,
  width,
  height,
}: {
  gantt: GanttController;
  /** Which drags are on: their handles are shown, and touching a bar drags it instead of scrolling. */
  interactions: Interactions;
  /** Scrolls the chart (for auto-scrolling near an edge while dragging). */
  scrollBy: (x: number, y: number) => void;
  rows: readonly Row[];
  dependencies: readonly DependencyLine[];
  nonWorkingTime: readonly TimeSpan[];
  today: TodayLine | null;
  interaction: TaskInteraction | null;
  width: number;
  height: number;
}): ReactElement {
  const dragging = interaction !== null;
  const scroll = useRef(scrollBy);
  useEffect(() => {
    scroll.current = scrollBy;
  });

  // Auto-scroll: the engine says how fast, near an edge; scroll each frame. The engine follows the scrolling
  // itself (the pointer is over another part of the chart then), and says when to stop.
  const speed = interaction?.autoScroll;
  useEffect(() => {
    if (!speed || (speed.x === 0 && speed.y === 0)) return;
    let frame = requestAnimationFrame(function step() {
      scroll.current(speed.x, speed.y);
      frame = requestAnimationFrame(step);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [speed]);
  // Escape drops a drag without changing anything, and then goes no further (it would close a dialog around the
  // chart, say). Listened for first, in the capture phase.
  useEffect(() => {
    if (!dragging) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && gantt.cancelInteraction()) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
    };
  }, [dragging, gantt]);

  const draftRow =
    interaction?.kind !== 'link' ? rows.find((row) => row.key === interaction?.rowKey) : undefined;
  const interactive = Object.values(interactions).some(Boolean);
  return (
    <div
      className="qz-timeline__body"
      style={{ width, height }}
      aria-hidden="true"
      data-dragging={dragging ? interaction.kind : undefined}
      data-interactive={interactive ? '' : undefined}
      // The engine does the hit testing, snapping and preview; this only passes the pointer on.
      // One pointer at a time: a second finger neither takes over nor ends the drag.
      onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary) return;
        if (gantt.pointerDown(pointOf(event))) event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!event.isPrimary) return;
        const body = event.currentTarget;
        if (body.hasPointerCapture(event.pointerId)) gantt.pointerMove(pointOf(event));
        else body.dataset.hit = gantt.hitTest(pointOf(event))?.area ?? '';
      }}
      onPointerUp={(event) => {
        if (event.isPrimary && event.currentTarget.hasPointerCapture(event.pointerId)) {
          gantt.pointerUp(pointOf(event));
        }
      }}
      onPointerCancel={(event) => {
        if (event.isPrimary) gantt.cancelInteraction();
      }}
      // Capture can be lost without a pointerup (e.g. the window loses focus): nothing is dropped then. After a
      // pointerup, the drag is already over and this does nothing.
      onLostPointerCapture={() => {
        gantt.cancelInteraction();
      }}
    >
      <NonWorkingLayer spans={nonWorkingTime} />
      <DependencyLayer lines={dependencies} width={width} height={height} />
      {rows.map((row) => (
        <TimelineRow
          key={row.key}
          row={row}
          dragging={interaction?.kind !== 'link' && row.key === interaction?.rowKey}
          interactions={interactions}
        />
      ))}
      {today && <div className="qz-today" style={{ left: today.x }} />}
      {interaction && interaction.kind !== 'link' && draftRow && (
        <DraftBar interaction={interaction} row={draftRow} />
      )}
      {interaction?.kind === 'link' && <DraftLink interaction={interaction} width={width} height={height} />}
    </div>
  );
}
