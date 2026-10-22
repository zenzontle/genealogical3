import { useState, type ReactNode } from 'react';
import { ToastContainerContext } from '../lib/toaster';

/** Shares a toast stack with descendants. Dialog toasts keep their own local stack. */
export function Toaster({ children }: { children: ReactNode }) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  return (
    <ToastContainerContext.Provider value={container}>
      {children}
      <div className="toast-stack" id="operation-toasts" ref={setContainer} />
    </ToastContainerContext.Provider>
  );
}
