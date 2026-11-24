import React, { useState, useEffect, useRef } from 'react';

export type ToastPayload =
  | { variant?: 'copied'; reference: string }
  | { variant: 'offline'; title: string; message: string };

interface CopiedToastProps {
  toast: ToastPayload | null;
  onDismiss?: () => void;
  duration?: number;
}

export const CopiedToast: React.FC<CopiedToastProps> = ({
  toast,
  onDismiss,
  duration,
}) => {
  // Pre-loaded in DOM: stores active toast payload so it never blanks during transition
  const [displayToast, setDisplayToast] = useState<ToastPayload>({
    variant: 'copied',
    reference: '',
  });
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [isBumping, setIsBumping] = useState<boolean>(false);
  const [hasEverOpened, setHasEverOpened] = useState<boolean>(false);

  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bumpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openRafRef = useRef<number | null>(null);
  const onDismissRef = useRef(onDismiss);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    const cancelPendingOpen = () => {
      if (openTimerRef.current) {
        clearTimeout(openTimerRef.current);
        openTimerRef.current = null;
      }
      if (openRafRef.current !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(openRafRef.current);
        openRafRef.current = null;
      }
    };

    if (toast) {
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
      cancelPendingOpen();

      const effectiveDuration =
        duration ?? (toast.variant === 'offline' ? 3600 : 2400);

      setDisplayToast(toast);
      setHasEverOpened(true);

      if (isOpen) {
        // If already open, trigger a tactile bump and reset auto-dismiss timer
        setIsBumping(true);
        if (bumpTimerRef.current) clearTimeout(bumpTimerRef.current);
        bumpTimerRef.current = setTimeout(() => {
          setIsBumping(false);
        }, 160);

        dismissTimerRef.current = setTimeout(() => {
          setIsOpen(false);
          setTimeout(() => {
            onDismissRef.current?.();
          }, 320);
        }, effectiveDuration);
      } else {
        // Feature-detect double requestAnimationFrame with setTimeout fallback
        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
          openRafRef.current = window.requestAnimationFrame(() => {
            openRafRef.current = window.requestAnimationFrame(() => {
              openRafRef.current = null;
              setIsOpen(true);
            });
          });
        } else {
          openTimerRef.current = setTimeout(() => {
            setIsOpen(true);
          }, 16);
        }

        dismissTimerRef.current = setTimeout(() => {
          setIsOpen(false);
          setTimeout(() => {
            onDismissRef.current?.();
          }, 320);
        }, effectiveDuration + 32);
      }
    } else {
      // Externally dismissed (e.g. Escape key pressed)
      if (isOpen) {
        setIsOpen(false);
        if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
        cancelPendingOpen();
      }
    }

    return () => {
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
      cancelPendingOpen();
      if (bumpTimerRef.current) clearTimeout(bumpTimerRef.current);
    };
  }, [toast, duration, isOpen]);

  const isOfflineVariant = displayToast.variant === 'offline';
  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Preloaded in DOM: persists across renders so browser never drops transition frames
  return (
    <div
      role="status"
      aria-live="polite"
      aria-hidden={!isOpen}
      className="fixed bottom-24 sm:bottom-28 left-1/2 z-50 select-none max-w-[90vw]"
      style={{
        transform: prefersReducedMotion
          ? 'translate3d(-50%, 0, 0)'
          : `translate3d(-50%, ${isOpen ? (isBumping ? '-4px' : '0px') : '16px'}, 0) scale(${
              isOpen ? (isBumping ? '1.04' : '1') : '0.90'
            })`,
        opacity: isOpen ? 1 : 0,
        pointerEvents: isOpen ? 'auto' : 'none',
        visibility: hasEverOpened ? 'visible' : 'hidden',
        transition: prefersReducedMotion
          ? 'opacity 160ms ease-out'
          : 'transform 320ms cubic-bezier(0.16, 1, 0.3, 1), opacity 260ms cubic-bezier(0.16, 1, 0.3, 1)',
        willChange: prefersReducedMotion ? 'opacity' : 'transform, opacity',
      }}
    >
      <div
        className="flex items-center gap-2.5 px-4 py-2.5 rounded-full font-sans text-xs tracking-normal backdrop-blur-md"
        style={{
          backgroundColor: 'var(--toast-bg)',
          color: 'var(--toast-text)',
          border: '1px solid var(--toast-border)',
        }}
      >
        {isOfflineVariant ? (
          <span
            className="w-2 h-2 rounded-full bg-yellow-400 dark:bg-yellow-500 shrink-0"
            aria-hidden="true"
          />
        ) : (
          <div
            className="w-4 h-4 rounded-full flex items-center justify-center shrink-0"
            style={{ color: 'var(--toast-icon)' }}
          >
            <svg
              className="w-3.5 h-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
        )}

        {isOfflineVariant ? (
          <span className="leading-snug" style={{ color: 'var(--toast-subtext)' }}>
            <span
              className="font-semibold"
              style={{ color: 'var(--toast-highlight)' }}
            >
              {displayToast.title}
            </span>{' '}
            {displayToast.message}
          </span>
        ) : (
          <span className="truncate" style={{ color: 'var(--toast-subtext)' }}>
            Copied{' '}
            <span
              className="font-semibold"
              style={{ color: 'var(--toast-highlight)' }}
            >
              {displayToast.reference || 'Verse'}
            </span>{' '}
            to clipboard
          </span>
        )}
      </div>
    </div>
  );
};

export default CopiedToast;
