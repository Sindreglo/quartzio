import type { TaskTooltip } from '@quartzio/gantt';
import type { ReactElement, ReactNode } from 'react';

/** Replaces the tooltip's content (the box and its placement stay). */
export type RenderTaskTooltip = (tooltip: TaskTooltip) => ReactNode;

/** The tooltip for the task under the pointer, where the engine placed it. */
export function TaskTooltipView({
  tooltip,
  render,
}: {
  tooltip: TaskTooltip;
  render: RenderTaskTooltip | undefined;
}): ReactElement {
  const className = ['qz-tooltip'];
  if (tooltip.below) className.push('qz-tooltip--below');
  if (tooltip.align === 'end') className.push('qz-tooltip--end');
  return (
    // Keyed by task: a new task's tooltip fades in again.
    <div
      key={tooltip.rowKey}
      className={className.join(' ')}
      style={{
        left: tooltip.x,
        top: tooltip.y,
        // Kept within the visible timeline (the stylesheet caps it too).
        maxWidth:
          tooltip.room === null
            ? undefined
            : `min(var(--qz-tooltip-max-width, 320px), ${String(tooltip.room)}px)`,
      }}
    >
      {render ? (
        render(tooltip)
      ) : (
        <>
          <div className="qz-tooltip__title">{tooltip.title}</div>
          <dl className="qz-tooltip__fields">
            {tooltip.fields.map((field) => (
              <div key={field.label} style={{ display: 'contents' }}>
                <dt>{field.label}</dt>
                <dd>{field.value}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </div>
  );
}
