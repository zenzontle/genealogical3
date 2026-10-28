export {};

// Node-environment test files have no DOM to render into, so they skip React and Testing Library.
if (typeof document !== 'undefined') {
  const { flushEffectsAfterWaits } = await import('./flushEffectsAfterWaits');
  flushEffectsAfterWaits();
}
