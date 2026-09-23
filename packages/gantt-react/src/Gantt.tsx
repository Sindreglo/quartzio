import { createGantt, type GanttController, type GanttOptions } from '@quartzio/gantt';
import {
  type CSSProperties,
  type ReactElement,
  type Ref,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

export interface GanttProps extends GanttOptions {
  className?: string | undefined;
  style?: CSSProperties | undefined;
  /** Gives access to the engine controller, e.g. `ref.current.transact(tx => ...)`. */
  ref?: Ref<GanttController> | undefined;
}

export function Gantt({ className, style, ref, data, defaultData, onChange }: GanttProps): ReactElement {
  // The controller holds no timers or external resources yet, so it is not destroyed on unmount:
  // StrictMode's mount → unmount → mount would otherwise leave us with a destroyed controller.
  const [gantt] = useState<GanttController>(() => createGantt({ data, defaultData, onChange }));
  const state = useSyncExternalStore(gantt.subscribe, gantt.getState);
  const rootRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => gantt, [gantt]);

  useEffect(() => {
    gantt.setOptions({ data, onChange });
  }, [gantt, data, onChange]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      gantt.setViewport({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(root);
    return () => {
      observer.disconnect();
    };
  }, [gantt]);

  const taskCount = state.project.tasks.order.length;

  return (
    <div
      ref={rootRef}
      className={className ? `qz-gantt ${className}` : 'qz-gantt'}
      style={style}
      data-width={state.viewport.width}
    >
      {/* Placeholder until rows and bars are rendered (roadmap milestone 4). */}
      <div className="qz-gantt__placeholder">{taskCount === 0 ? 'No tasks' : `${taskCount} tasks`}</div>
    </div>
  );
}
