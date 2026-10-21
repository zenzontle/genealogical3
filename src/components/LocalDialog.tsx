import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function LocalDialog({
  title,
  description,
  busy,
  onClose,
  children,
  hideClose = false,
  className,
  'aria-describedby': ariaDescribedBy,
}: {
  title: string;
  description?: string;
  busy: boolean;
  onClose: () => void;
  children: ReactNode;
  hideClose?: boolean;
  className?: string;
  'aria-describedby'?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId(),
    descriptionId = useId();
  useEffect(() => {
    const dialog = dialogRef.current!;
    const opener = document.activeElement;
    dialog.showModal();
    dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => {
      dialog.close();
      const fallback = document.querySelector<HTMLElement>('[data-dialog-fallback]');
      if (
        opener instanceof HTMLElement &&
        opener.isConnected &&
        opener !== document.body &&
        opener !== document.documentElement
      )
        opener.focus();
      else fallback?.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialogRef}
      className={['modal local-dialog', className].filter(Boolean).join(' ')}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : ariaDescribedBy}
      aria-modal="true"
      aria-busy={busy}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const controls = [
          ...event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), [tabindex="0"]',
          ),
        ];
        const first = controls[0],
          last = controls.at(-1);
        if (!first) {
          event.preventDefault();
          return;
        }
        if (
          event.shiftKey &&
          (document.activeElement === first || document.activeElement === event.currentTarget)
        ) {
          event.preventDefault();
          last?.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last || document.activeElement === event.currentTarget)
        ) {
          event.preventDefault();
          first.focus();
        }
      }}
    >
      <div className="modal-heading">
        <h2 id={titleId}>{title}</h2>
        {!hideClose && (
          <button
            type="button"
            className="icon-button"
            aria-label="Close dialog"
            disabled={busy}
            onClick={onClose}
          >
            <X size={19} />
          </button>
        )}
      </div>
      {description && <p id={descriptionId}>{description}</p>}
      {children}
    </dialog>
  );
}
