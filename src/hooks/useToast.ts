import { useCallback, useState } from 'react';
import type { FeedbackState } from '../lib/feedback';

/** A replaceable notification; a fresh state restarts timing even for repeated messages. */
export function useToast() {
  const [feedback, setFeedback] = useState<FeedbackState>({ status: 'idle' });
  const notify = useCallback(
    (message: string, status: Exclude<FeedbackState['status'], 'idle'> = 'success') => {
      setFeedback({ status, message });
    },
    [],
  );
  const dismiss = useCallback(() => setFeedback({ status: 'idle' }), []);
  return { feedback, notify, dismiss };
}
