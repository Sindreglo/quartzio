import type { HeaderCell, HeaderState } from '@quartzio/gantt';
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
