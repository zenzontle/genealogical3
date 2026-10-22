import { useContext, type ComponentProps } from 'react';
import { createPortal } from 'react-dom';
import { OperationFeedback } from './OperationFeedback';
import { ToastContainerContext } from '../lib/toaster';

export function FeedbackToast({
  withinDialog = false,
  ...props
}: Omit<ComponentProps<typeof OperationFeedback>, 'presentation' | 'autoDismissMs'> & {
  withinDialog?: boolean;
}) {
  const container = useContext(ToastContainerContext);
  const feedback = <OperationFeedback {...props} presentation="toast" autoDismissMs={5000} />;
  // Modal dialogs make the rest of the document inert, so keep their actions in the dialog.
  const stack = withinDialog ? null : container;
  return stack ? createPortal(feedback, stack) : <div className="toast-stack">{feedback}</div>;
}
