import { CheckCircle2, CircleAlert, LoaderCircle, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { FeedbackState } from './feedback';

export function OperationFeedback({
  state,
  action,
  onDismiss,
  presentation = 'inline',
  autoDismissMs,
}: {
  state: FeedbackState;
  action?: { label: string; onClick: () => void };
  onDismiss: () => void;
  presentation?: 'inline' | 'toast';
  autoDismissMs?: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const hovered = useRef(false);
  const focused = useRef(false);
  const updateTimer = useRef<(() => void) | null>(null);
  const dismiss = useRef(onDismiss);
  const actionable = !!action;

  useEffect(() => {
    dismiss.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (state.status === 'idle') hovered.current = false;
    focused.current = container.current?.contains(document.activeElement) ?? false;
    if (
      presentation !== 'toast' ||
      state.status !== 'success' ||
      actionable ||
      !autoDismissMs ||
      autoDismissMs <= 0
    )
      return;

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
  }, [state, presentation, autoDismissMs, actionable]);

  if (state.status === 'idle') return null;
  const pending = state.status === 'pending';
  const Icon = pending ? LoaderCircle : state.status === 'error' ? CircleAlert : CheckCircle2;
  return (
    <div
      ref={container}
      className={presentation === 'toast' ? 'toast' : `operation-feedback ${state.status}`}
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
      <div className="operation-message" role={state.status === 'error' ? 'alert' : 'status'}>
        <Icon size={17} className={pending ? 'busy-icon' : undefined} aria-hidden="true" />
        <span>{state.message}</span>
      </div>
      {!pending && (
        <div className="operation-actions">
          {action && (
            <button type="button" className="text-button" onClick={action.onClick}>
              {action.label}
            </button>
          )}
          <button
            type="button"
            className="icon-button"
            aria-label="Dismiss feedback"
            onClick={onDismiss}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
