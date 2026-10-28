import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Checkbox } from './checkbox';
import { Field } from './field';
import { Input } from './input';
import { Switch } from './switch';

describe('Field', () => {
  it('labels the control and links hint and error', () => {
    render(
      <Field label="GSTIN" hint="15 characters" error="Does not match the state">
        {(p) => <Input {...p} />}
      </Field>,
    );
    const input = screen.getByLabelText('GSTIN');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('15 characters Does not match the state');
  });

  it('is valid and undescribed without hint or error', () => {
    render(<Field label="Name">{(p) => <Input {...p} />}</Field>);
    const input = screen.getByLabelText('Name');
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(input).not.toHaveAttribute('aria-describedby');
  });

  it('marks required fields', () => {
    render(
      <Field label="Username" required>
        {(p) => <Input {...p} />}
      </Field>,
    );
    expect(screen.getByLabelText(/Username/)).toBeRequired();
  });
});

describe('Switch', () => {
  function Harness({ disabled = false }: { disabled?: boolean }) {
    const [on, setOn] = useState(false);
    return <Switch label="Liquor" checked={on} onCheckedChange={setOn} disabled={disabled} />;
  }

  it('toggles with its accessible name', () => {
    render(<Harness />);
    const toggle = screen.getByRole('switch', { name: 'Liquor' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  it('does nothing while disabled', () => {
    render(<Harness disabled />);
    const toggle = screen.getByRole('switch', { name: 'Liquor' });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });
});

describe('Checkbox', () => {
  it('reflects the indeterminate state on the native input', () => {
    render(<Checkbox label="All billing" indeterminate readOnly checked={false} />);
    const box = screen.getByRole<HTMLInputElement>('checkbox', { name: 'All billing' });
    expect(box.indeterminate).toBe(true);
  });
});
