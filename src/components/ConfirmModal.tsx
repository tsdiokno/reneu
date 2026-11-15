import React from 'react';
import { Modal } from './Modal';

export interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'neutral';
  isLoading?: boolean;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  isLoading = false,
}) => {
  const handleConfirmClick = async () => {
    await onConfirm();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={isLoading ? () => {} : onClose}
      title={title}
      maxWidthClassName="max-w-sm"
      closeLabel={cancelLabel}
    >
      <div className="px-6 sm:px-7 pb-6 pt-2 flex flex-col gap-5 font-sans">
        <p className="text-xs sm:text-sm text-[var(--text-subtle)] leading-relaxed">
          {message}
        </p>

        <div className="flex items-center justify-end gap-2.5 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="px-4 py-2 rounded-full border border-[var(--line-subtle)] text-xs font-medium text-[var(--text-subtle)] hover:text-[var(--text-primary)] hover:border-[var(--text-primary)]/40 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => void handleConfirmClick()}
            disabled={isLoading}
            className={`px-4 py-2 rounded-full text-xs font-semibold transition-all cursor-pointer active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed shadow-xs ${
              variant === 'danger'
                ? 'bg-rose-600 text-white hover:bg-rose-700 dark:bg-rose-600 dark:hover:bg-rose-500'
                : 'bg-[var(--text-primary)] text-[var(--bg-app)] hover:opacity-90'
            }`}
          >
            {isLoading ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default ConfirmModal;
