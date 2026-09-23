import { createGantt, type GanttController, type GanttOptions } from '@quartzio/gantt';
import {
  type CSSProperties,
  type ReactElement,
  type Ref,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

/**
 * Passing the `data` prop — even as `undefined`, e.g. while loading — makes the chart controlled.
 * Omit it and use `defaultData` for uncontrolled usage. The mode is fixed on mount.
 */
export interface GanttProps extends GanttOptions {
  className?: string | undefined;
  style?: CSSProperties | undefined;
  /** Gives access to the engine controller, e.g. `ref.current.transact(tx => ...)`. */
  ref?: Ref<GanttController> | undefined;
}

export function Gantt(props: GanttProps): ReactElement {
  const { className, style, ref, data, defaultData, onChange } = props;
  // Key presence, not the value, decides the mode (see GanttProps).
  const controlled = 'data' in props;

  // The controller holds no timers or external resources yet, so it is not destroyed on unmount:
  // StrictMode's mount → unmount → mount would otherwise leave us with a destroyed controller.
  const [gantt] = useState<GanttController>(() =>
    createGantt(controlled ? { data, onChange } : { defaultData, onChange }),
  );
  // The third argument makes server rendering work; the server snapshot is the initial state.
  const state = useSyncExternalStore(gantt.subscribe, gantt.getState, gantt.getState);
  const rootRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => gantt, [gantt]);

  // A layout effect so new data is shown in the same commit (no frame with stale content), and so
  // event handlers never see a stale onChange.
  useLayoutEffect(() => {
    gantt.setOptions(controlled ? { data, onChange } : { onChange });
  }, [gantt, controlled, data, onChange]);

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
