import { useSyncExternalStore } from 'react';
import { Toast } from './Toast';
import { APP_REGION, dismissToast, getToasts, subscribeToasts } from './store';

export function Toaster({ region = APP_REGION, id }: { region?: string; id?: string }) {
  const toasts = useSyncExternalStore(subscribeToasts, getToasts);
  return (
    <div className="toast-stack" id={id}>
      {toasts
        .filter((toast) => toast.region === region)
        .map((toast) => (
          <Toast key={toast.id} toast={toast} onDismiss={() => dismissToast(toast.id)} />
        ))}
    </div>
  );
}
