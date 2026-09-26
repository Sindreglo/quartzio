import { type ReactElement, type RefObject, type WheelEvent } from 'react';
import { follow, isEcho } from './scrollSync';

/** The native scrollbar thickness, measured inside the chart so page-level scrollbar styles count. */
export function scrollbarSize(root: HTMLElement): number {
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:absolute;top:0;left:0;width:100px;height:100px;overflow:scroll;visibility:hidden';
  root.appendChild(probe);
  const size = probe.offsetHeight - probe.clientHeight;
  probe.remove();
  return size;
}

/**
 * The chart's own scrollbars, placed where they belong (the scroll area's own are hidden: they'd span the headers
 * and the task list). They follow the content, and the content follows them (see scrollSync).
 */
export function Scrollbars({
  scrollerRef,
  listBodyRef,
  verticalRef,
  listRef,
  timelineRef,
  height,
  listWidth,
  timelineWidth,
}: {
  scrollerRef: RefObject<HTMLDivElement | null>;
  listBodyRef: RefObject<HTMLDivElement | null>;
  verticalRef: RefObject<HTMLDivElement | null>;
  listRef: RefObject<HTMLDivElement | null>;
  timelineRef: RefObject<HTMLDivElement | null>;
  height: number;
  listWidth: number;
  timelineWidth: number;
}): ReactElement {
  // The scrollbars can only scroll in their own direction; pass the other one on to the content.
  const forwardWheel = (event: WheelEvent) => {
    scrollerRef.current?.scrollBy(
      event.currentTarget === verticalRef.current ? event.deltaX : 0,
      event.currentTarget === verticalRef.current ? 0 : event.deltaY,
    );
  };
  return (
    <>
      <div
        ref={verticalRef}
        className="qz-gantt__scrollbar-y"
        tabIndex={-1}
        aria-hidden="true"
        onScroll={(event) => {
          if (!isEcho(event.currentTarget, 'scrollTop'))
            follow(event.currentTarget, 'scrollTop', scrollerRef.current);
        }}
        onWheel={forwardWheel}
      >
        <div style={{ height: height }} />
      </div>
      <div className="qz-gantt__footer" aria-hidden="true">
        <div
          ref={listRef}
          className="qz-list__scrollbar"
          tabIndex={-1}
          onScroll={(event) => {
            if (!isEcho(event.currentTarget, 'scrollLeft'))
              follow(event.currentTarget, 'scrollLeft', listBodyRef.current);
          }}
          onWheel={forwardWheel}
        >
          <div style={{ width: listWidth }} />
        </div>
        <div
          ref={timelineRef}
          className="qz-timeline__scrollbar"
          tabIndex={-1}
          onScroll={(event) => {
            if (!isEcho(event.currentTarget, 'scrollLeft'))
              follow(event.currentTarget, 'scrollLeft', scrollerRef.current);
          }}
          onWheel={forwardWheel}
        >
          <div style={{ width: timelineWidth }} />
        </div>
      </div>
    </>
  );
}
