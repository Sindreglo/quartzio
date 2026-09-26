import type { TreeIndex } from '../data/tree';
import type { Id, Task } from '../data/types';
import { VIEW_PRESETS, type ViewPreset } from '../timeaxis/presets';
import type { TimeUnit } from '../util/time';
import { isEqual } from '../util/equal';
import type { KeyInput } from './keyboard';

/** What a menu is for: a task (its row or bar), or the time axis (its header). */
export type MenuTarget = { readonly kind: 'task'; readonly id: Id } | { readonly kind: 'timeAxis' };

/** What an item's `action` (and the item customizers) get. */
export interface MenuContext {
  readonly target: MenuTarget;
  /** The task the menu is for, or `null` for the time axis. */
  readonly task: Task | null;
  readonly selection: readonly Id[];
  readonly preset: ViewPreset;
}

export interface MenuItem {
  readonly id: string;
  readonly label: string;
  readonly disabled?: boolean | undefined;
  /** Shown checked (e.g. the current preset). */
  readonly checked?: boolean | undefined;
  /** A line before it. */
  readonly separator?: boolean | undefined;
  /** A submenu (one level). */
  readonly items?: readonly MenuItem[] | undefined;
  /** For your own items: what choosing it does. Built-in items are carried out by the engine. */
  readonly action?: ((context: MenuContext) => void) | undefined;
}

/** The open menu (see ADR 0012). */
export interface MenuState {
  readonly kind: 'task' | 'timeAxis';
  readonly taskId: Id | null;
  /** Where it opens, in the chart's coordinates (from the root element's corner). */
  readonly x: number;
  readonly y: number;
  readonly items: readonly MenuItem[];
  /** The highlighted item (in the open submenu, if there is one). */
  readonly active: string | null;
  /** The item whose submenu is open. */
  readonly submenu: string | null;
}

export type MenuCustomizer = (items: readonly MenuItem[], context: MenuContext) => readonly MenuItem[];

/** A task menu's built-in item ids, carried out by the engine. */
export type TaskMenuItemId =
  | 'edit'
  | 'addTaskAbove'
  | 'addTaskBelow'
  | 'addSubtask'
  | 'addMilestone'
  | 'addSuccessor'
  | 'addPredecessor'
  | 'indent'
  | 'outdent'
  | 'convertToMilestone'
  | 'delete';

/** The tasks an action on `id` applies to: the selection when it includes `id`, without tasks inside others. */
export function targetsOf(id: Id, selection: readonly Id[], tree: TreeIndex): Id[] {
  const ids = selection.includes(id) ? selection : [id];
  const set = new Set(ids);
  const roots = ids.filter((each) => !tree.ancestors(each).some((ancestor) => set.has(ancestor)));
  // In tree order, so moving several keeps their order.
  const order = tree.flatten();
  const position = new Map(order.map((each, index) => [each, index]));
  return roots.sort((a, b) => (position.get(a) ?? 0) - (position.get(b) ?? 0));
}

const hasSiblingBefore = (tree: TreeIndex, id: Id, parentOf: (id: Id) => Id | null) =>
  tree.children(parentOf(id)).indexOf(id) > 0;

/** The built-in task menu. */
export function taskMenuItems(
  task: Task,
  targets: readonly Id[],
  tree: TreeIndex,
  parentOf: (id: Id) => Id | null,
  { edit }: { edit: boolean },
): MenuItem[] {
  const isParent = !tree.isLeaf(task.id);
  const items: MenuItem[] = [];
  if (edit) items.push({ id: 'edit', label: 'Edit' });
  items.push(
    {
      id: 'add',
      label: 'Add',
      items: [
        { id: 'addTaskAbove', label: 'Task above' },
        { id: 'addTaskBelow', label: 'Task below' },
        { id: 'addSubtask', label: 'Subtask' },
        { id: 'addMilestone', label: 'Milestone' },
        { id: 'addSuccessor', label: 'Successor' },
        { id: 'addPredecessor', label: 'Predecessor' },
      ],
    },
    {
      id: 'indent',
      label: 'Indent',
      separator: true,
      disabled: !targets.some((id) => hasSiblingBefore(tree, id, parentOf)),
    },
    { id: 'outdent', label: 'Outdent', disabled: !targets.some((id) => parentOf(id) !== null) },
    { id: 'convertToMilestone', label: 'Convert to milestone', disabled: isParent || task.duration === 0 },
    { id: 'delete', label: 'Delete', separator: true },
  );
  return items;
}

const PRESET_LABELS: Record<string, string> = {
  hourAndDay: 'Hours',
  dayAndWeek: 'Days',
  weekAndDay: 'Weeks and days',
  weekAndMonth: 'Weeks',
  monthAndYear: 'Months',
  quarterAndYear: 'Quarters',
  manyYears: 'Years',
};

/** The built-in time axis menu: zooming, and the presets. */
export function timeAxisMenuItems(preset: ViewPreset): MenuItem[] {
  return [
    { id: 'zoomIn', label: 'Zoom in', disabled: zoomStep(preset, 'in') === undefined },
    { id: 'zoomOut', label: 'Zoom out', disabled: zoomStep(preset, 'out') === undefined },
    ...VIEW_PRESETS.map((each, index) => ({
      id: `preset:${each.id}`,
      label: PRESET_LABELS[each.id] ?? each.id,
      checked: each === preset || isEqual(each, preset),
      separator: index === 0,
    })),
  ];
}

