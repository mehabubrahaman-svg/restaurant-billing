import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { SegmentedControl, type SegmentedOption } from './segmented-control';

type Lang = 'en' | 'hi' | 'bn';
const OPTIONS: SegmentedOption<Lang>[] = [
  { value: 'en', label: 'EN', ariaLabel: 'English', lang: 'en' },
  { value: 'hi', label: 'हि', ariaLabel: 'हिन्दी', lang: 'hi' },
  { value: 'bn', label: 'বা', ariaLabel: 'বাংলা', lang: 'bn' },
];

function Harness({ dir }: { dir?: 'rtl' }) {
  const [value, setValue] = useState<Lang>('en');
  return (
    <div dir={dir}>
      <SegmentedControl
        aria-label="Language"
        options={OPTIONS}
        value={value}
        onValueChange={setValue}
      />
    </div>
  );
}

const checked = () => screen.getByRole('radio', { checked: true });

describe('SegmentedControl', () => {
  it('exposes radio semantics with accessible names', () => {
    render(<Harness />);
    expect(screen.getByRole('radiogroup', { name: 'Language' })).toBeInTheDocument();
    expect(checked()).toHaveAccessibleName('English');
    expect(screen.getByRole('radio', { name: 'हिन्दी' })).toHaveAttribute('lang', 'hi');
  });

  it('selects on click', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('radio', { name: 'বাংলা' }));
    expect(checked()).toHaveAccessibleName('বাংলা');
  });

  it('uses a roving tab index', () => {
    render(<Harness />);
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1, -1]);
  });

  it('moves with arrow keys, wraps, and supports Home/End', () => {
    render(<Harness />);
    const group = screen.getByRole('radiogroup');
    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(checked()).toHaveAccessibleName('हिन्दी');
    expect(document.activeElement).toBe(checked());
    fireEvent.keyDown(group, { key: 'End' });
    expect(checked()).toHaveAccessibleName('বাংলা');
    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(checked()).toHaveAccessibleName('English');
    fireEvent.keyDown(group, { key: 'ArrowLeft' });
    expect(checked()).toHaveAccessibleName('বাংলা');
    fireEvent.keyDown(group, { key: 'Home' });
    expect(checked()).toHaveAccessibleName('English');
  });

  it('mirrors left/right in RTL layouts', () => {
    render(<Harness dir="rtl" />);
    fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'ArrowLeft' });
    expect(checked()).toHaveAccessibleName('हिन्दी');
  });
});
