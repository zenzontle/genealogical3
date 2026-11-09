import { useEffect, useRef, useState } from 'react';
import type { Tree } from '../lib/model';
import { exportJson, exportPdf, exportPng } from '../lib/media';
import { afterPaint, errorMessage, type FeedbackState } from '../lib/feedback';

export type ExportFormat = 'JSON' | 'PNG' | 'PDF';

export function useTreeExport(treeId: string | undefined, getTree: () => Tree | null) {
  const [feedback, setFeedback] = useState<FeedbackState>({ status: 'idle' });
  const [kind, setKind] = useState<ExportFormat>('JSON');
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
  const run = async (format: ExportFormat) => {
    const tree = getTree();
    if (busy.current || !tree) return;
    busy.current = true;
    const token = ++request.current;
    setKind(format);
    setFeedback({ status: 'pending', message: `Preparing ${format}…` });
    try {
      await afterPaint();
      if (token !== request.current) return;
      let warning: string | undefined;
      if (format === 'JSON') exportJson(tree);
      else if (format === 'PNG') warning = await exportPng(tree);
      else await exportPdf(tree);
      if (token === request.current)
        setFeedback(
          // Info toasts stay until dismissed, so the warning can't vanish unread.
          warning
            ? { status: 'info', message: `${format} export completed. ${warning}` }
            : { status: 'success', message: `${format} export completed.` },
        );
    } catch (error) {
      if (token === request.current) setFeedback({ status: 'error', message: errorMessage(error) });
    } finally {
      if (token === request.current) busy.current = false;
    }
  };
  return { feedback, run, retry: () => run(kind), dismiss: () => setFeedback({ status: 'idle' }) };
}
