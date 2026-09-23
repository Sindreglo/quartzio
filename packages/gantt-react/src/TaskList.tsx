import type { ColumnsState, Id, Row } from '@quartzio/gantt';
import { type CSSProperties, memo, type NamedExoticComponent, type ReactElement } from 'react';

export const TaskListHeader: NamedExoticComponent<{ columns: ColumnsState; height: number }> = memo(
  function TaskListHeader({ columns, height }: { columns: ColumnsState; height: number }): ReactElement {
    return (
      <div className="qz-grid__header" role="row" aria-rowindex={1} style={{ height }}>
        {columns.items.map((column) => (
          <div
            key={column.id}
            className={`qz-grid__header-cell qz-align-${column.align}`}
            role="columnheader"
            style={{ width: column.width }}
          >
            {column.title}
          </div>
        ))}
      </div>
    );
  },
);

// Rows keep their identity while unchanged, so memo skips them on most updates.
const TaskRow = memo(function TaskRow({
  row,
  columns,
  onToggle,
}: {
  row: Row;
  columns: ColumnsState;
  onToggle: (id: Id) => void;
}): ReactElement {
  return (
    <div
      className="qz-grid__row"
      role="row"
      // Rows are virtualized, so tell assistive tech where each one is (the header row is 1).
      aria-rowindex={row.index + 2}
      aria-level={row.depth + 1}
      aria-expanded={row.hasChildren ? row.expanded : undefined}
      style={{ transform: `translateY(${String(row.y)}px)`, height: row.height }}
    >
      {columns.items.map((column, index) => (
        <div
          key={column.id}
          className={`qz-grid__cell qz-align-${column.align}${column.tree ? ' qz-grid__cell--tree' : ''}`}
          role="gridcell"
          style={
            column.tree
              ? ({ width: column.width, '--qz-depth': row.depth } as CSSProperties)
              : { width: column.width }
          }
        >
          {column.tree &&
            (row.hasChildren ? (
              <button
                type="button"
                className="qz-tree__toggle"
                aria-label={row.expanded ? 'Collapse' : 'Expand'}
                onClick={() => {
                  onToggle(row.id);
                }}
              />
            ) : (
              <span className="qz-tree__spacer" />
            ))}
          <span className="qz-grid__text">{row.cells[index]}</span>
        </div>
      ))}
    </div>
  );
});

export function TaskListBody({
  rows,
  columns,
  onToggle,
}: {
  rows: readonly Row[];
  columns: ColumnsState;
  onToggle: (id: Id) => void;
}): ReactElement {
  return (
    <div className="qz-grid__body" role="rowgroup">
      {rows.map((row) => (
        <TaskRow key={row.key} row={row} columns={columns} onToggle={onToggle} />
      ))}
    </div>
  );
}
