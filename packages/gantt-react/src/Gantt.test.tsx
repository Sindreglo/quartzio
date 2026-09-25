import type { GanttController, ProjectData, ProjectInput } from '@quartzio/gantt';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createRef, StrictMode, useState } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Gantt } from './Gantt';

const data: ProjectInput = { tasks: [{ id: 1 }, { id: 2 }] };
const rowCount = (container: HTMLElement) => container.querySelectorAll('.qz-grid__row').length;

afterEach(() => {
  vi.useRealTimers();
});

describe('<Gantt />', () => {
  it('renders the root element with custom class names', () => {
    const { container } = render(<Gantt className="custom" />);
    const root = container.firstElementChild;
    expect(root?.classList.contains('qz-gantt')).toBe(true);
    expect(root?.classList.contains('custom')).toBe(true);
  });

  it('shows an empty state when there are no tasks', () => {
    render(<Gantt />);
    expect(screen.getByText('No tasks')).toBeDefined();
  });

  it('renders column headers, rows and cells', () => {
    const { container } = render(
      <Gantt
        defaultData={{
          settings: { timeZone: 'UTC' },
          tasks: [{ id: 1, name: 'Design', startDate: '2026-10-05', endDate: '2026-10-08' }],
        }}
        locale="en-US"
      />,
    );
    expect([...container.querySelectorAll('.qz-grid__header-cell')].map((cell) => cell.textContent)).toEqual([
      'Name',
      'Start',
      'End',
      'Duration',
    ]);
    expect([...container.querySelectorAll('.qz-grid__text')].map((cell) => cell.textContent)).toEqual([
      'Design',
      'Oct 5, 2026',
      'Oct 7, 2026',
      '3 days',
    ]);
  });

  it('collapses and expands a parent with its toggle button', () => {
    const { container } = render(
      <Gantt
        defaultData={{ tasks: [{ id: 'p', name: 'Parent', children: [{ id: 'c', name: 'Child' }] }] }}
      />,
    );
    const toggle = screen.getByRole('button', { name: 'Collapse' });
    fireEvent.click(toggle);
    expect(rowCount(container)).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
    expect(rowCount(container)).toBe(2);
  });

  it('exposes the controller through ref', () => {
    const ref = createRef<GanttController>();
    render(<Gantt ref={ref} defaultData={data} />);
    expect(ref.current?.getState().project.tasks.order).toEqual([1, 2]);
  });

  it('applies edits directly when uncontrolled', () => {
    const ref = createRef<GanttController>();
    const onChange = vi.fn();
    const { container } = render(<Gantt ref={ref} defaultData={data} onChange={onChange} />);

    act(() => {
      ref.current?.transact((tx) => tx.tasks.add({ id: 3 }));
    });

    expect(rowCount(container)).toBe(3);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('only shows edits once the parent passes new data when controlled', async () => {
    const ref = createRef<GanttController>();
    let accept = false;

    function Controlled() {
      const [current, setCurrent] = useState<ProjectInput>(data);
      const handleChange = ({ data: next }: { data: ProjectData }) => {
        if (accept) setCurrent(next);
      };
      return <Gantt ref={ref} data={current} onChange={handleChange} />;
    }
    const { container } = render(<Controlled />);

    act(() => {
      ref.current?.transact((tx) => tx.tasks.add({ id: 3 }));
    });
    expect(rowCount(container)).toBe(2);

    accept = true;
    await act(async () => {
      await Promise.resolve(); // a separate user event
      ref.current?.transact((tx) => tx.tasks.add({ id: 3 }));
    });
    expect(rowCount(container)).toBe(3);
  });

  it('shows data that arrives after mount (data={undefined} while loading)', () => {
    const onChange = vi.fn();
    const { container, rerender } = render(<Gantt data={undefined} onChange={onChange} />);
    expect(screen.getByText('No tasks')).toBeDefined();

    rerender(<Gantt data={data} onChange={onChange} />);
    expect(rowCount(container)).toBe(2);
  });

  it('renders on the server', () => {
    const html = renderToString(<Gantt defaultData={data} />);
    expect(html.match(/qz-grid__row/g)).toHaveLength(2);
    expect(html).toContain('qz-header__cell');
  });

  it('renders the time axis header in the given preset and locale', () => {
    const { container } = render(
      <Gantt
        defaultData={{ settings: { timeZone: 'UTC' } }}
        preset="monthAndYear"
        startDate="2026-01-01"
        endDate="2027-01-01"
        locale="nb-NO"
      />,
    );
    const labels = [...container.querySelectorAll('.qz-header__row:last-child .qz-header__cell')].map(
      (cell) => cell.textContent,
    );
    expect(labels.slice(0, 3)).toEqual(['jan', 'feb', 'mar']);
  });

  it('updates the header when props change', () => {
    const props = {
      defaultData: { settings: { timeZone: 'UTC' } },
      startDate: '2026-01-01',
      endDate: '2027-01-01',
    };
    const { container, rerender } = render(<Gantt {...props} preset="monthAndYear" />);
    rerender(<Gantt {...props} preset="quarterAndYear" />);
    expect(container.querySelector('.qz-header__row:last-child .qz-header__cell')?.textContent).toBe('Q1');
  });

  it('reports scrolling to the engine, and keeps the scrollbars and the task list header in step', () => {
    const ref = createRef<GanttController>();
    const { container } = render(<Gantt ref={ref} defaultData={data} />);
    const find = (selector: string) => container.querySelector(selector) as HTMLElement;
    // One scroll area holds the headers, the task list and the timeline, so they can't scroll out of step.
    const scroller = find('.qz-gantt__scroller');
    for (const part of ['.qz-list__header', '.qz-timeline__header', '.qz-list__body', '.qz-timeline__body']) {
      expect(scroller.contains(find(part))).toBe(true);
    }
    scroller.scrollLeft = 250;
    scroller.scrollTop = 40;
    fireEvent.scroll(scroller);
    expect(ref.current?.getState().viewport).toMatchObject({ scrollLeft: 250, scrollTop: 40 });
    expect(find('.qz-timeline__scrollbar').scrollLeft).toBe(250);
    expect(find('.qz-gantt__scrollbar-y').scrollTop).toBe(40);
    // Dragging a scrollbar scrolls the content.
    const vertical = find('.qz-gantt__scrollbar-y');
    vertical.scrollTop = 80;
    fireEvent.scroll(vertical);
    expect(scroller.scrollTop).toBe(80);
    // The task list scrolls horizontally on its own; its header and scrollbar follow.
    const list = find('.qz-list__body');
    list.scrollLeft = 30;
    fireEvent.scroll(list);
    expect(find('.qz-list__header').scrollLeft).toBe(30);
    expect(find('.qz-list__scrollbar').scrollLeft).toBe(30);
  });

  it('does not pull the content back when a scrollbar echoes a position the content has already left', () => {
    const { container } = render(<Gantt defaultData={data} />);
    const find = (selector: string) => container.querySelector(selector) as HTMLElement;
    const scroller = find('.qz-gantt__scroller');
    const list = find('.qz-list__body');
    // Momentum scrolling: the content moves on every frame, and each scrollbar's scroll event (caused by our own
    // sync) arrives a frame later, with the previous position.
    for (const [content, bar, axis] of [
      [scroller, find('.qz-timeline__scrollbar'), 'scrollLeft'],
      [scroller, find('.qz-gantt__scrollbar-y'), 'scrollTop'],
      [list, find('.qz-list__scrollbar'), 'scrollLeft'],
    ] as const) {
      content[axis] = 100;
      fireEvent.scroll(content);
      expect(bar[axis]).toBe(100);
      content[axis] = 125;
      fireEvent.scroll(bar); // the echo of 100
      expect(content[axis]).toBe(125);
      fireEvent.scroll(content);
      expect(bar[axis]).toBe(125);
      // Dragging the scrollbar itself still scrolls the content, also right after an echo.
      bar[axis] = 60;
      fireEvent.scroll(bar);
      expect(content[axis]).toBe(60);
      // ...and the content's echo of that doesn't pull the scrollbar back while it's being dragged on.
      bar[axis] = 40;
      fireEvent.scroll(content);
      expect(bar[axis]).toBe(40);
    }
  });

  it('reports the initial scheduling once, also in StrictMode', async () => {
    const onChange = vi.fn();
    render(
      <StrictMode>
        <Gantt
          defaultData={{
            settings: { timeZone: 'UTC', startDate: '2026-10-05' },
            tasks: [{ id: 'a', duration: 2 }],
          }}
          onChange={onChange}
        />
      </StrictMode>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect((onChange.mock.calls[0]?.[0] as { data: ProjectData }).data.tasks[0]?.startDate).toBe(
      Date.UTC(2026, 9, 5, 8),
    );
  });

  describe('dragging', () => {
    // UTC, 32 px per day from Monday 5 Oct; a manual task on 6–8 Oct (x 32–96) in row 0.
    const dragData: ProjectInput = {
      settings: { timeZone: 'UTC', startDate: '2026-10-05' },
      tasks: [
        { id: 'm', name: 'Move me', manuallyScheduled: true, startDate: '2026-10-06', endDate: '2026-10-08' },
      ],
    };
    const renderDrag = (props = {}) =>
      render(
        <Gantt
          defaultData={dragData}
          preset="weekAndDay"
          startDate="2026-10-05"
          endDate="2026-11-02"
          locale="en-US"
          {...props}
        />,
      );
    const body = (container: HTMLElement) => container.querySelector('.qz-timeline__body') as HTMLElement;
    const pointer = { pointerId: 1, button: 0, isPrimary: true };

    it('shows a preview with the new dates while dragging, and reports the drop', () => {
      const onChange = vi.fn();
      const { container } = renderDrag({ onChange });
      const timeline = body(container);
      fireEvent.pointerDown(timeline, { ...pointer, clientX: 50, clientY: 18 });
      fireEvent.pointerMove(timeline, { ...pointer, clientX: 114, clientY: 18 });
      expect(timeline.dataset.dragging).toBe('move');
      expect(container.querySelector('.qz-timeline__row--dragging')).not.toBeNull();
      expect(container.querySelector('.qz-timeline__draft .qz-drag-tooltip')?.textContent).toBe(
        'Oct 8, 2026 – Oct 9, 2026',
      );
      fireEvent.pointerUp(timeline, { ...pointer, clientX: 114, clientY: 18 });
      expect(container.querySelector('.qz-timeline__draft')).toBeNull();
      const { data } = onChange.mock.calls.at(-1)?.[0] as { data: ProjectData };
      expect(data.tasks[0]?.startDate).toBe(Date.UTC(2026, 9, 8));
    });

    it('ignores a second finger, and lets Escape go no further than the drag', () => {
      const onChange = vi.fn();
      const { container } = renderDrag({ onChange });
      const timeline = body(container);
      fireEvent.pointerDown(timeline, { ...pointer, clientX: 50, clientY: 18 });
      fireEvent.pointerMove(timeline, { ...pointer, clientX: 114, clientY: 18 });
      fireEvent.pointerDown(timeline, {
        pointerId: 2,
        button: 0,
        isPrimary: false,
        clientX: 300,
        clientY: 18,
      });
      expect(timeline.dataset.dragging).toBe('move');
      const outer = vi.fn();
      window.addEventListener('keydown', outer);
      fireEvent.keyDown(window, { key: 'Escape' });
      window.removeEventListener('keydown', outer);
      expect(outer).not.toHaveBeenCalled();
      expect(onChange).not.toHaveBeenCalled();
    });

    it('drops the drag on Escape, changing nothing', () => {
      const onChange = vi.fn();
      const { container } = renderDrag({ onChange });
      const timeline = body(container);
      fireEvent.pointerDown(timeline, { ...pointer, clientX: 50, clientY: 18 });
      fireEvent.pointerMove(timeline, { ...pointer, clientX: 114, clientY: 18 });
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(container.querySelector('.qz-timeline__draft')).toBeNull();
      fireEvent.pointerUp(timeline, { ...pointer, clientX: 114, clientY: 18 });
      expect(onChange).not.toHaveBeenCalled();
    });

    it('tells the cursor what a press would do, and nothing when dragging is off', () => {
      const { container, rerender } = renderDrag();
      const timeline = body(container);
      fireEvent.pointerMove(timeline, { ...pointer, clientX: 50, clientY: 18 });
      expect(timeline.dataset.hit).toBe('bar');
      fireEvent.pointerMove(timeline, { ...pointer, clientX: 94, clientY: 18 });
      expect(timeline.dataset.hit).toBe('resize-end');
      rerender(
        <Gantt
          defaultData={dragData}
          preset="weekAndDay"
          startDate="2026-10-05"
          endDate="2026-11-02"
          taskDrag={false}
          taskResize={false}
        />,
      );
      fireEvent.pointerMove(timeline, { ...pointer, clientX: 50, clientY: 18 });
      expect(timeline.dataset.hit).toBe('');
    });
  });

  it('renders tasks 1 and "1" as two rows, with row positions for assistive tech', () => {
    const { container } = render(
      <Gantt
        defaultData={{
          tasks: [
            { id: 1, name: 'A' },
            { id: '1', name: 'B' },
          ],
        }}
      />,
    );
    const rows = [...container.querySelectorAll('.qz-grid__row')];
    expect(rows.map((row) => row.getAttribute('aria-rowindex'))).toEqual(['2', '3']);
    expect(container.querySelector('[role="treegrid"]')?.getAttribute('aria-rowcount')).toBe('3');
  });

  describe('timeline body', () => {
    // 'weekAndDay': 32 px per day, starting on Monday 5 October.
    // Manually scheduled: dates as given (these tests are about drawing, not scheduling).
    const project: ProjectInput = {
      settings: { timeZone: 'UTC' },
      tasks: [
        {
          id: 'p',
          name: 'Phase',
          children: [
            {
              id: 't',
              name: 'Build',
              startDate: '2026-10-06',
              endDate: '2026-10-08',
              percentDone: 25,
              manuallyScheduled: true,
            },
          ],
        },
        { id: 'm', name: 'Launch', startDate: '2026-10-09', manuallyScheduled: true },
        { id: 'u', name: 'Someday' },
      ],
    };
    const renderChart = (props = {}) =>
      render(
        <Gantt
          defaultData={project}
          preset="weekAndDay"
          startDate="2026-10-05"
          endDate="2026-11-02"
          {...props}
        />,
      );
    const body = (container: HTMLElement) => container.querySelector('.qz-timeline__body') as HTMLElement;

    it('draws task, summary and milestone bars in rows keyed like the task list, hidden from assistive tech', () => {
      const { container } = renderChart();
      expect(body(container).getAttribute('aria-hidden')).toBe('true');

      const rows = [...body(container).querySelectorAll('.qz-timeline__row')];
      const listKeys = [...container.querySelectorAll('.qz-grid__row')].map((row) =>
        row.getAttribute('data-key'),
      );
      expect(rows.map((row) => row.getAttribute('data-key'))).toEqual(listKeys);

      const task = body(container).querySelector('.qz-bar--task') as HTMLElement;
      expect(task.style.left).toBe('32px');
      expect(task.style.width).toBe('64px');
      expect(task.textContent).toBe('Build');
      expect((task.querySelector('.qz-bar__progress') as HTMLElement).style.width).toBe('25%');

      expect((body(container).querySelector('.qz-bar--summary') as HTMLElement).style.left).toBe('32px');
      const milestone = body(container).querySelector('.qz-bar--milestone') as HTMLElement;
      expect(milestone.style.left).toBe(`${String(4 * 32)}px`);
      expect(milestone.textContent).toBe('Launch');
      // The unscheduled task has a row but no bar.
      expect(body(container).querySelectorAll('.qz-bar')).toHaveLength(3);
    });

    it('draws dependencies as paths with an arrowhead, behind the bars', () => {
      const { container } = render(
        <Gantt
          defaultData={{ ...project, dependencies: [{ id: 'd', from: 't', to: 'm' }] }}
          preset="weekAndDay"
          startDate="2026-10-05"
          endDate="2026-11-02"
        />,
      );
      const paths = body(container).querySelectorAll('.qz-dependencies .qz-dependency');
      expect(paths).toHaveLength(1);
      const path = paths[0] as SVGPathElement;
      expect(path.getAttribute('data-from')).toBe('t');
      expect(path.getAttribute('data-to')).toBe('m');
      expect(path.getAttribute('d')).toMatch(/^M\S+ \S+ H/);
      const marker = path.getAttribute('marker-end')?.match(/#([^)]+)/)?.[1] ?? '';
      expect(marker).toMatch(/^[\w-]+$/);
      expect(container.querySelector(`marker#${marker}`)).not.toBeNull();
      // Behind the bars: the layer comes before the rows.
      const layers = [...body(container).children].map((child) => child.getAttribute('class'));
      expect(layers.indexOf('qz-dependencies')).toBeLessThan(layers.indexOf('qz-timeline__row'));
    });

    it('shows the today line and weekend shading, and hides them when turned off', () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(Date.UTC(2026, 9, 6, 12));
      const { container, rerender } = renderChart();
      expect((body(container).querySelector('.qz-today') as HTMLElement).style.left).toBe('48px');
      const shade = body(container).querySelector('.qz-nonworking') as HTMLElement;
      expect(shade.style.left).toBe(`${String(5 * 32)}px`);
      expect(shade.style.width).toBe('64px');

      rerender(
        <Gantt
          defaultData={project}
          preset="weekAndDay"
          startDate="2026-10-05"
          endDate="2026-11-02"
          showToday={false}
          showNonWorkingTime={false}
        />,
      );
      expect(body(container).querySelector('.qz-today')).toBeNull();
      expect(body(container).querySelector('.qz-nonworking')).toBeNull();
    });

    it('passes the switches on at creation', () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(Date.UTC(2026, 9, 6, 12));
      const { container } = renderChart({ showToday: false, showNonWorkingTime: false });
      expect(body(container).querySelector('.qz-today')).toBeNull();
      expect(body(container).querySelector('.qz-nonworking')).toBeNull();
    });
  });
});
