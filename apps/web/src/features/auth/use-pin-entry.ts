import { useCallback, useState } from 'react';

export const PIN_LENGTH = 4;

/** Digit-by-digit PIN state shared by the on-screen pad and the physical keyboard. */
export function usePinEntry(length = PIN_LENGTH) {
  const [pin, setPin] = useState('');

  const press = useCallback(
    (digit: string) => {
      if (!/^\d$/.test(digit)) return;
      setPin((p) => (p.length < length ? p + digit : p));
    },
    [length],
  );
  const backspace = useCallback(() => setPin((p) => p.slice(0, -1)), []);
  const clear = useCallback(() => setPin(''), []);

  return { pin, length, complete: pin.length === length, press, backspace, clear };
}
