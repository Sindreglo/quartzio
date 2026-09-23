import { createGantt, type GanttController, type GanttOptions } from '@quartzio/gantt';
import {
  type CSSProperties,
  type ReactElement,
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { TaskListBody, TaskListHeader } from './TaskList';
import { TimelineHeader } from './Timeline';

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

export function Gantt(props: GanttProps): ReactElement {
  const { className, ref, data, defaultData, onChange } = props;
  const { preset, startDate, endDate, locale, columns, rowHeight, headerRowHeight } = props;
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
      columns,
      rowHeight,
      headerRowHeight,
    }),
  );
  // The third argument makes server rendering work; the server snapshot is the initial state.
  const state = useSyncExternalStore(gantt.subscribe, gantt.getState, gantt.getState);
  // The timeline body: the scroll area that owns both scrollbars.
  const timelineRef = useRef<HTMLDivElement>(null);
  // The timeline header sits above it, outside the scroll area, and follows its horizontal scroll.
  const timelineHeaderRef = useRef<HTMLDivElement>(null);

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
      columns,
      rowHeight,
      headerRowHeight,
    });
  }, [
    gantt,
    controlled,
    data,
    onChange,
    preset,
    startDate,
    endDate,
    locale,
    columns,
    rowHeight,
    headerRowHeight,
  ]);

  const { timeAxis, header, rows } = state;
  const listWidth = state.columns.totalWidth;
  const listRef = useRef<HTMLDivElement>(null);
  const listBodyRef = useRef<HTMLDivElement>(null);
  // Spacers that even out scrollbars between areas (see measure).
  const [gaps, setGaps] = useState({ list: 0, timeline: 0, header: 0 });

  const measure = useCallback(() => {
    const timeline = timelineRef.current;
    const list = listRef.current;
    if (!timeline || !list) return;
    // The viewport is the timeline's visible body: exactly its scroll area.
    gantt.setViewport({ width: timeline.clientWidth, height: timeline.clientHeight });
    // Each side may or may not show a horizontal scrollbar. The side without one (or with a thinner one)
    // gets a spacer at the bottom, so both can scroll equally far down and rows stay aligned.
    const timelineScrollbar = timeline.offsetHeight - timeline.clientHeight;
    const listScrollbar = list.offsetHeight - list.clientHeight;
    const next = {
      list: Math.max(0, timelineScrollbar - listScrollbar),
      timeline: Math.max(0, listScrollbar - timelineScrollbar),
      // The header spans the body's vertical scrollbar too, so it gets that much extra width to be able to
      // scroll as far right as the body.
      header: timeline.offsetWidth - timeline.clientWidth,
    };
    setGaps((current) =>
      current.list === next.list && current.timeline === next.timeline && current.header === next.header
        ? current
        : next,
    );
  }, [gantt]);

  useEffect(() => {
    const timeline = timelineRef.current;
    const list = listRef.current;
    if (!timeline || !list || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(timeline);
    observer.observe(list);
    return () => {
      observer.disconnect();
    };
  }, [measure]);

  // Header height and content widths decide whether scrollbars appear, so they're part of the measurement.
  useLayoutEffect(measure, [measure, header.height, timeAxis.totalWidth, listWidth]);

  // The timeline owns the vertical scrollbar; the task list follows it (and scrolling the list, e.g. with the
  // wheel, moves the timeline). Differences under a pixel are rounding, not scrolling.
  const syncTop = (from: HTMLElement | null, to: HTMLElement | null) => {
    if (from && to && Math.abs(from.scrollTop - to.scrollTop) >= 1) to.scrollTop = from.scrollTop;
  };

  const style = {
    ...props.style,
    '--qz-list-width': `${String(listWidth)}px`,
    '--qz-header-height': `${String(header.height)}px`,
    '--qz-tick-width': `${String(timeAxis.tickWidth)}px`,
    '--qz-row-height': `${String(rows.rowHeight)}px`,
    '--qz-list-gap': `${String(gaps.list)}px`,
    '--qz-timeline-gap': `${String(gaps.timeline)}px`,
    '--qz-header-gap': `${String(gaps.header)}px`,
  } as CSSProperties;

  return (
    <div className={className ? `qz-gantt ${className}` : 'qz-gantt'} style={style}>
      {/* The list scrolls horizontally on its own when its columns don't fit (header and rows together). */}
      <div ref={listRef} className="qz-list" role="treegrid" aria-rowcount={rows.count + 1}>
        <div className="qz-list__content">
          <TaskListHeader columns={state.columns} height={header.height} />
          <div
            ref={listBodyRef}
            className="qz-list__body"
            onScroll={() => {
              syncTop(listBodyRef.current, timelineRef.current);
            }}
          >
            <div className="qz-list__canvas" style={{ height: rows.totalHeight }}>
              <TaskListBody rows={rows.items} columns={state.columns} onToggle={gantt.toggle} />
            </div>
            {rows.count === 0 && <div className="qz-gantt__empty">No tasks</div>}
          </div>
        </div>
      </div>
      <div className="qz-timeline">
        <div
          ref={timelineHeaderRef}
          className="qz-timeline__header"
          // The header can't be scrolled itself; pass wheel and trackpad scrolling on to the body.
          onWheel={(event) => {
            timelineRef.current?.scrollBy(event.deltaX, event.deltaY);
          }}
        >
          <div className="qz-timeline__header-canvas" style={{ width: timeAxis.totalWidth }}>
            <TimelineHeader header={header} />
          </div>
        </div>
        <div
          ref={timelineRef}
          className="qz-timeline__scroller"
          onScroll={(event) => {
            const { scrollLeft, scrollTop } = event.currentTarget;
            gantt.setViewport({ scrollLeft, scrollTop });
            if (timelineHeaderRef.current) timelineHeaderRef.current.scrollLeft = scrollLeft;
            syncTop(timelineRef.current, listBodyRef.current);
          }}
        >
          <div
            className="qz-timeline__body"
            style={{ width: timeAxis.totalWidth, height: rows.totalHeight }}
          />
        </div>
      </div>
    </div>
  );
}
