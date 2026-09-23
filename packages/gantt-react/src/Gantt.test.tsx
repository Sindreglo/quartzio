import type { GanttController, ProjectData, ProjectInput } from '@quartzio/gantt';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createRef, useState } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Gantt } from './Gantt';

const data: ProjectInput = { tasks: [{ id: 1 }, { id: 2 }] };

describe('<Gantt />', () => {
  it('renders the root element with custom class names', () => {
    const { container } = render(<Gantt className="custom" />);
    expect(container.firstElementChild?.className).toBe('qz-gantt custom');
  });

  it('shows an empty state when there are no tasks', () => {
    render(<Gantt />);
    expect(screen.getByText('No tasks')).toBeDefined();
  });

  it('exposes the controller through ref', () => {
    const ref = createRef<GanttController>();
    render(<Gantt ref={ref} defaultData={data} />);
    expect(ref.current?.getState().project.tasks.order).toEqual([1, 2]);
  });

  it('applies edits directly when uncontrolled', () => {
    const ref = createRef<GanttController>();
    const onChange = vi.fn();
    render(<Gantt ref={ref} defaultData={data} onChange={onChange} />);

    act(() => {
      ref.current?.transact((tx) => tx.tasks.add({ id: 3 }));
    });

    expect(screen.getByText('3 tasks')).toBeDefined();
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
    render(<Controlled />);

    act(() => {
      ref.current?.transact((tx) => tx.tasks.add({ id: 3 }));
    });
    expect(screen.getByText('2 tasks')).toBeDefined();

    accept = true;
    await act(async () => {
      await Promise.resolve(); // a separate user event
      ref.current?.transact((tx) => tx.tasks.add({ id: 3 }));
    });
    expect(screen.getByText('3 tasks')).toBeDefined();
  });

  it('shows data that arrives after mount (data={undefined} while loading)', () => {
    const onChange = vi.fn();
    const { rerender } = render(<Gantt data={undefined} onChange={onChange} />);
    expect(screen.getByText('No tasks')).toBeDefined();

    rerender(<Gantt data={data} onChange={onChange} />);
    expect(screen.getByText('2 tasks')).toBeDefined();
  });

  it('renders on the server', () => {
    const html = renderToString(<Gantt defaultData={data} />);
    expect(html).toContain('2 tasks');
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
    const timeline = container.querySelector('.qz-timeline') as HTMLElement;
    timeline.scrollLeft = 250;
    fireEvent.scroll(timeline);
    expect(ref.current?.getState().viewport.scrollLeft).toBe(250);
  });
});
