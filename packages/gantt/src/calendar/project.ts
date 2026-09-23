import { STANDARD_CALENDAR } from '../data/normalize';
import type { Calendar, Id, ProjectState } from '../data/types';
import { QuartzioError } from '../util/errors';
import type { TimeZone } from '../util/zone';
import { createWorkingCalendar, type WorkingCalendar } from './workingCalendar';

// Keyed by the calendar record, so edits (which create new records) naturally get a fresh instance.
const cache = new WeakMap<Calendar, Map<TimeZone, WorkingCalendar>>();

/**
 * The working calendar for a project: the calendar with `calendarId`, or the project calendar
 * (`settings.calendarId`, falling back to the standard Mon–Fri 08:00–16:00 calendar), in the project's
 * time zone. Instances are cached and cache their day computations. With `timeZone: 'local'`, the cached
 * results assume the host's zone doesn't change while the app runs.
 */
export function getWorkingCalendar(
  state: ProjectState,
  calendarId: Id | null = state.settings.calendarId,
): WorkingCalendar {
  const calendar = calendarId === null ? STANDARD_CALENDAR : state.calendars.byId.get(calendarId);
  if (!calendar) throw new QuartzioError(`Calendar "${String(calendarId)}" does not exist.`);

  const zone = state.settings.timeZone;
  let byZone = cache.get(calendar);
  if (!byZone) cache.set(calendar, (byZone = new Map<TimeZone, WorkingCalendar>()));
  let working = byZone.get(zone);
  if (!working) byZone.set(zone, (working = createWorkingCalendar(calendar, zone)));
  return working;
}
