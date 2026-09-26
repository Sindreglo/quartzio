import type { GanttOptions } from '@quartzio/gantt';

// Every engine option except `data`, passed on every render, so a prop that's removed goes back to its default
// (a missing key would keep the last value). Checked against GanttOptions below.
const OPTION_KEYS = [
  'defaultData',
  'onChange',
  'preset',
  'startDate',
  'endDate',
  'locale',
  'columns',
  'rowHeight',
  'headerRowHeight',
  'showToday',
  'showNonWorkingTime',
  'taskDrag',
  'taskResize',
  'taskDragCreate',
  'progressDrag',
  'dependencyCreate',
  'validateChange',
  'undoRedo',
  'multiSelect',
  'deleteKey',
  'onSelectionChange',
  'taskTooltip',
  'cellEdit',
  'taskMenu',
  'timeAxisMenu',
  'taskMenuItems',
  'timeAxisMenuItems',
  'taskEdit',
  'createTaskId',
  'onPresetChange',
] as const satisfies readonly (keyof GanttOptions)[];
// Fails to compile when GanttOptions gets an option that isn't listed.
const _allListed: Exclude<keyof GanttOptions, (typeof OPTION_KEYS)[number] | 'data'> extends never
  ? true
  : never = true;

/** The engine options in the props. `data` only when present: its presence makes the chart controlled. */
export function engineOptions(props: GanttOptions): GanttOptions {
  const options: Record<string, unknown> = {};
  for (const key of OPTION_KEYS) options[key] = props[key];
  if ('data' in props) options.data = props.data;
  return options;
}
