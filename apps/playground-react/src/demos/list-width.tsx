import type { ColumnInput } from '@quartzio/gantt';
import { Gantt } from '@quartzio/gantt-react';
import { useState } from 'react';
import { sampleProject } from '../data/sampleProject';

const STORAGE_KEY = 'qz-playground-list-width';
// Many columns, so the list is capped and the divider has something to reveal.
const WIDE: ColumnInput[] = ['name', 'startDate', 'endDate', 'duration', 'percentDone'];

function storedWidth(): number | null {
  try {
    const value = Number(localStorage.getItem(STORAGE_KEY));
    return value > 0 ? value : null;
  } catch {
    return null;
  }
}

/**
 * The divider between the task list and the timeline: drag it, move it with the arrow keys once it has focus
 * (Tab to it; Shift for bigger steps, Home and End for the bounds), or double-click it to go back to the
 * automatic width. The width is the app's to keep: here it is remembered across reloads.
 */
export function ListWidthDemo() {
  const [width, setWidth] = useState<number | null>(storedWidth);
  const [remember, setRemember] = useState(true);
  const [columns, setColumns] = useState<'default' | 'wide' | 'name'>('wide');
  const [narrow, setNarrow] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  const onListWidthChange = (next: number | null) => {
    setWidth(next);
    setLog((entries) => [next === null ? 'automatic' : `${String(next)} px`, ...entries].slice(0, 6));
    try {
      if (remember && next !== null) localStorage.setItem(STORAGE_KEY, String(next));
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Private mode: just not remembered.
    }
  };

  return (
    <div className="pg-stack">
      <div className="pg-toolbar pg-form">
        <label>
          Columns
          <select
            value={columns}
            onChange={(event) => {
              setColumns(event.target.value as typeof columns);
            }}
          >
            <option value="wide">All five</option>
            <option value="default">Default</option>
            <option value="name">Name only</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={remember}
            onChange={(event) => {
              setRemember(event.target.checked);
            }}
          />
          Remember across reloads
        </label>
        <label>
          <input
            type="checkbox"
            checked={narrow}
            onChange={(event) => {
              setNarrow(event.target.checked);
            }}
          />
          Narrow chart (400 px)
        </label>
        <button
          type="button"
          onClick={() => {
            onListWidthChange(200);
          }}
        >
          Set 200 px
        </button>
        <button
          type="button"
          disabled={width === null}
          onClick={() => {
            onListWidthChange(null);
          }}
        >
          Automatic
        </button>
        <span className="pg-muted">Width: {width === null ? 'automatic' : `${String(width)} px`}</span>
      </div>
      <Gantt
        defaultData={sampleProject}
        columns={columns === 'wide' ? WIDE : columns === 'name' ? ['name'] : undefined}
        listWidth={width}
        onListWidthChange={onListWidthChange}
        style={{ height: 380, maxWidth: narrow ? 400 : undefined }}
      />
      <p className="pg-muted">Reported: {log.length > 0 ? log.join(' · ') : 'nothing yet'}</p>
    </div>
  );
}
