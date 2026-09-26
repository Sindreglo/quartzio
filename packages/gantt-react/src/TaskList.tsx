import type { CellEdit, ColumnsState, GanttController, KeyModifiers, Row } from '@quartzio/gantt';
import {
  type CSSProperties,
  memo,
  type MouseEvent,
  type NamedExoticComponent,
  type ReactElement,
} from 'react';
import { CellEditor } from './CellEditor';

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
// Only the edited row gets `editing`, so the others stay memoized while typing.
const TaskRow = memo(function TaskRow({
  row,
  columns,
  idPrefix,
  gantt,
  editing,
  onEditDone,
}: {
  row: Row;
  columns: ColumnsState;
  idPrefix: string;
  gantt: GanttController;
  editing: CellEdit | null;
  onEditDone: () => void;
}): ReactElement {
  const className = ['qz-grid__row'];
  if (row.active) className.push('qz-grid__row--active');
  if (editing) className.push('qz-grid__row--editing');
  return (
    <div
      id={rowElementId(idPrefix, row)}
      className={className.join(' ')}
      data-key={row.key}
      role="row"
      aria-selected={row.selected}
      onClick={(event) => {
        gantt.rowClick(row.id, modifiersOf(event));
      }}
      // Rows are virtualized, so tell assistive tech where each one is (the header row is 1).
      aria-rowindex={row.index + 2}
      aria-level={row.depth + 1}
      aria-expanded={row.hasChildren ? row.expanded : undefined}
      style={{ transform: `translateY(${String(row.y)}px)`, height: row.height }}
    >
      {columns.items.map((column, index) => {
        const edited = editing?.columnId === column.id ? editing : null;
        return (
          <div
            key={column.id}
            className={`qz-grid__cell qz-align-${column.align}${column.tree ? ' qz-grid__cell--tree' : ''}${edited ? ' qz-grid__cell--editing' : ''}`}
            role="gridcell"
            onDoubleClick={column.editable ? () => gantt.startEdit(row.id, column.id) : undefined}
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
                    gantt.toggle(row.id);
                  }}
                  onDoubleClick={(event) => {
                    event.stopPropagation(); // nor edit the name
                  }}
                />
              ) : (
                <span className="qz-tree__spacer" />
              ))}
            {edited ? (
              <CellEditor gantt={gantt} edit={edited} label={column.title} onDone={onEditDone} />
            ) : (
              <span className="qz-grid__text">{row.cells[index]}</span>
            )}
          </div>
        );
      })}
    </div>
  );
});

export function TaskListBody({
  rows,
  columns,
  idPrefix,
  gantt,
  editing,
  onEditDone,
}: {
  rows: readonly Row[];
  columns: ColumnsState;
  idPrefix: string;
  gantt: GanttController;
  editing: CellEdit | null;
  onEditDone: () => void;
}): ReactElement {
  return (
    <div className="qz-grid__body" role="rowgroup">
      {rows.map((row) => (
        <TaskRow
          key={row.key}
          row={row}
          columns={columns}
          idPrefix={idPrefix}
          gantt={gantt}
          editing={editing?.rowKey === row.key ? editing : null}
          onEditDone={onEditDone}
        />
      ))}
    </div>
  );
}
