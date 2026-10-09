import { useEffect, useRef, useState } from 'react';
import type { Tree } from './model';
import { exportJson, exportPng } from './media';
import { afterPaint, errorMessage, type FeedbackState } from './feedback';

export function useTreeExport(treeId: string | undefined, getTree: () => Tree | null) {
  const [feedback, setFeedback] = useState<FeedbackState>({ status: 'idle' });
  const [kind, setKind] = useState<'JSON' | 'PNG'>('JSON');
  const request = useRef(0),
    busy = useRef(false);
  useEffect(() => {
    const counter = request;
    counter.current++;
    busy.current = false;
    setFeedback({ status: 'idle' });
    return () => {
      counter.current++;
    };
  }, [treeId]);
  const run = async (format: 'JSON' | 'PNG') => {
    const tree = getTree();
    if (busy.current || !tree) return;
    busy.current = true;
    const token = ++request.current;
    setKind(format);
    setFeedback({ status: 'pending', message: `Preparing ${format}…` });
    try {
      await afterPaint();
      if (token !== request.current) return;
      if (format === 'JSON') exportJson(tree);
      else await exportPng(tree);
      if (token === request.current)
        setFeedback({ status: 'success', message: `${format} download started.` });
    } catch (error) {
      if (token === request.current) setFeedback({ status: 'error', message: errorMessage(error) });
    } finally {
      if (token === request.current) busy.current = false;
    }
  };
  return { feedback, run, retry: () => run(kind), dismiss: () => setFeedback({ status: 'idle' }) };
}
