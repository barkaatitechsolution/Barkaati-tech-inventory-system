import { useEffect, useState } from "react";

export function useDebounced(value, delay = 200) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export function useDebouncedState(initial, delay = 200) {
  const [value, setValue] = useState(initial);
  return [value, setValue, useDebounced(value, delay)];
}
