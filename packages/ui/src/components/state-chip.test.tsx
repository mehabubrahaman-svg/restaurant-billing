import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CHIP_LOOKS, StateChip, type ChipState } from './state-chip';

describe('StateChip', () => {
  it('renders the label, state and tone', () => {
    render(<StateChip state="occupied" label="Occupied" meta="32 min" />);
    const chip = screen.getByText('Occupied').parentElement;
    expect(chip).toHaveAttribute('data-state', 'occupied');
    expect(chip).toHaveAttribute('data-tone', 'occupied');
    expect(chip).toHaveTextContent('Occupied32 min');
  });

  it('gives every state a distinct icon, so colour is never the only cue', () => {
    const icons = Object.values(CHIP_LOOKS).map((look) => look.icon);
    expect(new Set(icons).size).toBe(icons.length);
  });

  it('maps delayed KOTs to the danger tone', () => {
    render(<StateChip state="delayed" label="Delayed" />);
    expect(screen.getByText('Delayed').parentElement).toHaveAttribute('data-tone', 'danger');
  });

  it('renders every state without throwing', () => {
    for (const state of Object.keys(CHIP_LOOKS) as ChipState[]) {
      const { unmount } = render(<StateChip state={state} label={state} />);
      expect(screen.getByText(state)).toBeInTheDocument();
      unmount();
    }
  });
});
