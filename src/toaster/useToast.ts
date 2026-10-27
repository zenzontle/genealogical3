import { useEffect, useId, useRef } from 'react';
import { APP_REGION, AUTO_DISMISS_MS, removeToast, showToast } from './store';
import type { ToastAction, ToastState } from './store';

/**
 * Mirrors a component's operation state as one toast that lives as long as the component.
 * Pass a new state object to re-show a toast; identical objects keep timers running.
 */
export function useToast(
  state: ToastState,
  {
    action,
    onDismiss,
    region = APP_REGION,
    dismissLabel,
    autoDismissMs = AUTO_DISMISS_MS,
  }: {
    action?: ToastAction;
    onDismiss?: () => void;
    region?: string;
    dismissLabel?: string;
    autoDismissMs?: number;
  } = {},
) {
  const id = useId();
  // Callbacks are often recreated each render; read the latest ones so the toast stays put.
  const latest = useRef({ action, onDismiss });
  useEffect(() => {
    latest.current = { action, onDismiss };
  });
  const actionLabel = action?.label;

  useEffect(() => {
    if (state.status === 'idle') {
      removeToast(id);
      return;
    }
    showToast({
      id,
      region,
      status: state.status,
      message: state.message,
      dismissLabel,
      autoDismissMs,
      action:
        actionLabel === undefined
          ? undefined
          : { label: actionLabel, onClick: () => latest.current.action?.onClick() },
      onDismiss: () => latest.current.onDismiss?.(),
    });
  }, [id, state, region, actionLabel, dismissLabel, autoDismissMs]);

  useEffect(() => () => removeToast(id), [id]);
}
