import type { BarInteraction, LinkInteraction, Row } from '@quartzio/gantt';
import { type ReactElement, useId } from 'react';
import { TaskBar } from './Bars';

/** The tooltip text: why the drop is refused, if there's a reason, otherwise what it would do. */
const tooltip = (interaction: BarInteraction | LinkInteraction) =>
  !interaction.valid && interaction.message ? interaction.message : interaction.label;

/** A bar being moved, resized, drawn or having its progress dragged, where it would land, with a tooltip. */
export function DraftBar({ interaction, row }: { interaction: BarInteraction; row: Row }): ReactElement {
  const { bar } = interaction;
  return (
    <div
      className={
        interaction.valid
          ? 'qz-timeline__row qz-timeline__draft'
          : 'qz-timeline__row qz-timeline__draft qz-draft--invalid'
      }
      style={{ transform: `translateY(${String(row.y)}px)`, height: row.height }}
    >
      <TaskBar bar={bar} />
      {/* Above the bar, except in the first row, where the body would clip it. */}
      <div
        className={row.index === 0 ? 'qz-drag-tooltip qz-drag-tooltip--below' : 'qz-drag-tooltip'}
        style={{ left: interaction.kind === 'progress' ? bar.x + bar.progress * bar.width : bar.x }}
      >
        {tooltip(interaction)}
      </div>
    </div>
  );
}

/** A dependency being drawn: a line from the bar to the pointer, with a tooltip at the pointer. */
export function DraftLink({
  interaction,
  width,
  height,
}: {
  interaction: LinkInteraction;
  width: number;
  height: number;
}): ReactElement {
  const arrow = `qz-link-arrow-${useId().replace(/[^\w-]/g, '')}`;
  const text = tooltip(interaction);
  return (
    <>
      <svg
        // Refused only when over a bar that can't be linked to; pointing at nothing yet is neutral.
        className={
          interaction.valid || interaction.to === null ? 'qz-link-draft' : 'qz-link-draft qz-draft--invalid'
        }
        width={width}
        height={height}
      >
        <defs>
          <marker
            id={arrow}
            viewBox="0 0 8 8"
            refX="8"
            refY="4"
            markerUnits="userSpaceOnUse"
            markerWidth="8"
            markerHeight="8"
            orient="auto"
          >
            <path className="qz-dependency__arrow" d="M0 0 L8 4 L0 8 Z" />
          </marker>
        </defs>
        <path className="qz-dependency" d={interaction.path} markerEnd={`url(#${arrow})`} />
      </svg>
      {text && (
        <div
          className="qz-drag-tooltip qz-drag-tooltip--pointer"
          style={{ left: interaction.end.x, top: interaction.end.y }}
        >
          {text}
        </div>
      )}
    </>
  );
}
