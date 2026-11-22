import { useState, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

interface UseAutoHideHeaderOptions {
  /** Ref to the sticky/fixed header element whose height is measured for offset sync */
  headerRef: RefObject<HTMLElement | null>;
  /** Whether scroll tracking is active (set false when the view is unmounted/inactive) */
  enabled?: boolean;
  /** Forces the header to stay visible (e.g. while an omnibar dropdown is open) */
  forceVisible?: boolean;
  /** Resets direction tracking and reveals the header when switching views or chapters */
  resetKey?: string | number;
  /** Optional ref to a wrapper element that receives `--omni-h: <height>px` */
  cssVarTargetRef?: RefObject<HTMLElement | null>;
  /** CSS custom property name to sync measured header height to */
  cssVarName?: string;
  /** Minimum upward scroll pixels required to reveal the header (default 12) */
  showUpDelta?: number;
  /** Whether to track header height with ResizeObserver (default true) */
  measureHeight?: boolean;
}

interface UseAutoHideHeaderResult {
  isVisible: boolean;
  isScrolledPastTop: boolean;
  headerHeight: number;
}

const TOP_SHOW_THRESHOLD_Y = 16;
const HIDE_AFTER_Y = 72;
const HIDE_DOWN_DELTA = 10;
const DEFAULT_SHOW_UP_DELTA = 12;

/**
 * Shared scroll-direction hook for sticky slide-down omnibars:
 * hides on deliberate downward scroll, reveals via fixed slide-down on upward scroll or near top.
 */
export function useAutoHideHeader({
  headerRef,
  enabled = true,
  forceVisible = false,
  resetKey,
  cssVarTargetRef,
  cssVarName = '--omni-h',
  showUpDelta = DEFAULT_SHOW_UP_DELTA,
  measureHeight = true,
}: UseAutoHideHeaderOptions): UseAutoHideHeaderResult {
  const [isVisible, setIsVisible] = useState(true);
  const [isScrolledPastTop, setIsScrolledPastTop] = useState(false);
  const [headerHeight, setHeaderHeight] = useState(72);

  const lastYRef = useRef(0);
  const anchorYRef = useRef(0);
  const directionRef = useRef<'up' | 'down' | null>(null);
  const forceVisibleRef = useRef(forceVisible);
  forceVisibleRef.current = forceVisible;

  // Measure header height cleanly and sync optional CSS variable without JSX inline styles
  useLayoutEffect(() => {
    if (!enabled || !measureHeight) return;
    const el = headerRef.current;
    if (!el) return;

    const updateHeight = () => {
      const nextHeight = Math.round(el.offsetHeight);
      if (nextHeight > 0) {
        setHeaderHeight((prev) => (prev !== nextHeight ? nextHeight : prev));
        cssVarTargetRef?.current?.style.setProperty(cssVarName, `${nextHeight}px`);
      }
    };

    updateHeight();

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(updateHeight);
      ro.observe(el);
      return () => ro.disconnect();
    }

    window.addEventListener('resize', updateHeight, { passive: true });
    return () => window.removeEventListener('resize', updateHeight);
  }, [enabled, measureHeight, headerRef, cssVarTargetRef, cssVarName, resetKey]);

  // Reset visibility cleanly on view/chapter change
  useEffect(() => {
    if (!enabled) return;
    const maxScroll = Math.max(
      0,
      document.documentElement.scrollHeight - window.innerHeight
    );
    const currentY = Math.round(Math.max(0, Math.min(window.scrollY || 0, maxScroll)));
    lastYRef.current = currentY;
    anchorYRef.current = currentY;
    directionRef.current = null;
    setIsVisible(true);
    setIsScrolledPastTop(currentY > TOP_SHOW_THRESHOLD_Y);
  }, [enabled, resetKey]);

  // Force visible when dropdown/interaction requires it
  useEffect(() => {
    if (enabled && forceVisible) {
      setIsVisible(true);
    }
  }, [enabled, forceVisible]);

  // Track window scroll direction with iOS rubber-band bounce clamping and hysteresis
  useEffect(() => {
    if (!enabled) return;

    let ticking = false;

    const evaluateScroll = () => {
      ticking = false;
      const maxScroll = Math.max(
        0,
        document.documentElement.scrollHeight - window.innerHeight
      );
      const rawY = window.scrollY || 0;
      const currentY = Math.round(Math.max(0, Math.min(rawY, maxScroll)));

      setIsScrolledPastTop((prev) => {
        const next = currentY > TOP_SHOW_THRESHOLD_Y;
        return prev !== next ? next : prev;
      });

      if (forceVisibleRef.current || maxScroll <= HIDE_AFTER_Y + 24 || currentY <= TOP_SHOW_THRESHOLD_Y) {
        lastYRef.current = currentY;
        anchorYRef.current = currentY;
        directionRef.current = null;
        setIsVisible((prev) => (prev ? prev : true));
        return;
      }

      const delta = currentY - lastYRef.current;
      if (delta === 0) return;

      if (delta > 0) {
        if (directionRef.current !== 'down') {
          directionRef.current = 'down';
          anchorYRef.current = lastYRef.current;
        }
        if (currentY > HIDE_AFTER_Y && currentY - anchorYRef.current >= HIDE_DOWN_DELTA) {
          setIsVisible((prev) => (prev ? false : prev));
        }
      } else {
        if (directionRef.current !== 'up') {
          directionRef.current = 'up';
          anchorYRef.current = lastYRef.current;
        }
        if (anchorYRef.current - currentY >= showUpDelta) {
          setIsVisible((prev) => (prev ? prev : true));
        }
      }

      lastYRef.current = currentY;
    };

    const handleScroll = () => {
      if (!ticking) {
        ticking = true;
        window.requestAnimationFrame(evaluateScroll);
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [enabled, showUpDelta]);

  return { isVisible, isScrolledPastTop, headerHeight };
}
