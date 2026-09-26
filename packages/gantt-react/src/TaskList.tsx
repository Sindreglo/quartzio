import type { ColumnsState, Id, KeyModifiers, Row } from '@quartzio/gantt';
import {
  type CSSProperties,
  memo,
  type MouseEvent,
  type NamedExoticComponent,
  type ReactElement,
} from 'react';

/** The id of a row's element, for `aria-activedescendant` (encoded: task ids may contain spaces). */
export const rowElementId = (prefix: string, row: Row): string => `${prefix}-${encodeURIComponent(row.key)}`;

const modifiersOf = (event: MouseEvent): KeyModifiers => ({
  shift: event.shiftKey,
  ctrl: event.ctrlKey,
  meta: event.metaKey,
  alt: event.altKey,
});

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
  idPrefix,
  onToggle,
  onClick,
}: {
  row: Row;
  columns: ColumnsState;
  idPrefix: string;
  onToggle: (id: Id) => void;
  onClick: (id: Id, modifiers: KeyModifiers) => void;
}): ReactElement {
  return (
    <div
      id={rowElementId(idPrefix, row)}
      className={row.active ? 'qz-grid__row qz-grid__row--active' : 'qz-grid__row'}
      data-key={row.key}
      role="row"
      aria-selected={row.selected}
      onClick={(event) => {
        onClick(row.id, modifiersOf(event));
      }}
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
                // Not a tab stop: the chart is one, and Left/Right expand and collapse.
                tabIndex={-1}
                onClick={(event) => {
                  event.stopPropagation(); // expanding doesn't select the row
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
  idPrefix,
  onToggle,
  onClick,
}: {
  rows: readonly Row[];
  columns: ColumnsState;
  idPrefix: string;
  onToggle: (id: Id) => void;
  onClick: (id: Id, modifiers: KeyModifiers) => void;
}): ReactElement {
  return (
    <div className="qz-grid__body" role="rowgroup">
      {rows.map((row) => (
        <TaskRow
          key={row.key}
          row={row}
          columns={columns}
          idPrefix={idPrefix}
          onToggle={onToggle}
          onClick={onClick}
        />
      ))}
    </div>
  );
}
