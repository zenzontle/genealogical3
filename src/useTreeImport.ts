import { useRef, useState } from 'react';
import { uid, validateTree, type Tree } from './model';
import { saveTree } from './storage';
import { afterPaint, errorMessage, type FeedbackState } from './feedback';

export function useTreeImport(onSaved: (tree: Tree) => void, onRefresh: () => Promise<void>) {
  const [feedback, setFeedback] = useState<FeedbackState>({ status: 'idle' });
  const [canRetry, setCanRetry] = useState(false);
  const [importedId, setImportedId] = useState<string | null>(null);
  const attempt = useRef<{ file: File; copy?: Tree; saved: boolean } | null>(null);
  const busy = useRef(false);
  const run = async (file?: File) => {
    if (busy.current) return;
    if (file) attempt.current = { file, saved: false };
    const current = attempt.current;
    if (!current) return;
    busy.current = true;
    setImportedId(null);
    setCanRetry(false);
    let valid = !!current.copy;
    const stage = async (message: string) => {
      setFeedback({ status: 'pending', message });
      await afterPaint();
    };
    try {
      if (!current.copy) {
        if (current.file.size > 30_000_000) throw Error('Choose a JSON file smaller than 30 MB.');
        await stage('Reading file…');
        valid = true;
        const text = await current.file.text();
        await stage('Validating tree…');
        valid = false;
        const imported = validateTree(JSON.parse(text));
        current.copy = {
          ...imported,
          id: uid(),
          name: `${imported.name} (imported)`,
          updatedAt: Date.now(),
        };
        valid = true;
      }
      if (!current.saved) {
        await stage('Saving tree…');
        await saveTree(current.copy);
        current.saved = true;
        onSaved(current.copy);
      }
      await stage('Refreshing library…');
      await onRefresh();
      setImportedId(current.copy.id);
      setFeedback({ status: 'success', message: `Imported ${current.copy.name}.` });
      attempt.current = null;
    } catch (error) {
      setFeedback({ status: 'error', message: errorMessage(error) });
      setCanRetry(valid);
      if (!valid) attempt.current = null;
    } finally {
      busy.current = false;
    }
  };
  const dismiss = () => {
    attempt.current = null;
    setImportedId(null);
    setFeedback({ status: 'idle' });
  };
  return { feedback, canRetry, importedId, run, dismiss };
}
