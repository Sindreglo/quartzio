import type { GanttController, ProjectData, ProjectInput } from '@quartzio/gantt';
import { act, render, screen } from '@testing-library/react';
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
    expect(renderToString(<Gantt defaultData={data} />)).toContain('2 tasks');
  });
});
