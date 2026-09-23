import type { CalendarInput } from '@quartzio/gantt';

const allDay = [{ start: '00:00', end: '24:00' }];
const lunchBreak = [
  { start: '08:00', end: '11:30' },
  { start: '12:00', end: '16:00' },
];

/** Calendar presets for demos. `null` means the built-in standard calendar. */
export const calendarPresets: { id: string; label: string; calendar: CalendarInput | null }[] = [
  { id: 'standard', label: 'Standard (Mon–Fri 08–16)', calendar: null },
  {
    id: 'holidays',
    label: 'Lunch break + sample holidays',
    calendar: {
      id: 'holidays',
      name: 'Office with lunch break',
      week: {
        monday: lunchBreak,
        tuesday: lunchBreak,
        wednesday: lunchBreak,
        thursday: lunchBreak,
        friday: lunchBreak,
      },
      exceptions: [
        { startDate: '2026-10-26', name: 'Company day off' },
        { startDate: '2026-12-24', endDate: '2026-12-26', name: 'Christmas' },
        { startDate: '2026-12-31', endDate: '2027-01-01', name: 'New Year' },
        { startDate: '2026-10-31', name: 'Saturday release', intervals: [{ start: '10:00', end: '14:00' }] },
      ],
    },
  },
  {
    id: 'four-day',
    label: 'Four-day week (Mon–Thu 07–17)',
    calendar: {
      id: 'four-day',
      week: Object.fromEntries(
        ['monday', 'tuesday', 'wednesday', 'thursday'].map((day) => [
          day,
          [{ start: '07:00', end: '17:00' }],
        ]),
      ),
    },
  },
  {
    id: 'always',
    label: '24/7',
    calendar: {
      id: 'always',
      week: Object.fromEntries(
        ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].map((day) => [
          day,
          allDay,
        ]),
      ),
    },
  },
];

export const timeZones = [
  'local',
  'UTC',
  'Europe/Oslo',
  'America/New_York',
  'Asia/Kolkata',
  'Australia/Sydney',
];
