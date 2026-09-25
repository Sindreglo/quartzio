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
  type WheelEvent,
} from 'react';
import { follow, isEcho } from './scrollSync';
import { TaskListBody, TaskListHeader } from './TaskList';
import { TimelineBody, TimelineHeader } from './Timeline';

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
  const { showToday, showNonWorkingTime } = props;
  // Key presence, not the value, decides the mode (see GanttProps).
  const controlled = 'data' in props;

  // The controller holds no timers or external resources yet, so it is not destroyed on unmount:
  // StrictMode's mount → unmount → mount would otherwise leave us with a destroyed controller. (Its one deferred
  // report, of the initial scheduling, only starts once it's subscribed to, so a controller StrictMode creates
  // and throws away never reports.)
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
      showToday,
      showNonWorkingTime,
    }),
  );
  // The third argument makes server rendering work; the server snapshot is the initial state.
  const state = useSyncExternalStore(gantt.subscribe, gantt.getState, gantt.getState);
  const rootRef = useRef<HTMLDivElement>(null);
  // One scroll area for everything, in both directions: the headers are sticky at the top and the task list at
  // the left, so the browser moves all of it together. (Syncing separate scroll areas from scroll events lags a
  // frame behind the browser's threaded scrolling, visible as flicker.) Its own scrollbars are hidden: they'd
  // span the headers and the task list. Separate scrollbars, placed where they belong, follow it instead.
  const scrollerRef = useRef<HTMLDivElement>(null);
  const verticalScrollbarRef = useRef<HTMLDivElement>(null);
  const timelineScrollbarRef = useRef<HTMLDivElement>(null);
  // The task list scrolls horizontally on its own when its columns don't fit; its header follows.
  const listHeaderRef = useRef<HTMLDivElement>(null);
  const listBodyRef = useRef<HTMLDivElement>(null);
  const listScrollbarRef = useRef<HTMLDivElement>(null);
  // CSS decides the task list's width (its columns, up to a max); measured here and copied to the grid.
  const sizerRef = useRef<HTMLDivElement>(null);

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
      showToday,
      showNonWorkingTime,
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
    showToday,
    showNonWorkingTime,
  ]);

  const { timeAxis, header, rows } = state;
  const listWidth = state.columns.totalWidth;
  // Measured: the task list's width, the native scrollbar size (0 for overlay scrollbars), and the directions
  // that scroll.
  const [layout, setLayout] = useState({ listPane: 0, scrollbar: 0, vertical: false, horizontal: false });

  const measure = useCallback(() => {
    const root = rootRef.current;
    const scroller = scrollerRef.current;
    const sizer = sizerRef.current;
    const listBody = listBodyRef.current;
    if (!root || !scroller || !sizer || !listBody) return;
    const listPane = sizer.offsetWidth;
    // The viewport is the visible part of the timeline's rows: the scroll area minus the task list and the header.
    gantt.setViewport({
      width: Math.max(0, scroller.clientWidth - listPane),
      height: Math.max(0, scroller.clientHeight - gantt.getState().header.height),
    });
    const next = {
      listPane,
      scrollbar: scrollbarSize(root),
      vertical: scroller.scrollHeight > scroller.clientHeight,
      horizontal: scroller.scrollWidth > scroller.clientWidth || listBody.scrollWidth > listBody.clientWidth,
    };
    setLayout((current) =>
      current.listPane === next.listPane &&
      current.scrollbar === next.scrollbar &&
      current.vertical === next.vertical &&
      current.horizontal === next.horizontal
        ? current
        : next,
    );
  }, [gantt]);

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    for (const ref of [rootRef, scrollerRef, sizerRef]) if (ref.current) observer.observe(ref.current);
    return () => {
      observer.disconnect();
    };
  }, [measure]);

  // Header height and content sizes decide what scrolls, so they're part of the measurement.
  useLayoutEffect(measure, [measure, header.height, timeAxis.totalWidth, listWidth, rows.totalHeight]);

  // Scrollbars are hidden while there's nothing to scroll; when they appear, start where the content is.
  useLayoutEffect(() => {
    follow(scrollerRef.current, 'scrollLeft', timelineScrollbarRef.current);
    follow(scrollerRef.current, 'scrollTop', verticalScrollbarRef.current);
    follow(listBodyRef.current, 'scrollLeft', listScrollbarRef.current);
  }, [layout.horizontal, layout.vertical]);

  // The scrollbars can only scroll in their own direction; pass the other one on to the content.
  const forwardWheel = (event: WheelEvent) => {
    scrollerRef.current?.scrollBy(
      event.currentTarget === verticalScrollbarRef.current ? event.deltaX : 0,
      event.currentTarget === verticalScrollbarRef.current ? 0 : event.deltaY,
    );
  };

  const overlay = layout.scrollbar === 0;
  const classNames = ['qz-gantt'];
  if (overlay) classNames.push('qz-gantt--overlay-scrollbars');
  if (layout.vertical) classNames.push('qz-gantt--scroll-y');
  if (layout.horizontal) classNames.push('qz-gantt--scroll-x');
  if (className) classNames.push(className);
  const style = {
    ...props.style,
    '--qz-list-width': `${String(listWidth)}px`,
    ...(layout.listPane > 0 ? { '--qz-list-pane': `${String(layout.listPane)}px` } : {}),
    '--qz-axis-width': `${String(timeAxis.totalWidth)}px`,
    '--qz-header-height': `${String(header.height)}px`,
    '--qz-tick-width': `${String(timeAxis.tickWidth)}px`,
    '--qz-row-height': `${String(rows.rowHeight)}px`,
    '--qz-scrollbar-size': `${String(layout.scrollbar)}px`,
  } as CSSProperties;

  return (
    <div
      ref={rootRef}
      className={classNames.join(' ')}
      style={style}
      role="treegrid"
      aria-rowcount={rows.count + 1}
    >
      <div ref={sizerRef} className="qz-gantt__sizer" />
      <div
        ref={scrollerRef}
        className="qz-gantt__scroller"
        onScroll={(event) => {
          const scroller = event.currentTarget;
          gantt.setViewport({ scrollLeft: scroller.scrollLeft, scrollTop: scroller.scrollTop });
          // Don't sync back what a scrollbar just set (see scrollSync): it may have been dragged on since.
          if (!isEcho(scroller, 'scrollLeft')) follow(scroller, 'scrollLeft', timelineScrollbarRef.current);
          if (!isEcho(scroller, 'scrollTop')) follow(scroller, 'scrollTop', verticalScrollbarRef.current);
        }}
      >
        <div className="qz-gantt__content" style={{ height: header.height + rows.totalHeight }}>
          <div ref={listHeaderRef} className="qz-list__header">
            <TaskListHeader columns={state.columns} height={header.height} />
          </div>
          <div className="qz-timeline__header" aria-hidden="true">
            <div className="qz-timeline__header-canvas">
              <TimelineHeader header={header} />
            </div>
          </div>
          <div
            ref={listBodyRef}
            className="qz-list__body"
            onScroll={(event) => {
              const list = event.currentTarget;
              follow(list, 'scrollLeft', listHeaderRef.current);
              if (!isEcho(list, 'scrollLeft')) follow(list, 'scrollLeft', listScrollbarRef.current);
            }}
          >
            <div className="qz-list__canvas" style={{ height: rows.totalHeight }}>
              <TaskListBody rows={rows.items} columns={state.columns} onToggle={gantt.toggle} />
            </div>
            {rows.count === 0 && <div className="qz-gantt__empty">No tasks</div>}
          </div>
          <TimelineBody
            rows={rows.items}
            dependencies={state.dependencies}
            nonWorkingTime={state.nonWorkingTime}
            today={state.today}
            width={timeAxis.totalWidth}
            height={rows.totalHeight}
          />
        </div>
      </div>
      <div
        ref={verticalScrollbarRef}
        className="qz-gantt__scrollbar-y"
        aria-hidden="true"
        onScroll={(event) => {
          if (!isEcho(event.currentTarget, 'scrollTop'))
            follow(event.currentTarget, 'scrollTop', scrollerRef.current);
        }}
        onWheel={forwardWheel}
      >
        <div style={{ height: rows.totalHeight }} />
      </div>
      <div className="qz-gantt__footer" aria-hidden="true">
        <div
          ref={listScrollbarRef}
          className="qz-list__scrollbar"
          onScroll={(event) => {
            if (!isEcho(event.currentTarget, 'scrollLeft'))
              follow(event.currentTarget, 'scrollLeft', listBodyRef.current);
          }}
          onWheel={forwardWheel}
        >
          <div style={{ width: listWidth }} />
        </div>
        <div
          ref={timelineScrollbarRef}
          className="qz-timeline__scrollbar"
          onScroll={(event) => {
            if (!isEcho(event.currentTarget, 'scrollLeft'))
              follow(event.currentTarget, 'scrollLeft', scrollerRef.current);
          }}
          onWheel={forwardWheel}
        >
          <div style={{ width: timeAxis.totalWidth }} />
        </div>
      </div>
    </div>
  );
}

/** The native scrollbar thickness, measured inside the chart so page-level scrollbar styles count. */
function scrollbarSize(root: HTMLElement): number {
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:absolute;top:0;left:0;width:100px;height:100px;overflow:scroll;visibility:hidden';
  root.appendChild(probe);
  const size = probe.offsetHeight - probe.clientHeight;
  probe.remove();
  return size;
}
