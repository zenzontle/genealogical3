import { useEffect, useSyncExternalStore } from 'react';
import { driveSync } from './driveSync';

export function useDriveSync(persist: () => Promise<unknown>, onError: (error: unknown) => void) {
  const views = useSyncExternalStore(driveSync.subscribe, driveSync.snapshot);
  useEffect(() => driveSync.start(), []);
  useEffect(() => {
    const flush = () => {
      void persist()
        .catch(onError)
        .then(() => driveSync.flush())
        .catch(onError);
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      flush();
      event.preventDefault();
      event.returnValue = '';
    };
    const hide = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    if (driveSync.hasPending()) window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', hide);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', hide);
    };
  }, [views, persist, onError]);
  return views;
}
