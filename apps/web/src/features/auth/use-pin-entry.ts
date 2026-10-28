import { useCallback, useState } from 'react';

/** PINs are 4 to 6 digits (contracts PinSchema). */
export const PIN_MIN = 4;
export const PIN_MAX = 6;

/** Digit-by-digit PIN state shared by the on-screen pad and the physical keyboard. */
export function usePinEntry() {
  const [pin, setPin] = useState('');

  const press = useCallback((digit: string) => {
    if (!/^\d$/.test(digit)) return;
    setPin((p) => (p.length < PIN_MAX ? p + digit : p));
  }, []);
  const backspace = useCallback(() => setPin((p) => p.slice(0, -1)), []);
  const clear = useCallback(() => setPin(''), []);

  return {
    pin,
    /** Dots to draw: four, growing to six as digits are typed. */
    length: Math.max(PIN_MIN, pin.length),
    complete: pin.length >= PIN_MIN,
    press,
    backspace,
    clear,
  };
}
