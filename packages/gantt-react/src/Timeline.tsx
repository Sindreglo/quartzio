import type { Bar, HeaderCell, HeaderState, Row, TimeSpan, TodayLine } from '@quartzio/gantt';
import { memo, type ReactElement } from 'react';

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
 * The timeline body, in layers from back to front: non-working time, rows with their bars, the today line.
 * Hidden from assistive tech: it repeats what the task list (the treegrid) already says.
 */
export function TimelineBody({
  rows,
  nonWorkingTime,
  today,
  width,
  height,
}: {
  rows: readonly Row[];
  nonWorkingTime: readonly TimeSpan[];
  today: TodayLine | null;
  width: number;
  height: number;
}): ReactElement {
  return (
    <div className="qz-timeline__body" style={{ width, height }} aria-hidden="true">
      <NonWorkingLayer spans={nonWorkingTime} />
      {rows.map((row) => (
        <TimelineRow key={row.key} row={row} />
      ))}
      {today && <div className="qz-today" style={{ left: today.x }} />}
    </div>
  );
}