// Rough lengths, only to compare how zoomed in presets are.
const UNIT_MS: Record<TimeUnit, number> = {
  millisecond: 1,
  second: 1000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
  month: 2_629_800_000,
  quarter: 7_889_400_000,
  year: 31_557_600_000,
};

/** Pixels per millisecond: how zoomed in a preset is. */
const zoomLevel = (preset: ViewPreset) =>
  preset.tickWidth / (UNIT_MS[preset.tickUnit] * preset.tickIncrement);

/** The built-in preset one step in (more pixels per time) or out, from any preset (custom ones too). */
export function zoomStep(preset: ViewPreset, direction: 'in' | 'out'): ViewPreset | undefined {
  const level = zoomLevel(preset);
  let best: ViewPreset | undefined;
  for (const candidate of VIEW_PRESETS) {
    const other = zoomLevel(candidate);
    if (direction === 'in' ? other <= level * 1.0001 : other >= level * 0.9999) continue;
    if (!best || (direction === 'in' ? other < zoomLevel(best) : other > zoomLevel(best))) best = candidate;
  }
  return best;
}

/** Items that can be picked in the list shown (the open submenu, or the menu). */
const shownItems = (menu: MenuState): readonly MenuItem[] =>
  menu.submenu === null ? menu.items : (menu.items.find((item) => item.id === menu.submenu)?.items ?? []);

const enabled = (items: readonly MenuItem[]) => items.filter((item) => item.disabled !== true);

/** An item by id, in the menu or its submenus. */
export function findItem(items: readonly MenuItem[], id: string): MenuItem | undefined {
  for (const item of items) {
    if (item.id === id) return item;
    const inner = item.items ? findItem(item.items, id) : undefined;
    if (inner) return inner;
  }
  return undefined;
}

/** What a key does in a menu: the new state (`null` closes it) and an item to carry out, or `undefined` when unused. */
export function menuKey(
  menu: MenuState,
  input: KeyInput,
): { menu: MenuState | null; pick?: string } | undefined {
  const items = enabled(shownItems(menu));
  const index = items.findIndex((item) => item.id === menu.active);
  const at = (i: number) => items[(i + items.length) % items.length]?.id ?? null;
  const openSubmenu = (item: MenuItem | undefined) => {
    const children = enabled(item?.items ?? []);
    return item && children.length > 0
      ? { ...menu, submenu: item.id, active: children[0]?.id ?? null }
      : null;
  };
  switch (input.key) {
    case 'ArrowDown':
      return { menu: { ...menu, active: index < 0 ? at(0) : at(index + 1) } };
    case 'ArrowUp':
      return { menu: { ...menu, active: index < 0 ? at(-1) : at(index - 1) } };
    case 'Home':
      return { menu: { ...menu, active: at(0) } };
    case 'End':
      return { menu: { ...menu, active: at(-1) } };
    case 'ArrowRight': {
      const opened = menu.submenu === null ? openSubmenu(items[index]) : null;
      return opened ? { menu: opened } : { menu };
    }
    case 'ArrowLeft':
      return { menu: menu.submenu === null ? menu : { ...menu, active: menu.submenu, submenu: null } };
    case 'Enter':
    case ' ': {
      const item = items[index];
      if (!item) return { menu };
      if (item.items) return { menu: openSubmenu(item) ?? menu };
      return { menu: null, pick: item.id };
    }
    case 'Escape':
      return { menu: menu.submenu === null ? null : { ...menu, active: menu.submenu, submenu: null } };
    case 'Tab':
      return { menu: null };
  }
  return undefined;
}

/** The pointer over an item: it's highlighted, and a submenu opens (another one closes). */
export function menuHover(menu: MenuState, id: string): MenuState {
  const top = menu.items.find((item) => item.id === id);
  if (top) {
    if (top.disabled === true) return menu.submenu === null ? menu : { ...menu, submenu: null, active: null };
    return { ...menu, active: id, submenu: top.items ? id : null };
  }
  const inSubmenu = shownItems(menu).find((item) => item.id === id);
  return inSubmenu && inSubmenu.disabled !== true && menu.submenu !== null ? { ...menu, active: id } : menu;
}

/** Items from a customizer, checked (it's app code): anything unusable falls back to the built-in items. */
export function customized(
  builtIn: readonly MenuItem[],
  customize: MenuCustomizer | undefined,
  context: MenuContext,
): readonly MenuItem[] {
  if (!customize) return builtIn;
  try {
    const items: unknown = customize(builtIn, context);
    const ids = new Set<string>();
    // An item with an id not seen yet, a label, an action if any, and (at the top) one level of submenu.
    const valid = (entry: unknown, top: boolean): boolean => {
      if (typeof entry !== 'object' || entry === null) return false;
      const { id, label, action, items: children } = entry as Record<string, unknown>;
      if (typeof id !== 'string' || ids.has(id) || typeof label !== 'string') return false;
      if (action !== undefined && typeof action !== 'function') return false;
      ids.add(id);
      if (children === undefined) return true;
      return top && Array.isArray(children) && children.every((child) => valid(child, false));
    };
    return Array.isArray(items) && items.every((entry) => valid(entry, true))
      ? (items as MenuItem[])
      : builtIn;
  } catch {
    return builtIn;
  }
}
