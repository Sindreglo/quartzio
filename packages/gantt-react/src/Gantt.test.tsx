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

    it('shows handles for linking and progress, unless turned off', () => {
      const { container, rerender } = renderDrag();
      expect(container.querySelectorAll('.qz-link-handle')).toHaveLength(2);
      expect(container.querySelectorAll('.qz-progress-handle')).toHaveLength(1);
      rerender(
        <Gantt
          defaultData={dragData}
          preset="weekAndDay"
          startDate="2026-10-05"
          endDate="2026-11-02"
          dependencyCreate={false}
          progressDrag={false}
        />,
      );
      expect(container.querySelectorAll('.qz-link-handle, .qz-progress-handle')).toHaveLength(0);
    });

    it('draws a dependency line while linking, marked invalid onto the same task', () => {
      const { container } = renderDrag();
      const timeline = body(container);
      fireEvent.pointerDown(timeline, { ...pointer, clientX: 100, clientY: 18 }); // just after the bar's end
      fireEvent.pointerMove(timeline, { ...pointer, clientX: 60, clientY: 18 }); // back onto the same bar
      const draft = container.querySelector('.qz-link-draft');
      expect(draft?.classList.contains('qz-draft--invalid')).toBe(true);
      expect(draft?.querySelector('.qz-dependency')?.getAttribute('d')).toBe('M96 18 L60 18');
      expect(container.querySelector('.qz-drag-tooltip--pointer')?.textContent).toBe(
        'Can’t link a task to itself',
      );
      fireEvent.pointerUp(timeline, { ...pointer, clientX: 60, clientY: 18 });
      expect(container.querySelector('.qz-link-draft')).toBeNull();
    });

    it('goes back to the default when a prop is removed', () => {
      const props = {
        defaultData: dragData,
        preset: 'weekAndDay',
        startDate: '2026-10-05',
        endDate: '2026-11-02',
      };
      const { container, rerender } = render(<Gantt {...props} taskDrag={false} dependencyCreate={false} />);
      const timeline = body(container);
      fireEvent.pointerMove(timeline, { ...pointer, clientX: 50, clientY: 18 });
      expect(timeline.dataset.hit).toBe('');
      rerender(<Gantt {...props} />);
      fireEvent.pointerMove(timeline, { ...pointer, clientX: 50, clientY: 18 });
      expect(timeline.dataset.hit).toBe('bar');
      expect(container.querySelectorAll('.qz-link-handle')).toHaveLength(2);
    });

    it('produces no new state when rendered again with the same props', () => {
      const ref = createRef<GanttController>();
      const props = {
        defaultData: dragData,
        preset: 'weekAndDay',
        startDate: '2026-10-05',
        endDate: '2026-11-02',
      };
      const { rerender } = render(<Gantt ref={ref} {...props} columns={['name', 'duration']} />);
      const state = ref.current?.getState();
      rerender(<Gantt ref={ref} {...props} columns={['name', 'duration']} />); // an equal inline array
      expect(ref.current?.getState()).toBe(state);
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
  describe('selection and keyboard', () => {
    const tasks: ProjectInput = {
      tasks: [
        { id: 'p', name: 'Parent', children: [{ id: 'c', name: 'Child' }] },
        { id: 'my task', name: 'Other' },
      ],
    };
    const rows = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('.qz-grid__row')];
    const root = (container: HTMLElement) => container.firstElementChild as HTMLElement;

    it('selects a clicked row, and adds with Ctrl', () => {
      const onSelectionChange = vi.fn();
      const { container } = render(<Gantt defaultData={tasks} onSelectionChange={onSelectionChange} />);
      fireEvent.click(rows(container)[0] as HTMLElement);
      fireEvent.click(rows(container)[2] as HTMLElement, { ctrlKey: true });
      expect(rows(container).map((row) => row.getAttribute('aria-selected'))).toEqual([
        'true',
        'false',
        'true',
      ]);
      expect(onSelectionChange).toHaveBeenLastCalledWith(['p', 'my task']);
      expect(root(container).getAttribute('aria-multiselectable')).toBe('true');
    });

    it('does not select a row when its toggle button is clicked', () => {
      const { container } = render(<Gantt defaultData={tasks} />);
      fireEvent.click(screen.getByRole('button', { name: 'Collapse' }));
      expect(rows(container)[0]?.getAttribute('aria-selected')).toBe('false');
      expect(screen.getByRole('button', { name: 'Expand' }).tabIndex).toBe(-1);
    });

    it('moves with the arrow keys, pointing at the active row, and stops the keys it uses', () => {
      const { container } = render(<Gantt defaultData={tasks} />);
      const chart = root(container);
      expect(chart.tabIndex).toBe(0);
      expect(fireEvent.keyDown(chart, { key: 'ArrowDown' })).toBe(false); // default prevented
      fireEvent.keyDown(chart, { key: 'End' });
      const active = rows(container)[2] as HTMLElement;
      expect(chart.getAttribute('aria-activedescendant')).toBe(active.id);
      expect(active.id).not.toMatch(/\s/);
      expect(active.getAttribute('aria-selected')).toBe('true');
      expect(fireEvent.keyDown(chart, { key: 'x' })).toBe(true); // not used: left alone
    });

    it('deletes the selected task with Delete, and undoes with Ctrl+Z', () => {
      const { container } = render(<Gantt defaultData={tasks} />);
      const chart = root(container);
      fireEvent.click(rows(container)[2] as HTMLElement);
      fireEvent.keyDown(chart, { key: 'Delete' });
      expect(rowCount(container)).toBe(2);
      fireEvent.keyDown(chart, { key: 'z', ctrlKey: true });
      expect(rowCount(container)).toBe(3);
    });

    it('leaves keys in inputs inside the chart alone', () => {
      const { container } = render(<Gantt defaultData={tasks} />);
      const input = document.createElement('input');
      root(container).appendChild(input);
      expect(fireEvent.keyDown(input, { key: 'ArrowDown' })).toBe(true);
      expect(rows(container)[0]?.getAttribute('aria-selected')).toBe('false');
    });

    it('has one tab stop: the scroll areas are not tab stops', () => {
      const { container } = render(<Gantt defaultData={tasks} />);
      const stops = [...container.querySelectorAll<HTMLElement>('[tabindex]')].filter(
        (el) => el.tabIndex >= 0,
      );
      expect(stops).toEqual([root(container)]);
      for (const selector of [
        '.qz-gantt__scroller',
        '.qz-list__body',
        '.qz-gantt__scrollbar-y',
        '.qz-list__scrollbar',
        '.qz-timeline__scrollbar',
      ]) {
        expect(container.querySelector<HTMLElement>(selector)?.tabIndex).toBe(-1);
      }
    });

    it('moves focus from a press inside back to the chart, but not focus reached otherwise', () => {
      const { container } = render(<Gantt defaultData={tasks} />);
      const scroller = container.querySelector('.qz-gantt__scroller') as HTMLElement;
      fireEvent.pointerDown(scroller);
      scroller.focus();
      expect(document.activeElement).toBe(root(container));
      fireEvent.pointerUp(scroller);
      scroller.focus(); // e.g. by a script or assistive tech: left alone, so Tab can move on
      expect(document.activeElement).toBe(scroller);
    });

    it('selects the row of a click in the timeline', () => {
      const { container } = render(<Gantt defaultData={tasks} />);
      const timeline = container.querySelector('.qz-timeline__body') as HTMLElement;
      const pointer = { pointerId: 1, button: 0, isPrimary: true };
      fireEvent.pointerDown(timeline, { ...pointer, clientX: 400, clientY: 36 + 18 });
      fireEvent.pointerUp(timeline, { ...pointer, clientX: 400, clientY: 36 + 18 });
      expect(rows(container)[1]?.getAttribute('aria-selected')).toBe('true');
      expect(container.querySelectorAll('.qz-timeline__row--selected')).toHaveLength(1);
    });

    it('turns deleting off with deleteKey={false}', () => {
      const { container } = render(<Gantt defaultData={tasks} deleteKey={false} />);
      fireEvent.click(rows(container)[2] as HTMLElement);
      fireEvent.keyDown(root(container), { key: 'Delete' });
      expect(rowCount(container)).toBe(3);
    });
  });
  describe('tooltip and editing', () => {
    const project: ProjectInput = {
      settings: { timeZone: 'UTC', startDate: '2026-10-05' },
      tasks: [
        { id: 'm', name: 'Manual', manuallyScheduled: true, startDate: '2026-10-06', endDate: '2026-10-08' },
        { id: 'a', name: 'Auto', duration: 2 },
      ],
    };
    const renderChart = (props = {}) =>
      render(
        <Gantt
          defaultData={project}
          preset="weekAndDay"
          startDate="2026-10-05"
          endDate="2026-11-02"
          locale="en-US"
          {...props}
        />,
      );
    const body = (container: HTMLElement) => container.querySelector('.qz-timeline__body') as HTMLElement;
    const cell = (container: HTMLElement, row: number, column: number) =>
      container.querySelectorAll('.qz-grid__row')[row]?.querySelectorAll('.qz-grid__cell')[
        column
      ] as HTMLElement;
    const mouse = { pointerId: 1, pointerType: 'mouse', isPrimary: true };

    it('shows the tooltip of the bar under a mouse, and hides it when the pointer leaves', () => {
      const { container } = renderChart();
      fireEvent.pointerMove(body(container), { ...mouse, clientX: 50, clientY: 18 });
      expect(container.querySelector('.qz-tooltip__title')?.textContent).toBe('Manual');
      expect(container.querySelector('.qz-tooltip--below')).not.toBeNull(); // first row
      fireEvent.pointerLeave(body(container), mouse);
      expect(container.querySelector('.qz-tooltip')).toBeNull();
    });

    it('shows no tooltip for touch, and custom content with renderTaskTooltip', () => {
      const { container, rerender } = renderChart();
      fireEvent.pointerMove(body(container), { ...mouse, pointerType: 'touch', clientX: 50, clientY: 18 });
      expect(container.querySelector('.qz-tooltip')).toBeNull();
      rerender(
        <Gantt
          defaultData={project}
          preset="weekAndDay"
          startDate="2026-10-05"
          endDate="2026-11-02"
          renderTaskTooltip={(tooltip) => <b className="custom">{tooltip.task.id}</b>}
        />,
      );
      fireEvent.pointerMove(body(container), { ...mouse, clientX: 50, clientY: 18 });
      expect(container.querySelector('.qz-tooltip .custom')?.textContent).toBe('m');
    });

    it('edits a cell on double-click, saves with Enter and gives focus back to the chart', () => {
      const onChange = vi.fn();
      const { container } = renderChart({ onChange });
      fireEvent.doubleClick(cell(container, 0, 0));
      const input = screen.getByRole('textbox', { name: 'Name' });
      expect(document.activeElement).toBe(input);
      fireEvent.change(input, { target: { value: 'Renamed' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(container.querySelector('.qz-cell-editor')).toBeNull();
      expect(cell(container, 0, 0).textContent).toBe('Renamed');
      expect(document.activeElement).toBe(container.firstElementChild);
      expect(onChange).toHaveBeenCalled();
    });

    it('uses a date field for dates, and shows why a value is refused', () => {
      const { container } = renderChart();
      fireEvent.doubleClick(cell(container, 1, 3)); // duration
      const input = screen.getByRole('textbox', { name: 'Duration' });
      fireEvent.change(input, { target: { value: 'soon' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(input.getAttribute('aria-invalid')).toBe('true');
      expect(screen.getByRole('alert').textContent).toMatch(/duration/);
      fireEvent.keyDown(input, { key: 'Escape' });
      expect(container.querySelector('.qz-cell-editor')).toBeNull();
      fireEvent.doubleClick(cell(container, 0, 1));
      expect((container.querySelector('.qz-cell-editor') as HTMLInputElement).type).toBe('date');
    });

    it('saves on blur, and drops a value that cannot be saved', () => {
      const { container } = renderChart();
      fireEvent.doubleClick(cell(container, 0, 0));
      let input = screen.getByRole('textbox', { name: 'Name' });
      fireEvent.change(input, { target: { value: 'Blurred' } });
      fireEvent.blur(input);
      expect(cell(container, 0, 0).textContent).toBe('Blurred');
      fireEvent.doubleClick(cell(container, 1, 3));
      input = screen.getByRole('textbox', { name: 'Duration' });
      fireEvent.change(input, { target: { value: '-3' } });
      fireEvent.blur(input);
      expect(container.querySelector('.qz-cell-editor')).toBeNull();
      expect(cell(container, 1, 3).textContent).toBe('2 days');
    });

    it('starts editing with Enter on the active row, and keys in the field stay there', () => {
      const onSelectionChange = vi.fn();
      const { container } = renderChart({ onSelectionChange });
      const chart = container.firstElementChild as HTMLElement;
      fireEvent.keyDown(chart, { key: 'ArrowDown' });
      fireEvent.keyDown(chart, { key: 'Enter' });
      const input = screen.getByRole('textbox', { name: 'Name' });
      onSelectionChange.mockClear();
      fireEvent.keyDown(input, { key: 'ArrowDown' }); // moves the caret, not the row
      expect(onSelectionChange).not.toHaveBeenCalled();
      expect(container.querySelector('.qz-cell-editor')).not.toBeNull();
    });

    it('keeps the field open in StrictMode', async () => {
      const { container } = render(
        <StrictMode>
          <Gantt defaultData={project} locale="en-US" />
        </StrictMode>,
      );
      fireEvent.doubleClick(cell(container, 0, 0));
      await act(() => Promise.resolve());
      expect(document.activeElement).toBe(container.querySelector('.qz-cell-editor'));
    });

    it('does not edit the name when the expand button is double-clicked', () => {
      const { container } = render(
        <Gantt
          defaultData={{ tasks: [{ id: 'p', name: 'Parent', children: [{ id: 'c', name: 'Child' }] }] }}
        />,
      );
      fireEvent.doubleClick(screen.getByRole('button', { name: 'Collapse' }));
      expect(container.querySelector('.qz-cell-editor')).toBeNull();
    });

    it('gives focus back to the chart when the field goes while focused', async () => {
      const ref = createRef<GanttController>();
      const { container } = render(
        <Gantt
          ref={ref}
          defaultData={{ tasks: [{ id: 'p', name: 'Parent', children: [{ id: 'c', name: 'Child' }] }] }}
        />,
      );
      act(() => {
        ref.current?.startEdit('c', 'name');
      });
      expect(document.activeElement).toBe(container.querySelector('.qz-cell-editor'));
      act(() => {
        ref.current?.toggle('p'); // hides the edited row
      });
      expect(container.querySelector('.qz-cell-editor')).toBeNull();
      await act(() => Promise.resolve());
      expect(document.activeElement).toBe(container.firstElementChild);
    });

    it('turns editing off with cellEdit={false}', () => {
      const { container } = renderChart({ cellEdit: false });
      fireEvent.doubleClick(cell(container, 0, 0));
      expect(container.querySelector('.qz-cell-editor')).toBeNull();
    });
  });
  describe('menus and the task editor', () => {
    const project: ProjectInput = {
      settings: { timeZone: 'UTC', startDate: '2026-10-05' },
      tasks: [
        { id: 'a', name: 'Alpha', duration: 2 },
        { id: 'b', name: 'Beta', duration: 1 },
      ],
    };
    const renderChart = (props = {}) =>
      render(
        <Gantt
          defaultData={project}
          preset="weekAndDay"
          startDate="2026-10-05"
          endDate="2026-11-02"
          locale="en-US"
          {...props}
        />,
      );
    const rows = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('.qz-grid__row')];
    const names = (container: HTMLElement) =>
      rows(container).map((row) => row.querySelector('.qz-grid__text')?.textContent);

    it('opens the task menu on right-click, and runs what is picked', () => {
      const { container } = renderChart();
      const row = rows(container)[1] as HTMLElement;
      expect(fireEvent.contextMenu(row)).toBe(false); // the browser's menu is replaced
      const menu = screen.getByRole('menu');
      expect(document.activeElement).toBe(menu);
      expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toContain('Delete');
      fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
      expect(screen.queryByRole('menu')).toBeNull();
      expect(names(container)).toEqual(['Alpha']);
    });

    it('keeps focus in the menu when it opens during the press (as Chrome does on macOS)', () => {
      const { container } = renderChart();
      const row = rows(container)[0] as HTMLElement;
      fireEvent.pointerDown(row, { button: 2 });
      fireEvent.contextMenu(row);
      expect(document.activeElement).toBe(screen.getByRole('menu'));
    });

    it('opens the Add submenu on hover, and adds a task with its name open for editing', () => {
      const { container } = renderChart();
      fireEvent.contextMenu(rows(container)[0] as HTMLElement);
      fireEvent.pointerEnter(screen.getByRole('menuitem', { name: /Add/ }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Task below' }));
      expect(rows(container)[1]?.querySelector('.qz-cell-editor')).not.toBeNull(); // its name is being edited
      expect((document.activeElement as HTMLInputElement).value).toBe('New task');
    });

    it('works the menu with the keyboard, and gives focus back when it closes', async () => {
      const { container } = renderChart();
      const chart = container.firstElementChild as HTMLElement;
      fireEvent.keyDown(chart, { key: 'ArrowDown' });
      fireEvent.keyDown(chart, { key: 'ContextMenu' });
      const menu = screen.getByRole('menu');
      expect(menu.getAttribute('aria-activedescendant')).toBeTruthy();
      fireEvent.keyDown(menu, { key: 'Escape' });
      expect(screen.queryByRole('menu')).toBeNull();
      await act(() => Promise.resolve());
      expect(document.activeElement).toBe(chart);
    });

    it('closes the menu on a press outside it', () => {
      const { container } = renderChart();
      fireEvent.contextMenu(rows(container)[0] as HTMLElement);
      fireEvent.pointerDown(document.body);
      expect(screen.queryByRole('menu')).toBeNull();
    });

    it('zooms from the time axis menu', () => {
      const { container } = renderChart();
      fireEvent.contextMenu(container.querySelector('.qz-timeline__header') as HTMLElement);
      fireEvent.click(screen.getByRole('menuitem', { name: 'Zoom out' }));
      expect(container.querySelector('.qz-header__label')?.textContent).toMatch(/Oct|2026/);
      fireEvent.contextMenu(container.querySelector('.qz-timeline__header') as HTMLElement);
      expect(screen.getByRole('menuitemradio', { name: /Weeks$/ }).getAttribute('aria-checked')).toBe('true');
    });

    it('edits a task in the dialog on a double-click on its bar', () => {
      const { container } = renderChart();
      const bar = container.querySelector('.qz-timeline__row .qz-bar') as HTMLElement;
      const body = container.querySelector('.qz-timeline__body') as HTMLElement;
      fireEvent.doubleClick(body, { clientX: Number.parseFloat(bar.style.left) + 5, clientY: 18 });
      const dialog = container.querySelector('dialog') as HTMLDialogElement;
      expect(dialog.open).toBe(true);
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Renamed' } });
      fireEvent.change(screen.getByLabelText('Duration'), { target: { value: '3d' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      expect(container.querySelector('dialog')).toBeNull();
      expect(names(container)[0]).toBe('Renamed');
    });

    it('shows why the dialog cannot save, and closes on Cancel or Escape without saving', () => {
      const ref = createRef<GanttController>();
      const { container } = renderChart({ ref });
      act(() => {
        ref.current?.openTaskEditor('a');
      });
      fireEvent.change(screen.getByLabelText('Duration'), { target: { value: 'soon' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      expect(screen.getByLabelText('Duration').getAttribute('aria-invalid')).toBe('true');
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(container.querySelector('dialog')).toBeNull();
      act(() => {
        ref.current?.openTaskEditor('a');
      });
      fireEvent(
        container.querySelector('dialog') as HTMLDialogElement,
        new Event('cancel', { cancelable: true }),
      );
      expect(container.querySelector('dialog')).toBeNull();
    });

    it('adds a predecessor on its tab', () => {
      const ref = createRef<GanttController>();
      renderChart({ ref });
      act(() => {
        ref.current?.openTaskEditor('b');
      });
      fireEvent.click(screen.getByRole('tab', { name: 'Predecessors' }));
      fireEvent.click(screen.getByRole('button', { name: 'Add predecessor' }));
      fireEvent.change(screen.getByLabelText('Task'), { target: { value: '0' } }); // Alpha
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      expect([...(ref.current?.getState().project.dependencies.byId.values() ?? [])]).toEqual([
        expect.objectContaining({ from: 'a', to: 'b', type: 'FS' }),
      ]);
    });

    it('leaves right-clicks in a cell field to the browser', () => {
      const { container } = renderChart();
      fireEvent.doubleClick(rows(container)[0]?.querySelector('.qz-grid__cell') as HTMLElement);
      const input = container.querySelector('.qz-cell-editor') as HTMLElement;
      expect(fireEvent.contextMenu(input)).toBe(true); // not prevented
      expect(screen.queryByRole('menu')).toBeNull();
    });

    it('tells the engine when the browser closes the dialog', async () => {
      const ref = createRef<GanttController>();
      renderChart({ ref });
      act(() => {
        ref.current?.openTaskEditor('a');
      });
      const dialog = document.querySelector('dialog') as HTMLDialogElement;
      dialog.removeAttribute('open'); // as close() does
      fireEvent(dialog, new Event('close'));
      await act(() => Promise.resolve());
      expect(ref.current?.getState().taskEditor).toBeNull();
    });

    it('keeps the dialog open in StrictMode', async () => {
      const ref = createRef<GanttController>();
      render(
        <StrictMode>
          <Gantt ref={ref} defaultData={project} />
        </StrictMode>,
      );
      act(() => {
        ref.current?.openTaskEditor('a');
      });
      await act(() => new Promise((done) => setTimeout(done, 10)));
      expect(ref.current?.getState().taskEditor).not.toBeNull();
    });

    it('replaces the dialog content with renderTaskEditor', () => {
      const ref = createRef<GanttController>();
      renderChart({
        ref,
        renderTaskEditor: (editor: { task: { name: string } }) => (
          <p className="custom">{editor.task.name}</p>
        ),
      });
      act(() => {
        ref.current?.openTaskEditor('a');
      });
      expect(document.querySelector('dialog .custom')?.textContent).toBe('Alpha');
    });
  });
});
