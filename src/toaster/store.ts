export type ToastStatus = 'info' | 'pending' | 'success' | 'error';
export type ToastState = { status: 'idle' } | { status: ToastStatus; message: string };
export type ToastAction = { label: string; onClick: () => void };

export type Toast = {
  id: string;
  status: ToastStatus;
  message: string;
  // Toasts render in the Toaster with the same region; modal dialogs host their own.
  region: string;
  action?: ToastAction;
  // Called when the user or the auto-dismiss timer closes the toast, not when the owner removes it.
  onDismiss?: () => void;
  dismissLabel?: string;
  autoDismissMs?: number;
};

export const APP_REGION = 'app';
export const AUTO_DISMISS_MS = 5000;

let toasts: readonly Toast[] = [];
let nextId = 0;
const listeners = new Set<() => void>();

const publish = (next: readonly Toast[]) => {
  toasts = next;
  listeners.forEach((listener) => listener());
};

export const subscribeToasts = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const getToasts = () => toasts;

// Adds a toast, or replaces the toast with the same id in place so the stack keeps its order.
export function showToast({
  id = `toast-${++nextId}`,
  region = APP_REGION,
  ...toast
}: Omit<Toast, 'id' | 'region'> & { id?: string; region?: string }) {
  const next = { ...toast, id, region };
  publish(
    toasts.some((current) => current.id === id)
      ? toasts.map((current) => (current.id === id ? next : current))
      : [...toasts, next],
  );
  return id;
}

export function removeToast(id: string) {
  if (toasts.some((toast) => toast.id === id)) publish(toasts.filter((toast) => toast.id !== id));
}

export function dismissToast(id: string) {
  const toast = toasts.find((current) => current.id === id);
  if (!toast) return;
  removeToast(id);
  toast.onDismiss?.();
}
