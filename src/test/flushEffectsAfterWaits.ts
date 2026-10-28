import { createRoot } from 'react-dom/client';
import { act, configure, getConfig } from '@testing-library/react';

/**
 * Make findBy* and waitFor return only after React has run its pending passive effects.
 *
 * While they poll, Testing Library turns off the act environment, so React commits through
 * its scheduler and runs passive effects in a later task. Testing Library then resolves after a
 * setTimeout(0), which under load can fire first: the DOM shows the new state while effects such
 * as listener cleanups or per-tree resets still wait, and the next interaction races them.
 * React flushes pending passive effects before any later render, so rendering a detached probe
 * root inside act drains them deterministically.
 */
export function flushEffectsAfterWaits() {
  const probe = createRoot(document.createElement('div'));
  const { asyncWrapper } = getConfig();
  configure({
    asyncWrapper: async (callback) => {
      const result = await asyncWrapper(callback);
      await act(async () => probe.render(null));
      return result;
    },
  });
}
