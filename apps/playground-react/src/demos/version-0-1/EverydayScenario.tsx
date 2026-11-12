import { Gantt } from '@quartzio/gantt-react';
import '@quartzio/gantt-react/styles.css';
import { kitchenRenovation } from '../../data/renovation';

/**
 * An everyday user: a small plan entered once, everything else left to the defaults (uncontrolled, standard
 * calendar and columns). Dragging, editing, menus, undo and the keyboard all work without any setup.
 */
export function EverydayScenario() {
  return <Gantt defaultData={kitchenRenovation} style={{ height: 480 }} />;
}
