import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusPill, type ConnectionStatus } from './status-pill';

const ALL: ConnectionStatus[] = ['live', 'reconnecting', 'bluetooth', 'offline'];

describe('StatusPill', () => {
  it('is a polite live region with the status text', () => {
    render(<StatusPill status="live" label="Live" />);
    const pill = screen.getByRole('status');
    expect(pill).toHaveAttribute('aria-live', 'polite');
    expect(pill).toHaveAttribute('data-status', 'live');
    expect(pill).toHaveTextContent('Live');
  });

  it('pairs every status with its own icon and colour', () => {
    const seen = new Map<string, string>();
    for (const status of ALL) {
      const { container, unmount } = render(<StatusPill status={status} label={status} />);
      const icon = container.querySelector('svg');
      expect(icon).not.toBeNull();
      expect(icon).toHaveAttribute('aria-hidden', 'true');
      const pill = screen.getByRole('status');
      seen.set(status, `${icon?.getAttribute('class') ?? ''}|${pill.className}`);
      unmount();
    }
    expect(new Set(seen.values()).size).toBe(ALL.length);
  });

  it('shows the queued-actions detail only when given', () => {
    const { rerender } = render(<StatusPill status="offline" label="Offline" />);
    expect(screen.getByRole('status')).toHaveTextContent(/^Offline$/);
    rerender(<StatusPill status="offline" label="Offline" detail="3 actions queued" />);
    expect(screen.getByRole('status')).toHaveTextContent('Offline3 actions queued');
  });
});
