import {
  addUnits,
  createProject,
  durationToWorkingMs,
  getWorkingCalendar,
  parseDateString,
  startOfUnit,
  type TimeUnit,
} from '@quartzio/gantt';
import { useMemo, useState } from 'react';
import { calendarPresets, timeZones } from '../data/calendars';

const UNITS: TimeUnit[] = ['hour', 'day', 'week'];
const DAYS_SHOWN = 14;

const formatter = (zone: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-GB', zone === 'local' ? options : { ...options, timeZone: zone });

/**
 * Working time in a chosen time zone and calendar: start + duration (in working time) gives the end,
 * skipping non-working time. Try a start before a DST change (Oslo: 25 October) or a holiday.
 */
export function CalendarDemo() {
  const [zone, setZone] = useState('Europe/Oslo');
  const [presetId, setPresetId] = useState('holidays');
  const [startText, setStartText] = useState('2026-10-23T12:00');
  const [amount, setAmount] = useState(2);
  const [unit, setUnit] = useState<TimeUnit>('day');

  const result = useMemo(() => {
    const preset = calendarPresets.find((candidate) => candidate.id === presetId);
    const state = createProject({
      settings: { timeZone: zone, calendarId: preset?.calendar?.id ?? null },
      calendars: preset?.calendar ? [preset.calendar] : [],
    }).getState();
    const calendar = getWorkingCalendar(state);
    const start = parseDateString(startText, zone);
    if (start === null) return null;

    const workingMs = durationToWorkingMs(amount, unit, state.settings);
    const end = calendar.addWorkingTime(start, workingMs);
    const weekStart = startOfUnit(start, 'week', zone, state.settings.weekStartsOn);
    const days = Array.from({ length: DAYS_SHOWN }, (_, i) => {
      const dayStart = addUnits(weekStart, i, 'day', zone);
      const dayEnd = addUnits(dayStart, 1, 'day', zone);
      return { dayStart, dayEnd, intervals: calendar.workingIntervals(dayStart, dayEnd) };
    });
    return {
      start,
      end,
      workingStart: calendar.nextWorkingTime(start),
      workingMs,
      elapsedMs: end - start,
      days,
      exceptions: preset?.calendar?.exceptions ?? [],
    };
  }, [zone, presetId, startText, amount, unit]);

  const dateTime = formatter(zone, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  const dayLabel = formatter(zone, { weekday: 'short', day: 'numeric', month: 'short' });
  const hours = (ms: number) => `${String(Math.round((ms / 3_600_000) * 100) / 100)} h`;

  return (
    <div className="pg-stack">
      <div className="pg-toolbar pg-form">
        <label>
          Time zone
          <select
            value={zone}
            onChange={(event) => {
              setZone(event.target.value);
            }}
          >
            {timeZones.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </label>
        <label>
          Calendar
          <select
            value={presetId}
            onChange={(event) => {
              setPresetId(event.target.value);
            }}
          >
            {calendarPresets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Start (wall time)
          <input
            type="datetime-local"
            value={startText}
            onChange={(event) => {
              setStartText(event.target.value);
            }}
          />
        </label>
        <label>
          Duration
          <input
            type="number"
            min={0}
            step={0.5}
            value={amount}
            onChange={(event) => {
              setAmount(Number(event.target.value));
            }}
            style={{ width: 70 }}
          />
          <select
            value={unit}
            onChange={(event) => {
              setUnit(event.target.value as TimeUnit);
            }}
          >
            {UNITS.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </label>
      </div>

      {result === null ? (
        <p className="pg-error">Invalid start date.</p>
      ) : (
        <>
          <section className="pg-panel pg-facts">
            <div>
              <span className="pg-muted">Start</span>
              {dateTime.format(result.start)}
            </div>
            <div>
              <span className="pg-muted">Work begins</span>
              {dateTime.format(result.workingStart)}
            </div>
            <div>
              <span className="pg-muted">End</span>
              <strong>{dateTime.format(result.end)}</strong>
            </div>
            <div>
              <span className="pg-muted">Working time</span>
              {hours(result.workingMs)}
            </div>
            <div>
              <span className="pg-muted">Elapsed (real) time</span>
              {hours(result.elapsedMs)}
            </div>
          </section>

          <section className="pg-panel">
            <h3>Two weeks from the start of the week · working time in green, the task in blue</h3>
            <div className="pg-days">
              {result.days.map(({ dayStart, dayEnd, intervals }) => {
                const length = dayEnd - dayStart;
                const left = (time: number) => `${String(((time - dayStart) / length) * 100)}%`;
                const width = (from: number, to: number) => `${String(((to - from) / length) * 100)}%`;
                const taskFrom = Math.max(result.start, dayStart);
                const taskTo = Math.min(result.end, dayEnd);
                return (
                  <div key={dayStart} className="pg-day">
                    <span className="pg-day-label">
                      {dayLabel.format(dayStart)}
                      {length !== 86_400_000 && <em> ({hours(length)})</em>}
                    </span>
                    <div className="pg-day-track">
                      {intervals.map(([from, to]) => (
                        <div
                          key={from}
                          className="pg-work"
                          style={{ left: left(from), width: width(from, to) }}
                        />
                      ))}
                      {taskTo > taskFrom && (
                        <div
                          className="pg-task"
                          style={{ left: left(taskFrom), width: width(taskFrom, taskTo) }}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {result.exceptions.length > 0 && (
            <section className="pg-panel">
              <h3>Exceptions in this calendar</h3>
              <ul className="pg-list">
                {result.exceptions.map((exception) => (
                  <li key={exception.startDate}>
                    {exception.startDate}
                    {exception.endDate && exception.endDate !== exception.startDate
                      ? ` – ${exception.endDate}`
                      : ''}
                    : {exception.name}
                    {exception.intervals?.length ? ' (working)' : ''}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
