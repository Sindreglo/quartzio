import type { GanttController, ProjectData, ProjectInput } from '@quartzio/gantt';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createRef, useState } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Gantt } from './Gantt';

const data: ProjectInput = { tasks: [{ id: 1 }, { id: 2 }] };
const rowCount = (container: HTMLElement) => container.querySelectorAll('.qz-grid__row').length;

describe('<Gantt />', () => {
  it('renders the root element with custom class names', () => {
    const { container } = render(<Gantt className="custom" />);
    expect(container.firstElementChild?.className).toBe('qz-gantt custom');
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

  it('reports scrolling to the engine', () => {
    const ref = createRef<GanttController>();
    const { container } = render(<Gantt ref={ref} defaultData={data} />);
    const timeline = container.querySelector('.qz-timeline__scroller') as HTMLElement;
    timeline.scrollLeft = 250;
    timeline.scrollTop = 40;
    fireEvent.scroll(timeline);
    expect(ref.current?.getState().viewport).toMatchObject({ scrollLeft: 250, scrollTop: 40 });
    // The timeline header (outside the scroll area) follows the horizontal scroll.
    expect((container.querySelector('.qz-timeline__header') as HTMLElement).scrollLeft).toBe(250);
    // The task list follows the timeline's vertical scroll...
    const list = container.querySelector('.qz-list__body') as HTMLElement;
    expect(list.scrollTop).toBe(40);
    // ...and scrolling the list (e.g. with the wheel) moves the timeline.
    list.scrollTop = 80;
    fireEvent.scroll(list);
    expect(timeline.scrollTop).toBe(80);
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
});
