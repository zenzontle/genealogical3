export type FeedbackState =
  { status: 'idle' } | { status: 'pending' | 'success' | 'error'; message: string };

export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong. Please try again.';

// Two frames allow pending feedback to paint before synchronous file preparation.
export const afterPaint = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
