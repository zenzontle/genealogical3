import { CheckCircle2, CircleAlert, Info, LoaderCircle, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { Toast as ToastData } from './store';

const icons = { info: Info, pending: LoaderCircle, success: CheckCircle2, error: CircleAlert };

export function Toast({ toast, onDismiss }: { toast: ToastData; onDismiss: () => void }) {
  const container = useRef<HTMLDivElement>(null);
  const hovered = useRef(false);
  const focused = useRef(false);
  const updateTimer = useRef<(() => void) | null>(null);
  const dismiss = useRef(onDismiss);

  useEffect(() => {
    dismiss.current = onDismiss;
  }, [onDismiss]);

  // Only plain successes dismiss themselves; pending work, errors and actions wait for the user.
  useEffect(() => {
    focused.current = container.current?.contains(document.activeElement) ?? false;
    const { status, action, autoDismissMs } = toast;
    if (status !== 'success' || action || !autoDismissMs || autoDismissMs <= 0) return;

    let remaining = autoDismissMs;
    let started = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      if (hovered.current || focused.current) {
        if (timer !== undefined) {
          clearTimeout(timer);
          timer = undefined;
          remaining -= Date.now() - started;
        }
      } else if (timer === undefined) {
        started = Date.now();
        timer = setTimeout(() => dismiss.current(), remaining);
      }
    };
    updateTimer.current = update;
    update();
    return () => {
      clearTimeout(timer);
      updateTimer.current = null;
    };
  }, [toast]);

  const pending = toast.status === 'pending';
  const Icon = icons[toast.status];
  return (
    <div
      ref={container}
      className={`toast ${toast.status}`}
      aria-busy={pending}
      onMouseEnter={() => {
        hovered.current = true;
        updateTimer.current?.();
      }}
      onMouseLeave={() => {
        hovered.current = false;
        updateTimer.current?.();
      }}
      onFocus={() => {
        focused.current = true;
        updateTimer.current?.();
      }}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget)) return;
        focused.current = false;
        updateTimer.current?.();
      }}
    >
      <div className="toast-message" role={toast.status === 'error' ? 'alert' : 'status'}>
        <Icon size={17} className={pending ? 'busy-icon' : undefined} aria-hidden="true" />
        <span>{toast.message}</span>
      </div>
      {!pending && (
        <div className="toast-actions">
          {toast.action && (
            <button type="button" className="text-button" onClick={toast.action.onClick}>
              {toast.action.label}
            </button>
          )}
          <button
            type="button"
            className="icon-button"
            aria-label={toast.dismissLabel ?? 'Dismiss feedback'}
            onClick={onDismiss}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
