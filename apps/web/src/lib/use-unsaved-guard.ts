import { useCallback, useEffect, useRef } from 'react';
import { useBlocker, type Blocker } from 'react-router';

/**
 * While `dirty`, warns before the tab is closed or reloaded (browser prompt)
 * and blocks in-app navigation; `blocker.state === 'blocked'` drives our own
 * "Leave without saving?" dialog. Call `release()` right before navigating
 * away on purpose (e.g. after a successful save).
 */
export function useUnsavedGuard(dirty: boolean): { blocker: Blocker; release: () => void } {
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current) event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirtyRef.current && currentLocation.pathname !== nextLocation.pathname,
  );
  const release = useCallback(() => {
    dirtyRef.current = false;
  }, []);
  return { blocker, release };
}
