import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Dialog } from './dialog';

function Harness({ dismissible = true }: { dismissible?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Reset PIN"
        closeLabel="Close"
        dismissible={dismissible}
        footer={<button>Save</button>}
      >
        <input aria-label="New PIN" />
      </Dialog>
    </>
  );
}

describe('Dialog', () => {
  it('is a labelled modal that focuses its first field', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('Open'));
    const dialog = screen.getByRole('dialog', { name: 'Reset PIN' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByLabelText('New PIN')).toHaveFocus();
  });

  it('closes on Esc and returns focus to the opener', () => {
    render(<Harness />);
    const opener = screen.getByText('Open');
    opener.focus();
    fireEvent.click(opener);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('keeps Tab inside the dialog', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('Open'));
    const save = screen.getByText('Save');
    save.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(save).toHaveFocus();
  });

  it('ignores Esc while not dismissible', () => {
    render(<Harness dismissible={false} />);
    fireEvent.click(screen.getByText('Open'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
