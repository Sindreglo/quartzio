import {
  type GanttController,
  isoWeek,
  type ProjectInput,
  resolvePreset,
  VIEW_PRESETS,
  type ViewPreset,
} from '@quartzio/gantt';
import { Gantt } from '@quartzio/gantt-react';
import { useMemo, useRef, useState } from 'react';
import { timeZones } from '../data/calendars';
import { sampleProject } from '../data/sampleProject';

const LOCALES = ['en-US', 'nb-NO', 'de-DE', 'ja-JP'];
const noop = () => undefined;

/** A custom preset: two-week sprints over days, with a label function. Defined once, outside render. */
const SPRINTS: ViewPreset = {
  ...resolvePreset('weekAndDay'),
  id: 'sprints',
  headers: [
    {
      unit: 'week',
      increment: 2,
      format: (cell) => `Sprint ${String(Math.ceil(isoWeek(cell.start, cell.timeZone).week / 2))}`,
    },
    { unit: 'day', format: 'day' },
  ],
};
const PRESETS: ViewPreset[] = [...VIEW_PRESETS, SPRINTS];

/**
 * The time axis: presets from hours to years, labels in any locale, and a project time zone that decides
 * where days and weeks start. Hover the chart to see `xToDate` at work.
 */
export function TimeAxisDemo() {
  const gantt = useRef<GanttController>(null);
  const [preset, setPreset] = useState('weekAndDay');
  const [locale, setLocale] = useState('en-US');
  const [timeZone, setTimeZone] = useState('Europe/Oslo');
  const [weekStartsOn, setWeekStartsOn] = useState(1);
  const [autoRange, setAutoRange] = useState(true);
  const [range, setRange] = useState({ start: '2026-01-01', end: '2027-01-01' });
  const [hovered, setHovered] = useState<string | null>(null);

  const data = useMemo<ProjectInput>(
    () => ({ ...sampleProject, settings: { timeZone, weekStartsOn } }),
    [timeZone, weekStartsOn],
  );
  const format = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: 'full',
        timeStyle: 'short',
        ...(timeZone === 'local' ? {} : { timeZone }),
      }),
    [locale, timeZone],
  );

  const useRange = !autoRange && range.start !== '' && range.end !== '' && range.start < range.end;

  const onMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    const state = gantt.current?.getState();
    // Timeline x = 0 is the left edge of the timeline's rows (which moves with scrolling).
    const rows = event.currentTarget.querySelector('.qz-timeline__body');
    if (!state || !rows) return;
    const x = event.clientX - rows.getBoundingClientRect().left;
    if (x < 0) {
      setHovered(null);
      return;
    }
    setHovered(format.format(state.timeAxis.xToDate(x)));
  };

  return (
    <div className="pg-stack">
      <div className="pg-toolbar pg-form">
        <label>
          Preset
          <select
            value={preset}
            onChange={(event) => {
              setPreset(event.target.value);
            }}
          >
            {PRESETS.map((option) => (
              <option key={option.id}>{option.id}</option>
            ))}
          </select>
        </label>
        <label>
          Locale
          <select
            value={locale}
            onChange={(event) => {
              setLocale(event.target.value);
            }}
          >
            {LOCALES.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </label>
        <label>
          Time zone
          <select
            value={timeZone}
            onChange={(event) => {
              setTimeZone(event.target.value);
            }}
          >
            {timeZones.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </label>
        <label>
          Week starts
          <select
            value={weekStartsOn}
            onChange={(event) => {
              setWeekStartsOn(Number(event.target.value));
            }}
          >
            <option value={1}>Monday</option>
            <option value={0}>Sunday</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={autoRange}
            onChange={(event) => {
              setAutoRange(event.target.checked);
            }}
          />
          Range from tasks
        </label>
        {!autoRange && (
          <>
            <input
              type="date"
              value={range.start}
              onChange={(event) => {
                setRange({ ...range, start: event.target.value });
              }}
            />
            <input
              type="date"
              value={range.end}
              onChange={(event) => {
                setRange({ ...range, end: event.target.value });
              }}
            />
          </>
        )}
      </div>

      <div
        onMouseMove={onMouseMove}
        onMouseLeave={() => {
          setHovered(null);
        }}
      >
        <Gantt
          ref={gantt}
          data={data}
          onChange={noop}
          preset={PRESETS.find((option) => option.id === preset) ?? preset}
          locale={locale}
          // Only pass a complete, valid range (an empty date input gives "", and the end must be later).
          startDate={useRange ? range.start : undefined}
          endDate={useRange ? range.end : undefined}
          style={{ height: 240 }}
        />
      </div>
      {!autoRange && !useRange && <p className="pg-error">Enter a start date before the end date.</p>}
      <p className="pg-muted">{hovered ?? 'Hover the chart to see the time under the pointer.'}</p>
    </div>
  );
}
