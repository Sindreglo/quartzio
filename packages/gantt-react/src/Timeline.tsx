import type { Bar, DependencyLine, HeaderCell, HeaderState, Row, TimeSpan, TodayLine } from '@quartzio/gantt';
import { memo, type ReactElement, useId } from 'react';

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

function TaskBar({ bar }: { bar: Bar }): ReactElement {
  if (bar.kind === 'milestone') {
    return (
      <div className="qz-bar qz-bar--milestone" style={{ left: bar.x }} title={bar.label}>
        <span className="qz-bar__label">{bar.label}</span>
      </div>
    );
  }
  return (
    <div className={`qz-bar qz-bar--${bar.kind}`} style={{ left: bar.x, width: bar.width }} title={bar.label}>
      {bar.kind === 'task' && (
        <>
          <div className="qz-bar__progress" style={{ width: `${String(bar.progress * 100)}%` }} />
          <span className="qz-bar__label">{bar.label}</span>
        </>
      )}
    </div>
  );
}

// Rows keep their identity while unchanged (bars included), so memo skips them on most updates.
const TimelineRow = memo(function TimelineRow({ row }: { row: Row }): ReactElement {
  return (
    <div
      className="qz-timeline__row"
      data-key={row.key}
      style={{ transform: `translateY(${String(row.y)}px)`, height: row.height }}
    >
      {row.bar && <TaskBar bar={row.bar} />}
    </div>
  );
});

/**
 * The timeline body, in layers from back to front: non-working time, dependency lines, rows with their bars,
 * the today line.
 * Hidden from assistive tech: it repeats what the task list (the treegrid) already says.
 */
export function TimelineBody({
  rows,
  dependencies,
  nonWorkingTime,
  today,
  width,
  height,
}: {
  rows: readonly Row[];
  dependencies: readonly DependencyLine[];
  nonWorkingTime: readonly TimeSpan[];
  today: TodayLine | null;
  width: number;
  height: number;
}): ReactElement {
  return (
    <div className="qz-timeline__body" style={{ width, height }} aria-hidden="true">
      <NonWorkingLayer spans={nonWorkingTime} />
      <DependencyLayer lines={dependencies} width={width} height={height} />
      {rows.map((row) => (
        <TimelineRow key={row.key} row={row} />
      ))}
      {today && <div className="qz-today" style={{ left: today.x }} />}
    </div>
  );
}
