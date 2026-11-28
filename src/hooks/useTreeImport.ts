import { useRef, useState } from 'react';
import { decodeGedcom, gedcomToTree, looksLikeGedcom } from '../lib/gedcom';
import { uid, validateTree, type Tree } from '../lib/model';
import { saveTree } from '../lib/storage';
import { afterPaint, errorMessage, type FeedbackState } from '../lib/feedback';

export function useTreeImport(onSaved: (tree: Tree) => void, onRefresh: () => Promise<void>) {
  const [feedback, setFeedback] = useState<FeedbackState>({ status: 'idle' });
  const [canRetry, setCanRetry] = useState(false);
  const [importedId, setImportedId] = useState<string | null>(null);
  const attempt = useRef<{
    file: File;
    copy?: Tree;
    warnings?: string[];
    saved: boolean;
  } | null>(null);
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
        if (current.file.size > 30_000_000) throw Error('Choose a file smaller than 30 MB.');
        await stage('Reading file…');
        valid = true;
        const { name } = current.file;
        // Files can lose their extension on the way, so anything but JSON is also sniffed.
        const bytes = /\.json$/i.test(name)
          ? undefined
          : new Uint8Array(await current.file.arrayBuffer());
        const gedcom = !!bytes && (/\.ged(com)?$/i.test(name) || looksLikeGedcom(bytes));
        const content = !bytes
          ? await current.file.text()
          : gedcom
            ? decodeGedcom(bytes)
            : new TextDecoder().decode(bytes);
        await stage(gedcom ? 'Converting GEDCOM…' : 'Validating tree…');
        valid = false;
        const now = Date.now();
        if (gedcom) {
          const { tree, warnings } = gedcomToTree(content, fileTitle(current.file.name));
          current.copy = { ...tree, updatedAt: now, dataUpdatedAt: now };
          current.warnings = warnings;
        } else {
          const imported = validateTree(JSON.parse(content));
          current.copy = {
            ...imported,
            id: uid(),
            name: `${imported.name} (imported)`,
            updatedAt: now,
            dataUpdatedAt: now,
          };
        }
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
      const { name, people, relations } = current.copy;
      const warnings = current.warnings ?? [];
      const summary = current.warnings
        ? ` with ${plural(people.length, 'person', 'people')} and ${plural(relations.length, 'relationship', 'relationships')}`
        : '';
      // Info toasts stay until dismissed, so a note of what was left out can't vanish unread.
      setFeedback({
        status: warnings.length ? 'info' : 'success',
        message: [`Imported ${name}${summary}.`, ...warnings].join(' '),
      });
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

const fileTitle = (name: string) => name.replace(/\.ged(com)?$/i, '').trim() || 'Imported tree';
const plural = (count: number, one: string, many: string) =>
  `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;
