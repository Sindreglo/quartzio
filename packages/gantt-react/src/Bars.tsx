import type { Bar, Interactions } from '@quartzio/gantt';
import type { ReactElement } from 'react';

export function TaskBar({ bar }: { bar: Bar }): ReactElement {
  if (bar.kind === 'milestone') {
    return (
      <div className="qz-bar qz-bar--milestone" style={{ left: bar.x }} title={bar.label}>
        <span className="qz-bar__label">{bar.label}</span>
      </div>
    );
  }
  return (
    <div className={`qz-bar qz-bar--${bar.kind}`} style={{ left: bar.x, width: bar.width }} title={bar.label}>
      {bar.kind === 'task' && (
        <>
          <div className="qz-bar__progress" style={{ width: `${String(bar.progress * 100)}%` }} />
          <span className="qz-bar__label">{bar.label}</span>
        </>
      )}
    </div>
  );
}

/** Half a milestone diamond, as in the engine's hit testing (the default --qz-milestone-size). */
const MILESTONE_RADIUS = 7;
/** Link handles sit this far outside a bar's ends (inside the engine's 10 px target). */
const LINK_OFFSET = 5;

/**
 * Handles shown while hovering a row: to draw a dependency from either end, and to drag the progress. Where to
 * press is decided by the engine's hit testing; these only show it.
 */
export function BarHandles({ bar, interactions }: { bar: Bar; interactions: Interactions }): ReactElement {
  const start = bar.kind === 'milestone' ? bar.x - MILESTONE_RADIUS : bar.x;
  const end = bar.kind === 'milestone' ? bar.x + MILESTONE_RADIUS : bar.x + bar.width;
  return (
    <>
      {interactions.link && (
        <>
          <span className="qz-link-handle" style={{ left: start - LINK_OFFSET }} />
          <span className="qz-link-handle" style={{ left: end + LINK_OFFSET }} />
        </>
      )}
      {interactions.progress && bar.kind === 'task' && (
        <span className="qz-progress-handle" style={{ left: bar.x + bar.progress * bar.width }} />
      )}
    </>
  );
}
