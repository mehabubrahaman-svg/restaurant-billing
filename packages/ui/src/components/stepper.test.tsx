import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Stepper } from './stepper';

describe('Stepper', () => {
  it('steps within min and max with named buttons', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <Stepper value={1} onValueChange={onChange} decrementLabel="Less" incrementLabel="More" />,
    );
    expect(screen.getByRole('button', { name: 'Less' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(onChange).toHaveBeenLastCalledWith(2);

    rerender(
      <Stepper
        value={3}
        max={3}
        onValueChange={onChange}
        decrementLabel="Less"
        incrementLabel="More"
      />,
    );
    expect(screen.getByRole('button', { name: 'More' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Less' }));
    expect(onChange).toHaveBeenLastCalledWith(2);
  });

  it('lets − reach 0 when min is 0, and shows the formatted display', () => {
    const onChange = vi.fn();
    render(
      <Stepper
        value={1}
        min={0}
        display="१"
        onValueChange={onChange}
        decrementLabel="Less"
        incrementLabel="More"
      />,
    );
    expect(screen.getByText('१')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Less' }));
    expect(onChange).toHaveBeenLastCalledWith(0);
  });
});
