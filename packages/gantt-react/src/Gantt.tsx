import { createGantt, type GanttController } from '@quartzio/gantt';
import {
  type CSSProperties,
  type ReactElement,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

export interface GanttProps {
  className?: string;
  style?: CSSProperties;
}

export function Gantt({ className, style }: GanttProps): ReactElement {
  // The controller holds no timers or external resources yet, so it is not destroyed on unmount:
  // StrictMode's mount → unmount → mount would otherwise leave us with a destroyed controller.
  const [gantt] = useState<GanttController>(() => createGantt());
  const state = useSyncExternalStore(gantt.subscribe, gantt.getState);
  const rootRef = useRef<HTMLDivElement>(null);

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

  return (
    <div
      ref={rootRef}
      className={className ? `qz-gantt ${className}` : 'qz-gantt'}
      style={style}
      data-width={state.viewport.width}
    >
      <div className="qz-gantt__empty">No tasks</div>
    </div>
  );
}
