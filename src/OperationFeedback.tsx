import { CheckCircle2, CircleAlert, LoaderCircle, X } from 'lucide-react';
import type { FeedbackState } from './feedback';

export function OperationFeedback({
  state,
  action,
  onDismiss,
}: {
  state: FeedbackState;
  action?: { label: string; onClick: () => void };
  onDismiss: () => void;
}) {
  if (state.status === 'idle') return null;
  const pending = state.status === 'pending';
  const Icon = pending ? LoaderCircle : state.status === 'error' ? CircleAlert : CheckCircle2;
  return (
    <div className={`operation-feedback ${state.status}`} aria-busy={pending}>
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
