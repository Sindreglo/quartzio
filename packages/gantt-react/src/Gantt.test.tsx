import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Gantt } from './Gantt';

describe('<Gantt />', () => {
  it('renders the root element with custom class names', () => {
    const { container } = render(<Gantt className="custom" />);
    expect(container.firstElementChild?.className).toBe('qz-gantt custom');
  });

  it('shows an empty state when there are no tasks', () => {
    render(<Gantt />);
    expect(screen.getByText('No tasks')).toBeDefined();
  });
});
