import { useEffect, useState } from 'react';

/**
 * The value, but only after it has stopped changing for `delayMs`.
 *
 * Used to keep a per-keystroke input from firing a request (or an expensive derivation) on every
 * character. Returns the initial value immediately, so the first render is not blank.
 */
export function useDebouncedValue<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

export default useDebouncedValue;
