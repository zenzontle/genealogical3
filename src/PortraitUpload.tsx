import { useEffect, useRef, useState } from 'react';
import { Eye, ImagePlus } from 'lucide-react';
import type { Person } from './model';
import { portraitData } from './media';
import { OperationFeedback } from './OperationFeedback';
import { LocalDialog } from './LocalDialog';
import { afterPaint, errorMessage, type FeedbackState } from './feedback';

export function PortraitUpload({
  person,
  onChange,
}: {
  person: Person;
  onChange: (portrait: string | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const file = useRef<File | null>(null);
  const request = useRef(0),
    busy = useRef(false);
  const [feedback, setFeedback] = useState<FeedbackState>({ status: 'idle' });
  const [canRetry, setCanRetry] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  useEffect(() => {
    const counter = request;
    counter.current++;
    busy.current = false;
    file.current = null;
    setFeedback({ status: 'idle' });
    setCanRetry(false);
    setViewerOpen(false);
    return () => {
      counter.current++;
    };
  }, [person.id]);
  const process = async (selected: File) => {
    if (busy.current) return;
    busy.current = true;
    file.current = selected;
    const token = ++request.current;
    const valid =
      ['image/jpeg', 'image/png', 'image/webp'].includes(selected.type) &&
      selected.size <= 20_000_000;
    setCanRetry(valid);
    setFeedback({ status: 'pending', message: 'Processing photo…' });
    try {
      await afterPaint();
      if (token !== request.current) return;
      const portrait = await portraitData(selected);
      if (token !== request.current) return;
      onChange(portrait);
      file.current = null;
      setFeedback({ status: 'success', message: 'Photo updated.' });
    } catch (error) {
      if (token !== request.current) return;
      if (!valid) file.current = null;
      setFeedback({ status: 'error', message: errorMessage(error) });
    } finally {
      if (token === request.current) busy.current = false;
    }
  };
  const dismiss = () => {
    file.current = null;
    setFeedback({ status: 'idle' });
  };
  const picker = (
    <input
      ref={input}
      className="sr-only"
      tabIndex={-1}
      type="file"
      accept="image/jpeg,image/png,image/webp"
      aria-label="Choose portrait"
      disabled={feedback.status === 'pending'}
      onChange={(event) => {
        const selected = event.target.files?.[0];
        event.currentTarget.value = '';
        if (selected) void process(selected);
      }}
    />
  );
  const status = (
    <OperationFeedback
      state={feedback}
      onDismiss={dismiss}
      action={
        feedback.status === 'error'
          ? {
              label: canRetry ? 'Retry' : 'Choose another photo',
              onClick: () =>
                canRetry && file.current ? void process(file.current) : input.current?.click(),
            }
          : undefined
      }
    />
  );
  return (
    <div className="portrait-upload">
      <button
        type="button"
        className="portrait-preview"
        disabled={!person.portrait && feedback.status === 'pending'}
        aria-label={person.portrait ? 'View photo' : 'Add photo'}
        title={person.portrait ? 'View photo' : 'Add photo'}
        onClick={() => (person.portrait ? setViewerOpen(true) : input.current?.click())}
      >
        {person.portrait ? (
          <img src={person.portrait} alt="Portrait" />
        ) : (
          <span>{(person.name[0] || '?').toUpperCase()}</span>
        )}
        <span className="portrait-upload-icon">
          {person.portrait ? <Eye size={16} /> : <ImagePlus size={16} />}
        </span>
      </button>
      <div className="portrait-upload-details">
        <p className="tiny">JPEG, PNG or WebP · processed locally</p>
        {!viewerOpen && picker}
        {!viewerOpen && status}
      </div>
      {viewerOpen && person.portrait && (
        <LocalDialog
          className="portrait-viewer"
          title={`Photo of ${person.name || 'Unnamed person'}`}
          description="JPEG, PNG or WebP · processed locally"
          busy={false}
          onClose={() => setViewerOpen(false)}
        >
          <img
            className="portrait-viewer-image"
            src={person.portrait}
            alt={`Photo of ${person.name || 'Unnamed person'}`}
          />
          {picker}
          <div className="dialog-actions">
            <button
              type="button"
              className="button"
              data-autofocus
              disabled={feedback.status === 'pending'}
              onClick={() => input.current?.click()}
            >
              Change photo
            </button>
            <button
              type="button"
              className="button danger"
              onClick={() => {
                request.current++;
                busy.current = false;
                dismiss();
                setViewerOpen(false);
                onChange(null);
              }}
            >
              Remove photo
            </button>
          </div>
          {status}
        </LocalDialog>
      )}
    </div>
  );
}
