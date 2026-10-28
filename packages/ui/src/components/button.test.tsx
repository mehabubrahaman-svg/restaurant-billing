import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './button';

describe('Button', () => {
  it('defaults to a 48 px touch target that does not submit forms', () => {
    render(<Button>Pay</Button>);
    const button = screen.getByRole('button', { name: 'Pay' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button.className).toContain('min-h-touch');
  });

  it('has a 56 px KDS size', () => {
    render(<Button size="kds">Accept</Button>);
    expect(screen.getByRole('button', { name: 'Accept' }).className).toContain('min-h-kds');
  });

  it('keeps an explicit submit type', () => {
    render(<Button type="submit">Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'submit');
  });

  it('renders its child instead of a <button> with asChild', () => {
    render(
      <Button asChild variant="outline">
        <a href="/pos">Billing</a>
      </Button>,
    );
    const link = screen.getByRole('link', { name: 'Billing' });
    expect(link).toHaveAttribute('href', '/pos');
    expect(link.className).toContain('border-input');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('lets callers override classes', () => {
    render(<Button className="px-8">Wide</Button>);
    const button = screen.getByRole('button', { name: 'Wide' });
    expect(button.className).toContain('px-8');
    expect(button.className).not.toContain('px-4');
  });

  it('does not fire clicks while disabled', () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Settle
      </Button>,
    );
    screen.getByRole('button', { name: 'Settle' }).click();
    expect(onClick).not.toHaveBeenCalled();
  });
});
