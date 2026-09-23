import { createGantt, type GanttController, type GanttOptions, type HeaderCell } from '@quartzio/gantt';
import {
  type CSSProperties,
  memo,
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
 *
 * Server rendering: pass an explicit `locale` and a project `settings.timeZone` (and dated tasks or
 * `startDate`/`endDate`), so the server renders the same timeline as the browser.
 */
export interface GanttProps extends GanttOptions {
  className?: string | undefined;
  style?: CSSProperties | undefined;
  /** Gives access to the engine controller, e.g. `ref.current.transact(tx => ...)`. */
  ref?: Ref<GanttController> | undefined;
}

// Rows get the same array while scrolling within the rendered window, so memo skips most re-renders.
const HeaderRow = memo(function HeaderRow({ cells }: { cells: readonly HeaderCell[] }) {
  return (
    <div className="qz-header__row">
      {cells.map((cell) => (
        <div
          key={cell.key}
          className="qz-header__cell"
          style={{ transform: `translateX(${String(cell.x)}px)`, width: cell.width }}
          title={cell.label}
        >
          <span className="qz-header__label">{cell.label}</span>
        </div>
      ))}
    </div>
  );
});

export function Gantt(props: GanttProps): ReactElement {
  const { className, style, ref, data, defaultData, onChange, preset, startDate, endDate, locale } = props;
  // Key presence, not the value, decides the mode (see GanttProps).
  const controlled = 'data' in props;

  // The controller holds no timers or external resources yet, so it is not destroyed on unmount:
  // StrictMode's mount → unmount → mount would otherwise leave us with a destroyed controller.
  const [gantt] = useState<GanttController>(() =>
    createGantt({
      ...(controlled ? { data } : { defaultData }),
      onChange,
      preset,
      startDate,
      endDate,
      locale,
    }),
  );
  // The third argument makes server rendering work; the server snapshot is the initial state.
  const state = useSyncExternalStore(gantt.subscribe, gantt.getState, gantt.getState);
  const scrollRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => gantt, [gantt]);

  // A layout effect so new data is shown in the same commit (no frame with stale content), and so
  // event handlers never see a stale onChange.
  useLayoutEffect(() => {
    gantt.setOptions({
      ...(controlled ? { data } : {}),
      onChange,
      preset,
      startDate,
      endDate,
      locale,
    });
  }, [gantt, controlled, data, onChange, preset, startDate, endDate, locale]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      gantt.setViewport({ width: element.clientWidth, height: element.clientHeight });
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [gantt]);

  const { timeAxis, header, project } = state;
  const taskCount = project.tasks.order.length;

  return (
    <div className={className ? `qz-gantt ${className}` : 'qz-gantt'} style={style}>
      <div
        ref={scrollRef}
        className="qz-timeline"
        onScroll={(event) => {
          gantt.setViewport({
            scrollLeft: event.currentTarget.scrollLeft,
            scrollTop: event.currentTarget.scrollTop,
          });
        }}
      >
        <div
          className="qz-timeline__canvas"
          style={
            {
              width: timeAxis.totalWidth,
              '--qz-tick-width': `${String(timeAxis.tickWidth)}px`,
            } as CSSProperties
          }
        >
          <div className="qz-header">
            {header.rows.map((cells, row) => (
              <HeaderRow key={row} cells={cells} />
            ))}
          </div>
          <div className="qz-timeline__body">
            {/* Placeholder until rows and bars are rendered (roadmap milestone 4). */}
            <div className="qz-gantt__placeholder">
              {taskCount === 0 ? 'No tasks' : `${String(taskCount)} tasks`}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
