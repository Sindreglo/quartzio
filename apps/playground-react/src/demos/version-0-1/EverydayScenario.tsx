import { Gantt } from '@quartzio/gantt-react';
import { kitchenRenovation, kitchenRenovationCode } from '../../data/renovation';

/**
 * An everyday user: a small plan entered once, everything else left to the defaults (uncontrolled, standard
 * calendar and columns). Dragging, editing, menus, undo and the keyboard all work without any setup.
 */
export function EverydayScenario() {
  return (
    <div className="pg-stack">
      <Gantt defaultData={kitchenRenovation} style={{ height: 480 }} />
      <details className="pg-code">
        <summary>All the code this needs</summary>
        <pre>
          <code>{kitchenRenovationCode}</code>
        </pre>
      </details>
    </div>
  );
}
