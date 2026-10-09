import { useEffect, useRef, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import type { Person } from './model';
import { portraitData } from './media';
import { OperationFeedback } from './OperationFeedback';
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
  useEffect(() => {
    const counter = request;
    counter.current++;
    busy.current = false;
    file.current = null;
    setFeedback({ status: 'idle' });
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
  return (
    <div className="portrait-upload">
      <button
        type="button"
        className="portrait-preview"
        disabled={feedback.status === 'pending'}
        aria-label={person.portrait ? 'Change photo' : 'Add photo'}
        title={person.portrait ? 'Change photo' : 'Add photo'}
        onClick={() => input.current?.click()}
      >
        {person.portrait ? (
          <img src={person.portrait} alt="Portrait" />
        ) : (
          <span>{(person.name[0] || '?').toUpperCase()}</span>
        )}
        <span className="portrait-upload-icon">
          <ImagePlus size={16} />
        </span>
      </button>
      <div className="portrait-upload-details">
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
        <p className="tiny">JPEG, PNG or WebP · processed locally</p>
        {person.portrait && (
          <button
            type="button"
            className="text-button"
            onClick={() => {
              request.current++;
              busy.current = false;
              dismiss();
              onChange(null);
            }}
          >
            Remove photo
          </button>
        )}
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
      </div>
    </div>
  );
}
