import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, Suspense, lazy } from 'react';
import { getBookById, CANONICAL_BOOKS, getBookAbbreviation } from './data/canonicalBooks';
import { getChapterVerseCount } from './data/canonicalVerseCounts';
import { fetchChapterData } from './data/netBibleCorpus';
import {
  getReadingPosition,
  saveReadingPosition,
  getTheme,
  saveTheme,
  getAppearanceSettings,
  saveAppearanceSettings,
  DEFAULT_APPEARANCE,
  getNotesByChapter,
  addOrUpdateNote,
  softDeleteNote,
  recordNewNoteMadeForSynthesis,
  getInitialExposedNotesSync,
  getExposedNotes,
  saveExposedNotes,
  ensureNotesInitialized,
  THEME_STORAGE_KEY,
  APPEARANCE_STORAGE_KEY,
  type ReadingPosition,
} from './services/bibleStorage';
import type {
  CommentaryNote,
  ThemeMode,
  AppearanceSettings,
  VerseToken,
  ChapterData,
} from './types/bible';
import type {
  PlanReadingSession,
  PlanDaySchedule,
  ReadingPlan,
  PlanAssignedChapter,
} from './types/readingPlan';
import { getAssignedChaptersForDay } from './services/readingPlanEngine';
import {
  setDayCompletionState,
  ensurePlansInitialized,
  getAllReadingPlans,
} from './services/readingPlanStorage';
import {
  parseOmnibarAction,
  parseScriptureReference,
  formatNavigationLabel,
  getOmnibarSuggestions,
  type OmnibarSuggestion,
} from './utils/referenceParser';
import { VerseRow } from './components/VerseRow';
import { CopiedToast, type ToastPayload } from './components/CopiedToast';
import { checkSimulateSplash, checkSimulateLoginSplash } from './utils/devSimulation';
import { useAutoHideHeader } from './utils/useAutoHideHeader';
import { useOnlineStatus } from './utils/useOnlineStatus';
import { usePWAInstall } from './utils/usePWAInstall';
import { ensureFullNetBibleCached, refreshOfflineBibleProgress } from './services/offlineBibleCache';
import { getCurrentUser, onAuthStateChange, syncAllWithCloud, type SupabaseUserProfile } from './services/bibleStorage';
import { NotesViewSkeleton } from './components/NotesViewSkeleton';
import { SettingsViewSkeleton } from './components/SettingsViewSkeleton';
import { ReaderViewSkeleton } from './components/ReaderViewSkeleton';
import { ReadingPlansViewSkeleton } from './components/ReadingPlansViewSkeleton';
import { SplashInstallBanner } from './components/SplashInstallBanner';
import { AboutModal } from './components/AboutModal';
import { ConfirmModal } from './components/ConfirmModal';

const AllNotesView = lazy(() => import('./components/AllNotesView'));
const ReadingPlansView = lazy(() => import('./components/ReadingPlansView'));
const SettingsView = lazy(() => import('./components/SettingsView'));
const LoginSplash = lazy(() => import('./components/LoginSplash').then((m) => ({ default: m.LoginSplash })));

const ViewLoadingFallback: React.FC<{ label?: string }> = ({ label = 'Loading...' }) => (
  <div className="flex items-center justify-center min-h-96 select-none animate-fade-in" role="status">
    <span className="text-sm font-sans tracking-widest text-[var(--text-subtle)] uppercase">
      {label}
    </span>
  </div>
);

// Navigation History Best Practices: 50-entry max stack depth with session storage persistence
const MAX_HISTORY_LENGTH = 50;
const SESSION_HISTORY_STACK_KEY = 'reneu_nav_history_stack';
const SESSION_HISTORY_INDEX_KEY = 'reneu_nav_history_index';

function resolveInitialThemeSync(): ThemeMode {
  if (typeof window === 'undefined') return 'parchment';
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'parchment' || stored === 'white' || stored === 'black') {
      return stored;
    }
    const appStr = localStorage.getItem(APPEARANCE_STORAGE_KEY);
    if (appStr) {
      const parsed = JSON.parse(appStr);
      if (parsed?.theme === 'parchment' || parsed?.theme === 'white' || parsed?.theme === 'black') {
        return parsed.theme;
      }
    }
    const domTheme = document.documentElement.getAttribute('data-theme');
    if (domTheme === 'parchment' || domTheme === 'white' || domTheme === 'black') {
      return domTheme;
    }
    if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
      return 'black';
    }
  } catch {}
  return 'parchment';
}

function resolveInitialAppearanceSync(): AppearanceSettings {
  const initialTheme = resolveInitialThemeSync();
  if (typeof window === 'undefined') {
    return { ...DEFAULT_APPEARANCE, theme: initialTheme };
  }
  try {
    const appStr = localStorage.getItem(APPEARANCE_STORAGE_KEY);
    if (appStr) {
      const parsed = JSON.parse(appStr);
      return { ...DEFAULT_APPEARANCE, ...parsed, theme: initialTheme };
    }
  } catch {}
  return { ...DEFAULT_APPEARANCE, theme: initialTheme };
}

export const App: React.FC = () => {
  const [position, setPosition] = useState<ReadingPosition>({ bookId: 43, chapter: 1 });

  // History Navigation Stack (preserves browsing journey across chapters)
  const [historyStack, setHistoryStack] = useState<ReadingPosition[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = sessionStorage.getItem(SESSION_HISTORY_STACK_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
      } catch {}
    }
    return [{ bookId: 43, chapter: 1 }];
  });

  const [historyIndex, setHistoryIndex] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = sessionStorage.getItem(SESSION_HISTORY_INDEX_KEY);
        if (stored !== null) {
          const idx = Number(stored);
          if (!isNaN(idx) && idx >= 0) return idx;
        }
      } catch {}
    }
    return 0;
  });
  const [theme, setTheme] = useState<ThemeMode>(resolveInitialThemeSync);
  const [appearance, setAppearance] = useState<AppearanceSettings>(resolveInitialAppearanceSync);
  const [currentView, setCurrentView] = useState<'reader' | 'notes' | 'plans' | 'settings'>('reader');
  const [chapterData, setChapterData] = useState<ChapterData | null>(null);
  const [notes, setNotes] = useState<CommentaryNote[]>([]);
  const [command, setCommand] = useState<string>(() => formatNavigationLabel(position));
  const [isSuggestionsOpen, setIsSuggestionsOpen] = useState<boolean>(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState<number>(0);
  const [focusedVerse, setFocusedVerse] = useState<number | null>(null);
  const targetScrollVerseRef = useRef<number | null>(null);
  const pendingTopScrollRef = useRef<boolean>(false);
  const [scrollRequestSeq, setScrollRequestSeq] = useState<number>(0);
  const [exposedNotes, setExposedNotes] = useState<Set<string>>(() => getInitialExposedNotesSync());
  const [copiedToast, setCopiedToast] = useState<ToastPayload | null>(null);
  const hasShownOfflineToastRef = useRef<boolean>(false);
  const lastAutoSyncedUserIdRef = useRef<string | null>(null);
  const positionRef = useRef<ReadingPosition>(position);
  positionRef.current = position;
  const isOnline = useOnlineStatus();
  const { isInstalled: isPWAInstalled } = usePWAInstall();
  const [isComposingPlainNote, setIsComposingPlainNote] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [appInitialized, setAppInitialized] = useState<boolean>(false);
  const [chapterLoadCount, setChapterLoadCount] = useState<number>(0);
  const hasInitialChapterLoadedRef = useRef<boolean>(false);
  const hasTriggeredSplashDismissRef = useRef<boolean>(false);
  const [planReadingSession, setPlanReadingSession] = useState<PlanReadingSession | null>(null);
  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth < 1024 : false
  );
  const [currentUser, setCurrentUser] = useState<SupabaseUserProfile | null>(null);
  const [isLoginSplashOpen, setIsLoginSplashOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return checkSimulateLoginSplash();
  });
  const [isAboutOpen, setIsAboutOpen] = useState<boolean>(false);
  const [pendingDeleteVerse, setPendingDeleteVerse] = useState<number | null>(null);

  useEffect(() => {
    if (!currentUser || isOnline || hasShownOfflineToastRef.current) return;
    hasShownOfflineToastRef.current = true;
    setCopiedToast({
      variant: 'offline',
      title: 'You are offline.',
      message: 'Sync will resume when back online.',
    });
  }, [currentUser, isOnline]);

  // Persist the entire NET Bible locally once installed as a PWA (resumes automatically if interrupted)
  useEffect(() => {
    if (!isPWAInstalled) return;
    if (!isOnline) {
      void refreshOfflineBibleProgress();
      return;
    }
    void ensureFullNetBibleCached();
  }, [isPWAInstalled, isOnline]);

  useEffect(() => {
    let mounted = true;
    getCurrentUser().then((user) => {
      if (mounted) {
        setCurrentUser(user);
        if (!user && checkSimulateLoginSplash()) {
          setIsLoginSplashOpen(true);
        }
      }
    });

    const unsubscribe = onAuthStateChange((user) => {
      if (mounted) {
        setCurrentUser(user);
        if (user) {
          setIsLoginSplashOpen(false);
        }
      }
    });

    const handleLoginSplashEvent = (e: Event) => {
      const custom = e as CustomEvent<boolean>;
      setIsLoginSplashOpen(Boolean(custom.detail));
    };

    window.addEventListener('scripturepage-sim-login-splash', handleLoginSplashEvent);

    return () => {
      mounted = false;
      unsubscribe();
      window.removeEventListener('scripturepage-sim-login-splash', handleLoginSplashEvent);
    };
  }, []);

  // Guarantee automatic bidirectional sync on initial sign-in, OAuth redirect return, or reconnect
  useEffect(() => {
    if (!currentUser) {
      lastAutoSyncedUserIdRef.current = null;
      return;
    }
    if (!isOnline) return;
    if (lastAutoSyncedUserIdRef.current === currentUser.id) return;
    lastAutoSyncedUserIdRef.current = currentUser.id;
    void syncAllWithCloud().catch(() => {});
  }, [currentUser, isOnline]);

  // Refresh active chapter notes and appearance immediately after cloud sync pulls data
  useEffect(() => {
    const handleCloudSynced = async () => {
      try {
        const pos = positionRef.current;
        const [freshNotes, freshAppearance] = await Promise.all([
          getNotesByChapter(pos.bookId, pos.chapter),
          getAppearanceSettings(),
        ]);
        setNotes(freshNotes);
        setAppearance(freshAppearance);
        setTheme(freshAppearance.theme);
      } catch (err) {
        console.warn('Could not refresh state after cloud sync:', err);
      }
    };

    window.addEventListener('reneu:cloud-synced', handleCloudSynced);
    return () => {
      window.removeEventListener('reneu:cloud-synced', handleCloudSynced);
    };
  }, []);

  const handleContinueAsGuest = useCallback(() => {
    setIsLoginSplashOpen(false);
    if (typeof window !== 'undefined') {
      try {
        sessionStorage.setItem('reneu_guest_mode_chosen', 'true');
      } catch {}
    }
  }, []);

  const handleAuthenticated = useCallback((user: SupabaseUserProfile) => {
    setCurrentUser(user);
    setIsLoginSplashOpen(false);
    void syncAllWithCloud().catch(() => {});
  }, []);

  useEffect(() => {
    let prevWidth = typeof window !== 'undefined' ? window.innerWidth : 0;
    const handleResize = () => {
      const currentWidth = window.innerWidth;
      // Only trigger state update if the screen width crossed or changed meaningfully
      if (Math.abs(currentWidth - prevWidth) >= 16) {
        prevWidth = currentWidth;
        setIsMobile(currentWidth < 1024);
      }
    };
    window.addEventListener('resize', handleResize, { passive: true });
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const commandInputRef = useRef<HTMLInputElement | null>(null);
  const skipBlurResetRef = useRef<boolean>(false);

  // Active dock tab index (CSS transform transition glides smoothly on compositor after paint)
  const activeDockIndex =
    currentView === 'reader'
      ? 0
      : currentView === 'notes'
      ? 1
      : currentView === 'plans'
      ? 2
      : 3;

  // Reset shared window scroll to top when switching into non-reader views (e.g. Notes)
  useLayoutEffect(() => {
    if (currentView !== 'reader') {
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    }
  }, [currentView]);

  const handleSelectTab = useCallback(
    (view: 'reader' | 'notes' | 'plans' | 'settings') => {
      if (currentView === view) {
        const prefersReduced =
          typeof window !== 'undefined' &&
          window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        window.scrollTo({
          top: 0,
          behavior: (prefersReduced ? 'instant' : 'smooth') as ScrollBehavior,
        });
        return;
      }
      setCurrentView(view);
    },
    [currentView]
  );

  // Initial load
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [savedPos, savedAppearance, savedExposed] = await Promise.all([
          getReadingPosition(),
          getAppearanceSettings(),
          getExposedNotes(),
          ensureNotesInitialized(),
          ensurePlansInitialized(),
        ]);
        if (!mounted) return;
        setPosition(savedPos);
        setAppearance(savedAppearance);
        setTheme(savedAppearance.theme);
        if (savedExposed && savedExposed.length > 0) {
          setExposedNotes(new Set(savedExposed));
        }

        // Initialize history stack with saved reading position if stack only contains the initial default
        setHistoryStack((prevStack) => {
          if (
            prevStack.length === 1 &&
            prevStack[0].bookId === 43 &&
            prevStack[0].chapter === 1 &&
            (savedPos.bookId !== 43 || savedPos.chapter !== 1)
          ) {
            const newStack = [savedPos];
            try {
              sessionStorage.setItem(SESSION_HISTORY_STACK_KEY, JSON.stringify(newStack));
              sessionStorage.setItem(SESSION_HISTORY_INDEX_KEY, '0');
            } catch {}
            setHistoryIndex(0);
            return newStack;
          }
          return prevStack;
        });

        // Load initial chapter notes early so they are immediately available on first reader render
        try {
          const initialNotes = await getNotesByChapter(savedPos.bookId, savedPos.chapter);
          if (mounted) {
            setNotes(initialNotes);
          }
        } catch (err) {
          console.warn('Could not early load chapter notes:', err);
        }
      } catch (err) {
        console.warn('Initial load recovery:', err);
      } finally {
        if (mounted) {
          setAppInitialized(true);
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Idle-prefetch lazy view chunks after initialization so first tab switch to/from Notes has zero chunk-load stutter
  useEffect(() => {
    if (!appInitialized) return;
    const prefetch = () => {
      void import('./components/AllNotesView');
      void import('./components/ReadingPlansView');
      void import('./components/SettingsView');
    };
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (typeof w.requestIdleCallback === 'function') {
      const id = w.requestIdleCallback(prefetch, { timeout: 1500 });
      return () => w.cancelIdleCallback?.(id);
    }
    const timer = window.setTimeout(prefetch, 400);
    return () => window.clearTimeout(timer);
  }, [appInitialized]);

  // Sync Theme with DOM and Meta theme-color (hardened for iOS Safari extended top bar)
  useEffect(() => {
    const themeColors: Record<ThemeMode, string> = {
      parchment: '#f5efeb',
      white: '#ffffff',
      black: '#111113',
    };
    const nextColor = themeColors[theme];

    const syncThemeColorMeta = (color: string, forceReplace = false) => {
      const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
      if (!forceReplace && metas.length === 1 && metas[0].content === color) {
        return;
      }
      if (metas.length === 1 && !forceReplace) {
        metas[0].content = color;
        return;
      }
      metas.forEach((node) => node.remove());
      const freshMeta = document.createElement('meta');
      freshMeta.name = 'theme-color';
      freshMeta.content = color;
      document.head.appendChild(freshMeta);
    };

    const prevTheme = document.documentElement.getAttribute('data-theme');
    const didThemeChange = prevTheme !== theme;

    if (didThemeChange) {
      document.documentElement.setAttribute('data-theme', theme);
    }
    if (document.documentElement.style.backgroundColor !== nextColor) {
      document.documentElement.style.backgroundColor = nextColor;
    }
    if (document.body.style.backgroundColor !== nextColor) {
      document.body.style.backgroundColor = nextColor;
    }
    if (theme === 'black') {
      document.documentElement.classList.add('dark');
      document.documentElement.style.colorScheme = 'dark';
    } else {
      document.documentElement.classList.remove('dark');
      document.documentElement.style.colorScheme = 'light';
    }

    syncThemeColorMeta(nextColor, didThemeChange);

    // Only re-sample theme-color meta after paint settle when theme actually changed
    let rafOuter = 0;
    let rafInner = 0;
    let settleTimer = 0;
    if (didThemeChange) {
      rafOuter = window.requestAnimationFrame(() => {
        rafInner = window.requestAnimationFrame(() => {
          syncThemeColorMeta(nextColor, true);
        });
      });
      settleTimer = window.setTimeout(() => {
        syncThemeColorMeta(nextColor, false);
      }, 240);
    }

    const handleVisibilityOrShow = () => {
      if (document.visibilityState === 'visible') {
        // Update in-place only if mismatched; never tear down and recreate on every wake
        syncThemeColorMeta(nextColor, false);
      }
    };
    window.addEventListener('pageshow', handleVisibilityOrShow);
    document.addEventListener('visibilitychange', handleVisibilityOrShow);

    const splash = document.getElementById('pwa-splash');
    if (splash && splash.getAttribute('data-splash-theme') !== theme) {
      splash.setAttribute('data-splash-theme', theme);
    }

    if (appInitialized) {
      void saveTheme(theme);
    }

    return () => {
      if (rafOuter) window.cancelAnimationFrame(rafOuter);
      if (rafInner) window.cancelAnimationFrame(rafInner);
      if (settleTimer) window.clearTimeout(settleTimer);
      window.removeEventListener('pageshow', handleVisibilityOrShow);
      document.removeEventListener('visibilitychange', handleVisibilityOrShow);
    };
  }, [theme, appInitialized]);

  const handleUpdateAppearance = (newSettings: AppearanceSettings) => {
    setAppearance(newSettings);
    setTheme(newSettings.theme);
    void saveAppearanceSettings(newSettings);
  };

  // Calibrated minimum artificial delay (320ms) ensures the reader skeleton placeholder
  // transitions deliberately and smoothly, eliminating high-frequency flashes or glitchy micro-stutters.
  const SKELETON_ARTIFICIAL_DELAY_MS = 320;

  // Load Chapter Data & Notes when position or initialization changes
  useEffect(() => {
    if (!appInitialized) return;
    let mounted = true;
    const startTime = Date.now();
    const isInitialLoad = !hasInitialChapterLoadedRef.current;
    setIsLoading(true);

    Promise.all([
      fetchChapterData(position.bookId, position.chapter),
      getNotesByChapter(position.bookId, position.chapter),
      saveReadingPosition(position),
    ])
      .then(async ([data, chapterNotes]) => {
        if (!mounted) return;

        // Skip artificial skeleton delay on initial boot so cached scripture paints directly
        // behind the splash screen and cross-fades cleanly without a skeleton flash.
        if (!isInitialLoad) {
          const elapsed = Date.now() - startTime;
          const remainingDelay = Math.max(0, SKELETON_ARTIFICIAL_DELAY_MS - elapsed);
          if (remainingDelay > 0) {
            await new Promise((resolve) => setTimeout(resolve, remainingDelay));
          }
        }

        if (!mounted) return;
        hasInitialChapterLoadedRef.current = true;
        setChapterLoadCount((c) => c + 1);
        setChapterData(data);
        setNotes(chapterNotes);
      })
      .catch((err) => {
        console.error('Failed to load chapter data:', err);
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [position, appInitialized]);

  const isChapterReady =
    !isLoading &&
    chapterData !== null &&
    chapterData.bookId === position.bookId &&
    chapterData.chapter === position.chapter;

  const scrollVerseToViewportCenter = useCallback((verseNum: number): boolean => {
    const el = document.getElementById(`verse-${verseNum}`);
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const effectiveHeight = Math.min(rect.height, window.innerHeight * 0.65);
    const targetTop = rect.top + window.scrollY - (window.innerHeight - effectiveHeight) / 2;
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const clampedTop = Math.max(0, Math.min(targetTop, maxScroll));
    window.scrollTo({ top: clampedTop, behavior: 'instant' as ScrollBehavior });
    return true;
  }, []);

  // Position Reader already scrolled to the target verse in the middle of the viewport before first paint
  useLayoutEffect(() => {
    if (
      currentView !== 'reader' ||
      isLoading ||
      !chapterData ||
      chapterData.bookId !== position.bookId ||
      chapterData.chapter !== position.chapter
    ) {
      return;
    }

    if (targetScrollVerseRef.current !== null) {
      const targetVerse = targetScrollVerseRef.current;
      targetScrollVerseRef.current = null;
      pendingTopScrollRef.current = false;
      scrollVerseToViewportCenter(targetVerse);
    } else if (pendingTopScrollRef.current) {
      pendingTopScrollRef.current = false;
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    }
  }, [
    currentView,
    isLoading,
    chapterData,
    position.bookId,
    position.chapter,
    scrollRequestSeq,
    scrollVerseToViewportCenter,
  ]);

  // Manage HTML PWA splash screen dismissal (honoring VITE_SIMULATE_SPLASH / ?splash=true)
  useEffect(() => {
    const win = window as Window & { __reneuDismissSplash?: () => void };
    const splash = document.getElementById('pwa-splash');
    const triggerUnifiedDismiss = () => {
      if (hasTriggeredSplashDismissRef.current) return;
      hasTriggeredSplashDismissRef.current = true;
      if (typeof win.__reneuDismissSplash === 'function') {
        win.__reneuDismissSplash();
      } else {
        document.body.classList.remove('splash-active');
        document.documentElement.classList.remove('splash-active');
        if (splash) {
          splash.classList.add('splash-dismissed');
          window.setTimeout(() => {
            if (splash.parentNode) splash.remove();
          }, 420);
        }
      }
    };

    if (!splash) {
      document.body.classList.remove('splash-active');
      document.documentElement.classList.remove('splash-active');
      return;
    }

    const isSimulatingSplash = checkSimulateSplash();

    // Never re-open splash if already dismissed
    if (splash.classList.contains('splash-dismissed') || hasTriggeredSplashDismissRef.current) {
      return;
    }

    if (isSimulatingSplash) {
      document.body.classList.add('splash-active');
      document.documentElement.classList.add('splash-active');
      // Developer escape hatch: press Escape to dismiss (click is handled by index.html controller)
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') triggerUnifiedDismiss();
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => {
        window.removeEventListener('keydown', handleKeyDown);
      };
    }

    if (!appInitialized) return;

    let cancelled = false;
    let graceTimer: number | null = null;

    const dismissWhenFontsSettle = () => {
      if (cancelled || hasTriggeredSplashDismissRef.current) return;
      const fontsReady =
        typeof document !== 'undefined' && document.fonts && document.fonts.ready
          ? Promise.race([
              document.fonts.ready.catch(() => {}),
              new Promise<void>((resolve) => window.setTimeout(resolve, 180)),
            ])
          : Promise.resolve();

      void fontsReady.then(() => {
        if (!cancelled) {
          triggerUnifiedDismiss();
        }
      });
    };

    // Wait until initial chapter is ready so splash cross-fades directly into rendered text,
    // with a 1200ms grace cap so slow/offline uncached loads fall back to the skeleton smoothly.
    if (isChapterReady || currentView !== 'reader') {
      dismissWhenFontsSettle();
    } else {
      graceTimer = window.setTimeout(() => {
        dismissWhenFontsSettle();
      }, 1200);
    }

    return () => {
      cancelled = true;
      if (graceTimer !== null) window.clearTimeout(graceTimer);
    };
  }, [appInitialized, isChapterReady, currentView]);

  // Refresh notes when returning to reader
  useEffect(() => {
    if (currentView === 'reader' && appInitialized) {
      getNotesByChapter(position.bookId, position.chapter).then((chNotes) => {
        setNotes(chNotes);
      });
    }
  }, [currentView, appInitialized, position]);

  // Centralized Navigation Engine with History Tracking
  const navigateToPosition = useCallback(
    (
      target: { bookId: number; chapter: number; verse?: number },
      options?: { isHistoryAction?: boolean; focusNote?: boolean }
    ) => {
      const isHistoryAction = options?.isHistoryAction ?? false;
      const shouldFocusNote = options?.focusNote ?? true;
      const newPos: ReadingPosition = { bookId: target.bookId, chapter: target.chapter };

      setPosition(newPos);
      setCurrentView('reader');

      if (!isHistoryAction) {
        setHistoryStack((prevStack) => {
          const currentItem = prevStack[historyIndex];
          // Avoid pushing duplicate entry if already at this position
          if (currentItem && currentItem.bookId === target.bookId && currentItem.chapter === target.chapter) {
            return prevStack;
          }

          // Truncate any forward history beyond current history index
          const truncated = prevStack.slice(0, historyIndex + 1);
          const nextStack = [...truncated, newPos];
          // Limit stack length to MAX_HISTORY_LENGTH (50)
          const finalStack =
            nextStack.length > MAX_HISTORY_LENGTH
              ? nextStack.slice(nextStack.length - MAX_HISTORY_LENGTH)
              : nextStack;

          const nextIndex = finalStack.length - 1;
          setHistoryIndex(nextIndex);

          try {
            sessionStorage.setItem(SESSION_HISTORY_STACK_KEY, JSON.stringify(finalStack));
            sessionStorage.setItem(SESSION_HISTORY_INDEX_KEY, String(nextIndex));
          } catch {}

          return finalStack;
        });
      }

      if (target.verse) {
        pendingTopScrollRef.current = false;
        targetScrollVerseRef.current = target.verse;
        if (shouldFocusNote) {
          setFocusedVerse(target.verse);
          const verseKey = `${target.bookId}:${target.chapter}:${target.verse}`;
          setExposedNotes((prev) => {
            if (prev.has(verseKey)) return prev;
            const next = new Set(prev);
            next.add(verseKey);
            void saveExposedNotes(Array.from(next));
            return next;
          });
        } else {
          setFocusedVerse(null);
        }
        setScrollRequestSeq((prev) => prev + 1);
      } else {
        targetScrollVerseRef.current = null;
        pendingTopScrollRef.current = true;
        setFocusedVerse(null);
        window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
        setScrollRequestSeq((prev) => prev + 1);
      }
    },
    [historyIndex]
  );

  // History Navigation Helpers
  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < historyStack.length - 1;

  const prevHistoryItem = canGoBack ? historyStack[historyIndex - 1] : null;
  const nextHistoryItem = canGoForward ? historyStack[historyIndex + 1] : null;

  const prevHistoryLabel = useMemo(() => {
    if (!prevHistoryItem) return null;
    const b = getBookById(prevHistoryItem.bookId);
    return `${b?.name || ''} ${prevHistoryItem.chapter}`;
  }, [prevHistoryItem]);

  const nextHistoryLabel = useMemo(() => {
    if (!nextHistoryItem) return null;
    const b = getBookById(nextHistoryItem.bookId);
    return `${b?.name || ''} ${nextHistoryItem.chapter}`;
  }, [nextHistoryItem]);

  const handleHistoryBack = useCallback(() => {
    if (!canGoBack || !prevHistoryItem) return;
    const newIndex = historyIndex - 1;
    setHistoryIndex(newIndex);
    try {
      sessionStorage.setItem(SESSION_HISTORY_INDEX_KEY, String(newIndex));
    } catch {}
    navigateToPosition(prevHistoryItem, { isHistoryAction: true });
  }, [canGoBack, prevHistoryItem, historyIndex, navigateToPosition]);

  const handleHistoryForward = useCallback(() => {
    if (!canGoForward || !nextHistoryItem) return;
    const newIndex = historyIndex + 1;
    setHistoryIndex(newIndex);
    try {
      sessionStorage.setItem(SESSION_HISTORY_INDEX_KEY, String(newIndex));
    } catch {}
    navigateToPosition(nextHistoryItem, { isHistoryAction: true });
  }, [canGoForward, nextHistoryItem, historyIndex, navigateToPosition]);

  const formatAssignedChapterLabel = useCallback((ch?: PlanAssignedChapter | null): string => {
    if (!ch) return '';
    if (ch.startVerse !== undefined && ch.endVerse !== undefined) {
      const canonicalCount = getChapterVerseCount(ch.bookId, ch.chapter);
      if (ch.startVerse === 1 && ch.endVerse >= canonicalCount) {
        return `${ch.bookName} ${ch.chapter}`;
      }
      if (ch.startVerse === ch.endVerse) {
        return `${ch.bookName} ${ch.chapter}:${ch.startVerse}`;
      }
      return `${ch.bookName} ${ch.chapter}:${ch.startVerse}–${ch.endVerse}`;
    }
    return `${ch.bookName} ${ch.chapter}`;
  }, []);

  const activePlanAssignedChapter = useMemo(() => {
    if (!planReadingSession) return null;
    const current = planReadingSession.assignedChapters[planReadingSession.currentChapterIndex];
    if (current && current.bookId === position.bookId && current.chapter === position.chapter) {
      return current;
    }
    return (
      planReadingSession.assignedChapters.find(
        (c) => c.bookId === position.bookId && c.chapter === position.chapter
      ) || null
    );
  }, [planReadingSession, position.bookId, position.chapter]);

  const currentLocationDisplayLabel = useMemo(() => {
    if (activePlanAssignedChapter && !focusedVerse) {
      return formatAssignedChapterLabel(activePlanAssignedChapter);
    }
    return formatNavigationLabel({
      bookId: position.bookId,
      chapter: position.chapter,
      ...(focusedVerse ? { verse: focusedVerse } : {}),
    });
  }, [activePlanAssignedChapter, focusedVerse, position.bookId, position.chapter, formatAssignedChapterLabel]);

  useEffect(() => {
    setCommand(currentLocationDisplayLabel);
    setIsSuggestionsOpen(false);
    setActiveSuggestionIndex(0);
  }, [currentLocationDisplayLabel]);

  const omnibarSuggestions = useMemo(() => {
    if (!isSuggestionsOpen) return [];
    return getOmnibarSuggestions(command, position.bookId, position.chapter, 7);
  }, [isSuggestionsOpen, command, position.bookId, position.chapter]);

  useEffect(() => {
    if (!isSuggestionsOpen || omnibarSuggestions.length === 0) return;
    const activeItem = omnibarSuggestions[activeSuggestionIndex];
    if (!activeItem) return;
    document
      .getElementById(`omnibar-option-${activeItem.id}`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [isSuggestionsOpen, activeSuggestionIndex, omnibarSuggestions]);

  const blurCommandInput = useCallback(() => {
    skipBlurResetRef.current = true;
    commandInputRef.current?.blur();
    window.setTimeout(() => {
      skipBlurResetRef.current = false;
    }, 0);
  }, []);

  const selectOmnibarSuggestion = useCallback(
    (suggestion: OmnibarSuggestion) => {
      const validatedLabel = formatNavigationLabel(suggestion.target);
      setCommand(validatedLabel);
      setIsSuggestionsOpen(false);
      setActiveSuggestionIndex(0);
      navigateToPosition(suggestion.target);
      blurCommandInput();
    },
    [navigateToPosition, blurCommandInput]
  );

  const executeCommandSubmit = useCallback(() => {
    const trimmed = command.trim();
    const lowerCmd = trimmed.toLowerCase();
    const currentLabel = currentLocationDisplayLabel;

    if (trimmed === currentLabel) {
      setIsSuggestionsOpen(false);
      blurCommandInput();
      return;
    }

    if (lowerCmd === '/plans' || lowerCmd === '/plan' || lowerCmd === 'plans' || lowerCmd === 'plan') {
      setCurrentView('plans');
      setCommand(currentLabel);
      setIsSuggestionsOpen(false);
      blurCommandInput();
      return;
    }
    if (lowerCmd === '/notes' || lowerCmd === '/note' || lowerCmd === 'notes') {
      setCurrentView('notes');
      setCommand(currentLabel);
      setIsSuggestionsOpen(false);
      blurCommandInput();
      return;
    }
    if (lowerCmd === '/settings' || lowerCmd === 'settings') {
      setCurrentView('settings');
      setCommand(currentLabel);
      setIsSuggestionsOpen(false);
      blurCommandInput();
      return;
    }

    const isThemeCommand = [
      'parchment',
      'white',
      'light',
      'black',
      'dark',
      'theme parchment',
      'theme white',
      'theme light',
      'theme black',
      'theme dark',
    ].includes(lowerCmd);

    if (!isThemeCommand && trimmed.length > 0) {
      const activeSuggestions =
        isSuggestionsOpen && omnibarSuggestions.length > 0
          ? omnibarSuggestions
          : getOmnibarSuggestions(command, position.bookId, position.chapter, 7);

      if (activeSuggestions.length > 0) {
        const idx =
          activeSuggestionIndex >= 0 && activeSuggestionIndex < activeSuggestions.length
            ? activeSuggestionIndex
            : 0;
        selectOmnibarSuggestion(activeSuggestions[idx]);
        return;
      }
    }

    const action = parseOmnibarAction(command, position.bookId, position.chapter);
    if (action) {
      if (action.type === 'theme') {
        setTheme(action.theme);
        setAppearance((prev) => ({ ...prev, theme: action.theme }));
        setCommand(currentLabel);
        setIsSuggestionsOpen(false);
        blurCommandInput();
        return;
      }
      const target = action.target;
      const validatedLabel = formatNavigationLabel(target);
      setCommand(validatedLabel);
      setIsSuggestionsOpen(false);
      setActiveSuggestionIndex(0);
      navigateToPosition(target);
      blurCommandInput();
      return;
    }

    setCommand(currentLabel);
    setIsSuggestionsOpen(false);
    blurCommandInput();
  }, [
    command,
    currentLocationDisplayLabel,
    position.bookId,
    position.chapter,
    isSuggestionsOpen,
    omnibarSuggestions,
    activeSuggestionIndex,
    selectOmnibarSuggestion,
    navigateToPosition,
    blurCommandInput,
  ]);

  const handleCommandSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    executeCommandSubmit();
  };

  const handleNoteChange = useCallback(
    async (verseNum: number, text: string) => {
      const existing = notes.find((n) => n.startVerse === verseNum);
      let updatedNotes: CommentaryNote[];

      if (existing) {
        if (text.trim() === '') {
          await softDeleteNote(existing.id);
          updatedNotes = notes.filter((n) => n.id !== existing.id);
        } else {
          const isContentChanged = existing.content.trim() !== text.trim();
          const updated: CommentaryNote = {
            ...existing,
            content: text,
            updatedAt: Date.now(),
          };
          await addOrUpdateNote(updated);
          if (isContentChanged && text.trim() !== '') {
            await recordNewNoteMadeForSynthesis();
          }
          updatedNotes = notes.map((n) => (n.id === existing.id ? updated : n));
        }
      } else if (text.trim() !== '') {
        const newNote: CommentaryNote = {
          id: crypto.randomUUID(),
          bookId: position.bookId,
          bookName: chapterData?.bookName || '',
          chapter: position.chapter,
          startVerse: verseNum,
          endVerse: verseNum,
          content: text,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        await addOrUpdateNote(newNote);
        await recordNewNoteMadeForSynthesis();
        updatedNotes = [...notes, newNote];
      } else {
        return;
      }
      setNotes(updatedNotes);
    },
    [notes, position, chapterData]
  );

  const copyVerseReference = async (reference: string): Promise<boolean> => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(reference);
        return true;
      }
      const textArea = document.createElement('textarea');
      textArea.value = reference;
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      return true;
    } catch {
      try {
        const textArea = document.createElement('textarea');
        textArea.value = reference;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        return true;
      } catch {
        return false;
      }
    }
  };

  const handleDismissToast = useCallback(() => {
    setCopiedToast(null);
  }, []);

  const handleVerseNumberClick = (v: VerseToken, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!chapterData) return;
    const bookAbbr = getBookAbbreviation(position.bookId);
    const reference = `${bookAbbr} ${chapterData.chapter}:${v.verse}`;
    void copyVerseReference(reference);
    setCopiedToast({ reference });
  };

  const handleNavigateFromNotes = (bookId: number, chapter: number, verse?: number) => {
    navigateToPosition({ bookId, chapter, ...(verse ? { verse } : {}) });
  };

  const handleNoteTokenClick = (tokenTarget: string, _sourceVerse?: number, label?: string) => {
    const refString = label || tokenTarget;
    const parsed = parseScriptureReference(refString);
    if (parsed && (parsed.verse !== undefined || !tokenTarget.startsWith('@v:'))) {
      navigateToPosition({
        bookId: parsed.bookId,
        chapter: parsed.chapter,
        ...(parsed.verse !== undefined ? { verse: parsed.verse } : {}),
      });
      return;
    }

    if (tokenTarget.startsWith('@v:')) {
      const target = tokenTarget.slice(3);
      if (target.includes(':') || target.includes('.')) {
        const parts = target.split(/[:.]/);
        if (parts.length === 3) {
          const bId = parseInt(parts[0], 10);
          const ch = parseInt(parts[1], 10);
          const vs = parseInt(parts[2], 10);
          if (!isNaN(bId) && !isNaN(ch) && !isNaN(vs)) {
            navigateToPosition({ bookId: bId, chapter: ch, verse: vs });
            return;
          }
        }
      }
      const targetVerseNum = parseInt(target, 10);
      if (!isNaN(targetVerseNum) && chapterData) {
        const verseObj = chapterData.verses.find((v) => v.verse === targetVerseNum);
        if (verseObj) {
          navigateToPosition({
            bookId: position.bookId,
            chapter: position.chapter,
            verse: verseObj.verse,
          });
        }
      }
    }
  };

  const handleScrollToVerse = (verseNum: number) => {
    setFocusedVerse(verseNum);
    scrollVerseToViewportCenter(verseNum);
  };

  // Performance: Constant-time O(1) map of commentary notes by verse
  const notesByVerse = useMemo(() => {
    const map = new Map<number, CommentaryNote>();
    for (const n of notes) {
      map.set(n.startVerse, n);
    }
    return map;
  }, [notes]);

  const handleVerseRowClick = useCallback((verseNum: number) => {
    const verseKey = `${position.bookId}:${position.chapter}:${verseNum}`;
    setExposedNotes((prev) => {
      const next = new Set(prev);
      if (next.has(verseKey)) {
        next.delete(verseKey);
        setFocusedVerse((curr) => (curr === verseNum ? null : curr));
      } else {
        next.add(verseKey);
        setFocusedVerse(verseNum);
      }
      void saveExposedNotes(Array.from(next));
      return next;
    });
  }, [position.bookId, position.chapter]);

  const handleDeleteNoteForVerse = useCallback((verseNum: number) => {
    setPendingDeleteVerse(verseNum);
  }, []);

  const handleConfirmDeleteVerseNote = useCallback(async () => {
    if (pendingDeleteVerse === null) return;
    const verseNum = pendingDeleteVerse;
    setPendingDeleteVerse(null);
    const existing = notes.find((n) => n.startVerse === verseNum);
    if (existing) {
      await softDeleteNote(existing.id);
      setNotes((prev) => prev.filter((n) => n.id !== existing.id));
    }
  }, [pendingDeleteVerse, notes]);

  // Performance: Prefetch adjacent chapter during browser idle time for instant chapter navigation
  useEffect(() => {
    if (!chapterData || isLoading) return;
    const currentBook = getBookById(position.bookId);
    const timer = window.setTimeout(() => {
      if (position.chapter < currentBook.chapterCount) {
        void fetchChapterData(position.bookId, position.chapter + 1);
      } else if (position.bookId < CANONICAL_BOOKS.length) {
        void fetchChapterData(position.bookId + 1, 1);
      }
    }, 1500);

    return () => window.clearTimeout(timer);
  }, [position.bookId, position.chapter, chapterData, isLoading]);

  // Chapter pagination calculations (Canonical sequence)
  const prevChapterTarget = useMemo(() => {
    const currentBook = getBookById(position.bookId);
    if (position.chapter > 1) {
      return {
        bookId: position.bookId,
        chapter: position.chapter - 1,
        label: `${currentBook.name} ${position.chapter - 1}`,
      };
    }
    // Transition to previous book
    if (position.bookId > 1) {
      const prevBook = getBookById(position.bookId - 1);
      return {
        bookId: prevBook.id,
        chapter: prevBook.chapterCount,
        label: `${prevBook.name} ${prevBook.chapterCount}`,
      };
    }
    return null;
  }, [position]);

  const nextChapterTarget = useMemo(() => {
    const currentBook = getBookById(position.bookId);
    if (position.chapter < currentBook.chapterCount) {
      return {
        bookId: position.bookId,
        chapter: position.chapter + 1,
        label: `${currentBook.name} ${position.chapter + 1}`,
      };
    }
    // Transition to next book
    if (position.bookId < CANONICAL_BOOKS.length) {
      const nextBook = getBookById(position.bookId + 1);
      return {
        bookId: nextBook.id,
        chapter: 1,
        label: `${nextBook.name} 1`,
      };
    }
    return null;
  }, [position]);

  const handleNavigateToChapter = (targetBookId: number, targetChapter: number) => {
    navigateToPosition({ bookId: targetBookId, chapter: targetChapter });
  };

  // Launch Reader in Plan Mode for a specific plan day
  const handleStartPlanReading = useCallback(
    (plan: ReadingPlan, daySchedule: PlanDaySchedule, targetPortionIndex: number = 0) => {
      const assigned = getAssignedChaptersForDay(daySchedule);
      if (assigned.length === 0) return;

      let initialIndex = 0;
      if (typeof targetPortionIndex === 'number' && targetPortionIndex >= 0) {
        const found = assigned.findIndex((c) => c.portionIndex === targetPortionIndex);
        if (found >= 0) initialIndex = found;
      }

      const target = assigned[initialIndex];
      const isAlreadyCompleted = Boolean(plan.completedDays?.includes(daySchedule.dayNumber));

      setPlanReadingSession({
        planId: plan.id,
        planTitle: plan.title,
        dayNumber: daySchedule.dayNumber,
        totalDays: plan.durationDays,
        assignedChapters: assigned,
        currentChapterIndex: initialIndex,
        isDayFinished: isAlreadyCompleted,
      });

      navigateToPosition({ bookId: target.bookId, chapter: target.chapter });
      setCurrentView('reader');
    },
    [navigateToPosition]
  );

  // Navigate through today's assigned chapters in Plan Mode
  const handleNavigatePlanChapter = useCallback(
    (direction: 'prev' | 'next') => {
      if (!planReadingSession) return;
      const targetIndex =
        direction === 'prev'
          ? planReadingSession.currentChapterIndex - 1
          : planReadingSession.currentChapterIndex + 1;

      if (targetIndex < 0 || targetIndex >= planReadingSession.assignedChapters.length) {
        return;
      }

      const target = planReadingSession.assignedChapters[targetIndex];
      setPlanReadingSession((prev) =>
        prev ? { ...prev, currentChapterIndex: targetIndex } : null
      );
      navigateToPosition({ bookId: target.bookId, chapter: target.chapter });
    },
    [planReadingSession, navigateToPosition]
  );

  // Mark today's assigned reading finished in Plan Mode and show the fact in the plans view
  const handleFinishPlanDay = useCallback(async () => {
    if (!planReadingSession) return;
    const allPortionKeys = planReadingSession.assignedChapters.map(
      (c) => `${planReadingSession.dayNumber}-${c.portionIndex}`
    );
    await setDayCompletionState(
      planReadingSession.planId,
      planReadingSession.dayNumber,
      true,
      allPortionKeys
    );
    setPlanReadingSession((prev) => (prev ? { ...prev, isDayFinished: true } : null));
    setCurrentView('plans');
  }, [planReadingSession]);

  // Synchronize planReadingSession if plan progress is modified in plans view
  const handlePlanProgressChange = useCallback((updatedPlan: ReadingPlan) => {
    setPlanReadingSession((prev) => {
      if (!prev || prev.planId !== updatedPlan.id) return prev;
      const isDayFinished = Boolean(updatedPlan.completedDays?.includes(prev.dayNumber));
      if (prev.isDayFinished === isDayFinished) return prev;
      return { ...prev, isDayFinished };
    });
  }, []);

  // Clear or reconcile active planReadingSession when plans are deleted or cloud-synced
  useEffect(() => {
    const handlePlanDeleted = (e: Event) => {
      const deletedId = (e as CustomEvent<{ planId?: string }>).detail?.planId;
      if (!deletedId) return;
      setPlanReadingSession((prev) => (prev?.planId === deletedId ? null : prev));
    };

    const handlePlansSynced = async () => {
      const plans = await getAllReadingPlans();
      setPlanReadingSession((prev) => {
        if (!prev) return null;
        const match = plans.find((p) => p.id === prev.planId);
        if (!match) return null;
        const isDayFinished = Boolean(match.completedDays?.includes(prev.dayNumber));
        if (prev.isDayFinished === isDayFinished && prev.planTitle === match.title) return prev;
        return { ...prev, planTitle: match.title, isDayFinished };
      });
    };

    window.addEventListener('reneu:plan-deleted', handlePlanDeleted);
    window.addEventListener('reneu:plans-synced', handlePlansSynced);
    return () => {
      window.removeEventListener('reneu:plan-deleted', handlePlanDeleted);
      window.removeEventListener('reneu:plans-synced', handlePlansSynced);
    };
  }, []);

  // Synchronize currentChapterIndex if position changes within active plan readings
  useEffect(() => {
    if (!planReadingSession) return;
    const matchingIdx = planReadingSession.assignedChapters.findIndex(
      (c) => c.bookId === position.bookId && c.chapter === position.chapter
    );
    if (matchingIdx >= 0 && matchingIdx !== planReadingSession.currentChapterIndex) {
      setPlanReadingSession((prev) =>
        prev ? { ...prev, currentChapterIndex: matchingIdx } : null
      );
    }
  }, [position.bookId, position.chapter, planReadingSession]);

  // Scroll progress within current active chapter & shrinking sticky Reader omnibar
  const [chapterScrollProgress, setChapterScrollProgress] = useState<number>(0);
  const [isReaderOmnibarFocused, setIsReaderOmnibarFocused] = useState<boolean>(false);
  const [isReaderOmnibarManuallyExpanded, setIsReaderOmnibarManuallyExpanded] = useState<boolean>(false);
  const readerChromeRef = useRef<HTMLDivElement>(null);
  const readerOmnibarRef = useRef<HTMLElement>(null);
  const readerFullRowRef = useRef<HTMLDivElement>(null);
  const fullTitleAnchorRef = useRef<HTMLSpanElement>(null);
  const expandedScrollAnchorYRef = useRef<number>(0);

  const {
    isVisible: isReaderOmnibarVisible,
    isScrolledPastTop: isReaderScrolledPastTop,
  } = useAutoHideHeader({
    headerRef: readerOmnibarRef,
    enabled: currentView === 'reader',
    forceVisible: isReaderOmnibarFocused || (isSuggestionsOpen && omnibarSuggestions.length > 0),
    resetKey: `${currentView}-${position.bookId}-${position.chapter}-${isChapterReady ? 1 : 0}-${scrollRequestSeq}`,
    showUpDelta: 8,
    measureHeight: false,
  });

  const isReaderOmnibarFull =
    isReaderOmnibarVisible ||
    isReaderOmnibarManuallyExpanded ||
    isReaderOmnibarFocused ||
    (isSuggestionsOpen && omnibarSuggestions.length > 0);

  // Measure the uncollapsed full-row height directly (constant during compact/expand transitions)
  useLayoutEffect(() => {
    if (currentView !== 'reader') return;
    const chromeEl = readerChromeRef.current;
    const fullRowEl = readerFullRowRef.current;
    if (!chromeEl || !fullRowEl) return;

    const syncStaticChromeMetrics = () => {
      const fullOmnibarH = Math.round(fullRowEl.offsetHeight);
      const planBarEl = chromeEl.querySelector<HTMLElement>('[data-reader-plan-bar]');
      const planBarH = planBarEl ? Math.round(planBarEl.offsetHeight) : 0;
      if (fullOmnibarH > 0) {
        chromeEl.style.setProperty('--reader-omni-full-h', `${fullOmnibarH}px`);
        chromeEl.style.setProperty('--reader-chrome-full-h', `${fullOmnibarH + planBarH}px`);
      }
    };

    syncStaticChromeMetrics();

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(syncStaticChromeMetrics);
      ro.observe(fullRowEl);
      return () => ro.disconnect();
    }
  }, [currentView, Boolean(planReadingSession)]);

  // Measure exact coordinates of the omnibar title text so the exact same element animates seamlessly to centered compact mode
  useLayoutEffect(() => {
    if (currentView !== 'reader') return;
    const headerEl = readerOmnibarRef.current;
    const anchorEl = fullTitleAnchorRef.current;
    if (!headerEl || !anchorEl) return;

    const syncLivingTitleMetrics = () => {
      const headerW = headerEl.offsetWidth;
      if (headerW <= 0) return;

      // Walk layout offsets (unaffected by CSS transforms on .reader-omnibar-full-layer)
      let left = 0;
      let top = 0;
      let node: HTMLElement | null = anchorEl;
      while (node && node !== headerEl && headerEl.contains(node)) {
        left += node.offsetLeft;
        top += node.offsetTop;
        node = node.offsetParent as HTMLElement | null;
      }

      const anchorW = anchorEl.offsetWidth;
      const anchorH = anchorEl.offsetHeight;
      if (anchorW <= 0 || anchorH <= 0) return;

      const isSmUp = window.matchMedia('(min-width: 640px)').matches;
      const compactBarH = isSmUp ? 44 : 40;
      const compactFontPx = isSmUp ? 16 : 14;
      const fullFontPx = parseFloat(window.getComputedStyle(anchorEl).fontSize) || (isSmUp ? 24 : 20);

      const maxCompactW = Math.max(120, headerW - (isSmUp ? 64 : 32));
      const scale = Math.min(compactFontPx / fullFontPx, maxCompactW / anchorW);

      const dx = headerW / 2 - (left + anchorW / 2);
      const dy = compactBarH / 2 - (top + anchorH / 2);

      const slotEl = anchorEl.parentElement;
      const slotMaxW = slotEl ? Math.max(0, slotEl.clientWidth - 4) : anchorW;

      headerEl.style.setProperty('--omni-title-left', `${left}px`);
      headerEl.style.setProperty('--omni-title-top', `${top}px`);
      headerEl.style.setProperty('--omni-title-h', `${anchorH}px`);
      headerEl.style.setProperty('--omni-title-max-w', `${slotMaxW}px`);
      headerEl.style.setProperty('--omni-title-dx', `${dx}px`);
      headerEl.style.setProperty('--omni-title-dy', `${dy}px`);
      headerEl.style.setProperty('--omni-title-scale', `${scale.toFixed(4)}`);
      headerEl.dataset.titleReady = 'true';
    };

    syncLivingTitleMetrics();

    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(syncLivingTitleMetrics);
      ro.observe(headerEl);
      ro.observe(anchorEl);
      if (anchorEl.parentElement) {
        ro.observe(anchorEl.parentElement);
      }
    } else {
      window.addEventListener('resize', syncLivingTitleMetrics, { passive: true });
    }

    let cancelled = false;
    if (document.fonts && typeof document.fonts.ready?.then === 'function') {
      document.fonts.ready.then(() => {
        if (!cancelled) syncLivingTitleMetrics();
      });
    }

    return () => {
      cancelled = true;
      ro?.disconnect();
      if (!ro) {
        window.removeEventListener('resize', syncLivingTitleMetrics);
      }
    };
  }, [currentView, currentLocationDisplayLabel, Boolean(command), Boolean(currentUser), currentUser?.fullName]);

  // Clear manual tap-expansion when upward scroll naturally restores omnibar, switching views, or changing chapter
  useEffect(() => {
    if (currentView !== 'reader' || isReaderOmnibarVisible) {
      setIsReaderOmnibarManuallyExpanded(false);
    }
  }, [currentView, isReaderOmnibarVisible, position.bookId, position.chapter]);

  // Collapse manually expanded omnibar once the user resumes scrolling downward
  useEffect(() => {
    if (currentView !== 'reader' || !isReaderOmnibarManuallyExpanded) return;

    const handleScrollCollapse = () => {
      const y = window.scrollY || 0;
      if (y < expandedScrollAnchorYRef.current) {
        expandedScrollAnchorYRef.current = y;
      }
      if (!isReaderOmnibarFocused && !isSuggestionsOpen && y - expandedScrollAnchorYRef.current >= 14) {
        setIsReaderOmnibarManuallyExpanded(false);
      }
    };

    window.addEventListener('scroll', handleScrollCollapse, { passive: true });
    return () => window.removeEventListener('scroll', handleScrollCollapse);
  }, [currentView, isReaderOmnibarManuallyExpanded, isReaderOmnibarFocused, isSuggestionsOpen]);

  const handleExpandCompactOmnibar = useCallback(() => {
    expandedScrollAnchorYRef.current = window.scrollY || 0;
    setIsReaderOmnibarManuallyExpanded(true);
  }, []);

  useEffect(() => {
    if (currentView !== 'reader' || !planReadingSession) {
      return;
    }

    let ticking = false;
    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
          if (maxScroll > 30) {
            const raw = Math.min(1, Math.max(0, window.scrollY / maxScroll));
            // Quantize to 2 decimal places to prevent re-rendering the whole component tree on every single pixel
            const fraction = Math.round(raw * 100) / 100;
            setChapterScrollProgress((prev) => (Math.abs(prev - fraction) >= 0.01 ? fraction : prev));
          } else {
            setChapterScrollProgress(1);
          }

          ticking = false;
        });
        ticking = true;
      }
    };

    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleScroll);
    };
  }, [currentView, planReadingSession, position.bookId, position.chapter, chapterData]);

  // Overall day reading progress percentage across assigned chapters + active scroll
  const planReadingProgressPercent = useMemo(() => {
    if (!planReadingSession) return 0;
    if (planReadingSession.isDayFinished) return 100;

    const total = planReadingSession.assignedChapters.length;
    if (total === 0) return 0;

    const currentIdx = Math.max(
      0,
      Math.min(total - 1, planReadingSession.currentChapterIndex)
    );

    const rawPercent = ((currentIdx + chapterScrollProgress) / total) * 100;
    return Math.min(100, Math.max(0, Number(rawPercent.toFixed(1))));
  }, [planReadingSession, chapterScrollProgress]);

  // Quick jump to assigned chapter via progress bar
  const handleJumpToPlanChapter = useCallback(
    (targetIndex: number) => {
      if (!planReadingSession) return;
      if (targetIndex < 0 || targetIndex >= planReadingSession.assignedChapters.length) return;
      const target = planReadingSession.assignedChapters[targetIndex];
      setPlanReadingSession((prev) =>
        prev ? { ...prev, currentChapterIndex: targetIndex } : null
      );
      navigateToPosition({ bookId: target.bookId, chapter: target.chapter });
    },
    [planReadingSession, navigateToPosition]
  );

  const displayedVerses = useMemo(() => {
    if (!chapterData) return [];
    if (
      !activePlanAssignedChapter ||
      activePlanAssignedChapter.startVerse === undefined ||
      activePlanAssignedChapter.endVerse === undefined
    ) {
      return chapterData.verses;
    }
    const canonicalCount = getChapterVerseCount(position.bookId, position.chapter);
    const coversToEnd = activePlanAssignedChapter.endVerse >= canonicalCount;
    const filtered = chapterData.verses.filter((v) => {
      const afterStart = v.verse >= activePlanAssignedChapter.startVerse!;
      const beforeEnd = coversToEnd || v.verse <= activePlanAssignedChapter.endVerse!;
      return afterStart && beforeEnd;
    });
    return filtered.length > 0 ? filtered : chapterData.verses;
  }, [chapterData, activePlanAssignedChapter, position.bookId, position.chapter]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const targetTag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      const isEditing = targetTag === 'input' || targetTag === 'textarea';

      if (((e.metaKey || e.ctrlKey) && e.key === 'k') || (!isEditing && e.key === '/')) {
        e.preventDefault();
        commandInputRef.current?.focus();
        commandInputRef.current?.select();
        return;
      }

      if (e.key === 'Escape') {
        if (copiedToast) {
          setCopiedToast(null);
          return;
        }
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
        setFocusedVerse(null);
        return;
      }

      if (!isEditing && (e.key === 't' || e.key === 'T')) {
        e.preventDefault();
        setTheme((prev) => (prev === 'parchment' ? 'white' : prev === 'white' ? 'black' : 'parchment'));
        return;
      }

      if (!isEditing && currentView === 'reader') {
        // Alt + Left / Alt + Right (or Cmd + [ / Cmd + ]) for history navigation
        if ((e.altKey && e.key === 'ArrowLeft') || ((e.metaKey || e.ctrlKey) && e.key === '[')) {
          e.preventDefault();
          handleHistoryBack();
          return;
        }
        if ((e.altKey && e.key === 'ArrowRight') || ((e.metaKey || e.ctrlKey) && e.key === ']')) {
          e.preventDefault();
          handleHistoryForward();
          return;
        }

        if (e.key === 'ArrowRight' || e.key === 'l') {
          if (planReadingSession) {
            handleNavigatePlanChapter('next');
          } else {
            const currentBook = getBookById(position.bookId);
            if (position.chapter < currentBook.chapterCount) {
              handleNavigateToChapter(position.bookId, position.chapter + 1);
            } else if (position.bookId < CANONICAL_BOOKS.length) {
              handleNavigateToChapter(position.bookId + 1, 1);
            }
          }
        } else if (e.key === 'ArrowLeft' || e.key === 'h') {
          if (planReadingSession) {
            handleNavigatePlanChapter('prev');
          } else if (position.chapter > 1) {
            handleNavigateToChapter(position.bookId, position.chapter - 1);
          } else if (position.bookId > 1) {
            const prevBook = getBookById(position.bookId - 1);
            handleNavigateToChapter(position.bookId - 1, prevBook.chapterCount);
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [copiedToast, currentView, position, planReadingSession, handleHistoryBack, handleHistoryForward, handleNavigateToChapter, handleNavigatePlanChapter]);

  const getNoteForVerse = (verse: number) => {
    return notes.find((n) => n.startVerse === verse);
  };

  const hasNoteForVerse = (verse: number) => {
    const note = getNoteForVerse(verse);
    return Boolean(note && note.content.trim().length > 0);
  };

  const readerFontFamilyClass =
    appearance.fontFamily === 'sans'
      ? 'font-sans'
      : appearance.fontFamily === 'mono'
      ? 'font-mono'
      : 'font-serif';

  const readerFontSizeClass =
    appearance.fontSize === 'sm'
      ? 'text-base sm:text-lg'
      : appearance.fontSize === 'lg'
      ? 'text-xl sm:text-2xl'
      : appearance.fontSize === 'xl'
      ? 'text-2xl sm:text-3xl'
      : 'text-lg sm:text-xl';

  const readerLineSpacingClass =
    appearance.lineSpacing === 'normal'
      ? 'leading-normal'
      : appearance.lineSpacing === 'relaxed'
      ? 'leading-relaxed'
      : 'leading-loose md:leading-loose';

  return (
    <div className={`min-h-screen w-full max-w-full bg-[var(--bg-app)] text-[var(--text-primary)] ${currentView === 'reader' ? readerFontFamilyClass : 'font-sans'}`}>
      {/* Dismissible Splash Install Elicitation Banner (hidden if already installed or dismissed) */}
      <SplashInstallBanner />

      {/* Sticky Reader Top Chrome: shrinks to book & chapter on downward scroll; expands on tap or upward scroll */}
      {currentView === 'reader' && (
        <div
          ref={readerChromeRef}
          className="sticky top-0 z-40 reader-omnibar-shell pointer-events-none"
        >
          <header
            ref={readerOmnibarRef}
            className={`relative z-20 reader-omnibar-header ${
              isReaderOmnibarFull ? 'is-expanded pointer-events-auto' : 'is-compact pointer-events-none'
            } ${
              isSuggestionsOpen && omnibarSuggestions.length > 0 ? 'has-suggestions' : ''
            }`}
          >
          {/* Isolated, transform-animated backdrop layer prevents layout reflow and Chromium blur flattening */}
          <div className="reader-omnibar-backdrop-frame" aria-hidden="true">
            <div
              className={`reader-omnibar-backdrop bg-[var(--bg-omnibar)] backdrop-blur-xl border-b ${
                !planReadingSession
                  ? `${isReaderScrolledPastTop || !isReaderOmnibarFull ? 'border-[var(--line-subtle)]/70' : 'border-[var(--line-subtle)]/40'} [box-shadow:var(--shadow-omnibar)]`
                  : 'border-transparent'
              }`}
            />
          </div>
          {/* Compact Shrunk Hit Area: full-width tap target to expand full omnibar */}
          <div
            className="reader-omnibar-compact-layer"
            aria-hidden={isReaderOmnibarFull}
          >
            <button
              type="button"
              tabIndex={isReaderOmnibarFull ? -1 : 0}
              onClick={handleExpandCompactOmnibar}
              className="w-full h-full max-w-7xl mx-auto cursor-pointer select-none focus:outline-none"
              title={`Tap to expand navigation (${currentLocationDisplayLabel})`}
              aria-label={`Expand navigation bar (${currentLocationDisplayLabel})`}
            />
          </div>

          {/* Full Omnibar & Features */}
          <div
            ref={readerFullRowRef}
            className={`reader-omnibar-full-layer pt-4 sm:pt-5 pb-4 px-4 sm:px-8 ${
              isReaderOmnibarFull ? 'pointer-events-auto' : 'pointer-events-none'
            }`}
            aria-hidden={!isReaderOmnibarFull}
          >
          <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
            <form onSubmit={handleCommandSubmit} className="flex-1 min-w-0 flex items-center gap-2 sm:gap-3 py-1">
              {/* Back Button (History Navigation - Left End of Search Bar) */}
              <button
                type="button"
                onClick={handleHistoryBack}
                disabled={!canGoBack}
                className={`text-[var(--text-subtle)] transition-[opacity,color] p-1.5 -ml-1 rounded focus:outline-none shrink-0 ${
                  canGoBack
                    ? 'opacity-60 hover:opacity-100 hover:text-[var(--text-primary)] cursor-pointer'
                    : 'opacity-20 cursor-not-allowed pointer-events-none'
                }`}
                title={canGoBack ? `Back to ${prevHistoryLabel}` : 'No previous history'}
                aria-label={canGoBack ? `Back to ${prevHistoryLabel}` : 'Back (no previous history)'}
              >
                <svg
                  className="w-5 h-5 sm:w-6 sm:h-6"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>

              {/* Native Scripture Book & Chapter Browser Trigger */}
              <div className="relative inline-flex items-center justify-center shrink-0">
                <button
                  type="button"
                  className="text-[var(--text-subtle)] opacity-60 hover:opacity-100 hover:text-[var(--text-primary)] transition-[opacity,color] p-1 cursor-pointer focus:outline-none"
                  title="Browse Scripture (Books & Chapters)"
                  aria-label="Browse Scripture books and chapters"
                >
                  <svg
                    className="w-5 h-5 sm:w-6 sm:h-6"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                  </svg>
                </button>
                <select
                  value={`${position.bookId}-${position.chapter}`}
                  onChange={(e) => {
                    const parts = e.target.value.split('-');
                    const bId = Number(parts[0]);
                    const ch = Number(parts[1]);
                    if (bId && ch) {
                      handleNavigateToChapter(bId, ch);
                    }
                  }}
                  className="absolute inset-0 opacity-0 w-full h-full cursor-pointer z-10 font-sans bg-[var(--bg-surface)] text-[var(--text-primary)]"
                  aria-label="Select book and chapter"
                >
                  {(() => {
                    const currentBook = getBookById(position.bookId);
                    if (!currentBook) return null;
                    return (
                      <optgroup label={`${currentBook.name} Chapters`} className="bg-[var(--bg-surface)] text-[var(--text-subtle)] font-sans">
                        {Array.from({ length: currentBook.chapterCount }, (_, i) => i + 1).map((ch) => (
                          <option key={`curr-${ch}`} value={`${position.bookId}-${ch}`} className="bg-[var(--bg-surface)] text-[var(--text-primary)] font-sans">
                            {currentBook.name} {ch}
                          </option>
                        ))}
                      </optgroup>
                    );
                  })()}
                  <optgroup label="Old Testament" className="bg-[var(--bg-surface)] text-[var(--text-subtle)] font-sans">
                    {CANONICAL_BOOKS.filter((b) => b.testament === 'OT').map((b) => (
                      <option key={b.id} value={`${b.id}-1`} className="bg-[var(--bg-surface)] text-[var(--text-primary)] font-sans">
                        {b.name} (1–{b.chapterCount})
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="New Testament" className="bg-[var(--bg-surface)] text-[var(--text-subtle)] font-sans">
                    {CANONICAL_BOOKS.filter((b) => b.testament === 'NT').map((b) => (
                      <option key={b.id} value={`${b.id}-1`} className="bg-[var(--bg-surface)] text-[var(--text-primary)] font-sans">
                        {b.name} (1–{b.chapterCount})
                      </option>
                    ))}
                  </optgroup>
                </select>
              </div>

              <div className="relative flex-1 min-w-0 flex items-center">
                <div className="relative flex-1 min-w-0 flex items-center">
                  <input
                    ref={commandInputRef}
                    type="text"
                    enterKeyHint="go"
                    tabIndex={isReaderOmnibarFull ? 0 : -1}
                    value={command}
                    onChange={(e) => {
                      const val = e.target.value;
                      setCommand(val);
                      setActiveSuggestionIndex(0);
                      setIsSuggestionsOpen(val.trim().length > 0);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        executeCommandSubmit();
                        return;
                      }
                      if (e.key === 'ArrowDown' && omnibarSuggestions.length > 0) {
                        e.preventDefault();
                        setActiveSuggestionIndex((prev) => (prev + 1) % omnibarSuggestions.length);
                        return;
                      }
                      if (e.key === 'ArrowUp' && omnibarSuggestions.length > 0) {
                        e.preventDefault();
                        setActiveSuggestionIndex(
                          (prev) => (prev - 1 + omnibarSuggestions.length) % omnibarSuggestions.length
                        );
                        return;
                      }
                      if (e.key === 'Escape') {
                        if (isSuggestionsOpen) {
                          e.preventDefault();
                          e.stopPropagation();
                          setIsSuggestionsOpen(false);
                        } else {
                          setCommand(currentLocationDisplayLabel);
                          commandInputRef.current?.blur();
                        }
                      }
                    }}
                    onFocus={() => setIsReaderOmnibarFocused(true)}
                    onBlur={() => {
                      setIsReaderOmnibarFocused(false);
                      setIsSuggestionsOpen(false);
                      if (!skipBlurResetRef.current) {
                        setCommand(currentLocationDisplayLabel);
                      }
                    }}
                    placeholder={currentLocationDisplayLabel}
                    className={`w-full bg-transparent border-none outline-none font-sans text-xl sm:text-2xl md:text-3xl font-semibold tracking-tight placeholder-[var(--input-placeholder)] py-1 pr-1 leading-normal select-text ${
                      !isReaderOmnibarFocused && command === currentLocationDisplayLabel
                        ? 'opacity-0'
                        : 'text-[var(--text-primary)] opacity-100'
                    }`}
                    autoComplete="off"
                    spellCheck={false}
                    role="combobox"
                    aria-expanded={isSuggestionsOpen && omnibarSuggestions.length > 0}
                    aria-controls="reader-omnibar-suggestions"
                    aria-activedescendant={
                      isSuggestionsOpen && omnibarSuggestions[activeSuggestionIndex]
                        ? `omnibar-option-${omnibarSuggestions[activeSuggestionIndex].id}`
                        : undefined
                    }
                    aria-autocomplete="list"
                    aria-label="Scripture navigation and search omnibar"
                  />
                  {/* Exact layout anchor for the shared living omnibar title */}
                  <span
                    ref={fullTitleAnchorRef}
                    aria-hidden="true"
                    className="absolute left-0 top-0 block max-w-[calc(100%-0.25rem)] py-1 font-sans text-xl sm:text-2xl md:text-3xl font-semibold tracking-tight leading-normal whitespace-nowrap truncate pointer-events-none select-none opacity-0"
                  >
                    {currentLocationDisplayLabel}
                  </span>
                </div>
                {/* Hidden submit control required by iOS WebKit so keyboard submit/[check] triggers form submission */}
                <button type="submit" tabIndex={-1} aria-hidden="true" className="sr-only">
                  Go
                </button>
                {command && (
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setCommand('');
                      setIsSuggestionsOpen(false);
                      setActiveSuggestionIndex(0);
                      commandInputRef.current?.focus();
                    }}
                    className="p-1 text-[var(--text-subtle)] hover:text-[var(--text-primary)] transition-colors cursor-pointer rounded-md shrink-0"
                    title="Clear search"
                    aria-label="Clear search"
                  >
                    <svg className="w-5 h-5 sm:w-6 sm:h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                )}

                {isSuggestionsOpen && omnibarSuggestions.length > 0 && (
                  <div
                    id="reader-omnibar-suggestions"
                    role="listbox"
                    aria-label="Scripture suggestions"
                    onMouseDown={(e) => e.preventDefault()}
                    className="absolute left-0 right-0 top-full mt-2 z-50 max-h-64 sm:max-h-72 overflow-y-auto overscroll-contain rounded-xl border border-[var(--line-subtle)] bg-[var(--bg-surface)] shadow-lg py-1"
                  >
                    {omnibarSuggestions.map((item, idx) => {
                      const isActive = idx === activeSuggestionIndex;
                      return (
                        <button
                          key={item.id}
                          id={`omnibar-option-${item.id}`}
                          type="button"
                          role="option"
                          aria-selected={isActive}
                          onMouseEnter={() => setActiveSuggestionIndex(idx)}
                          onClick={() => selectOmnibarSuggestion(item)}
                          className={`w-full px-3.5 py-2.5 flex items-center text-left font-sans transition-colors cursor-pointer ${
                            isActive
                              ? 'bg-[var(--bg-active)] text-[var(--text-primary)]'
                              : 'text-[var(--text-primary)] hover:bg-[var(--bg-active)]/60'
                          }`}
                        >
                          <span className="text-sm sm:text-base font-medium truncate">
                            {item.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Forward Button (History Navigation - Right End of Search Bar) */}
              <button
                type="button"
                onClick={handleHistoryForward}
                disabled={!canGoForward}
                className={`text-[var(--text-subtle)] transition-[opacity,color] p-1.5 rounded focus:outline-none shrink-0 ${
                  canGoForward
                    ? 'opacity-60 hover:opacity-100 hover:text-[var(--text-primary)] cursor-pointer'
                    : 'opacity-20 cursor-not-allowed pointer-events-none'
                }`}
                title={canGoForward ? `Forward to ${nextHistoryLabel}` : 'No forward history'}
                aria-label={canGoForward ? `Forward to ${nextHistoryLabel}` : 'Forward (no forward history)'}
              >
                <svg
                  className="w-5 h-5 sm:w-6 sm:h-6"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            </form>

            <div role="group" aria-label="Navigation and view modes" className="flex items-center gap-1.5 sm:gap-2 text-xs font-sans select-none shrink-0">
              {currentUser ? (
                <button
                  type="button"
                  onClick={() => setCurrentView('settings')}
                  className={`px-2.5 py-1 rounded-full text-xs font-sans font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
                    isOnline
                      ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20'
                      : 'text-yellow-700 dark:text-yellow-300 bg-yellow-500/15 hover:bg-yellow-500/25'
                  }`}
                  title={
                    isOnline
                      ? `Signed in as ${currentUser.email || 'User'}. Click to view account in Settings.`
                      : `Offline — not syncing to cloud (${currentUser.email || 'User'}). Changes save locally.`
                  }
                  aria-label={
                    isOnline
                      ? 'Account Settings'
                      : 'Account Settings (Offline, not syncing to cloud)'
                  }
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      isOnline ? 'bg-emerald-500' : 'bg-yellow-500'
                    }`}
                  />
                  <span className="hidden sm:inline max-w-[100px] truncate">{currentUser.fullName || currentUser.email?.split('@')[0] || 'Account'}</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsLoginSplashOpen(true)}
                  className="px-2.5 py-1 rounded-full text-xs font-sans font-medium text-[var(--text-subtle)] hover:text-[var(--text-primary)] hover:bg-[var(--text-primary)]/8 border border-[var(--line-subtle)]/70 transition-colors cursor-pointer flex items-center gap-1.5"
                  title="Sync across devices"
                  aria-label="Sync across devices"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                  </svg>
                  <span className="hidden sm:inline">Sync</span>
                </button>
              )}
            </div>
          </div>
          </div>

          {/* Single Shared Living Title: exact same text element shrinks and glides to centered compact mode */}
          <span
            aria-hidden="true"
            className={`reader-omnibar-living-title block py-1 font-sans text-xl sm:text-2xl md:text-3xl font-semibold tracking-tight leading-normal text-[var(--text-primary)] whitespace-nowrap truncate pointer-events-none select-none ${
              isReaderOmnibarFocused || command !== currentLocationDisplayLabel ? 'is-input-focused' : ''
            }`}
          >
            {currentLocationDisplayLabel}
          </span>
        </header>

          {/* Plan Mode Completion Bar: glides cleanly via transform beneath the omnibar */}
          {planReadingSession && (
            <div
              data-reader-plan-bar
              className="reader-plan-bar relative z-10 pointer-events-auto bg-[var(--bg-omnibar)] backdrop-blur-xl border-b border-[var(--line-subtle)]/70 [box-shadow:var(--shadow-omnibar)] px-4 sm:px-8 py-2 sm:py-2.5"
            >
          <div className="max-w-7xl mx-auto flex items-center justify-between gap-3 text-xs font-sans">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setCurrentView('plans')}
                className="text-[var(--text-subtle)] hover:text-[var(--text-primary)] transition-colors flex items-center gap-1 cursor-pointer shrink-0 font-medium"
                title="Return to Bible Reading Plans"
              >
                <span aria-hidden="true">←</span>
                <span>Plans</span>
              </button>

              <span aria-hidden="true" className="opacity-30">·</span>

              <span className="font-semibold text-[var(--text-primary)] truncate">
                {planReadingSession.planTitle} · Day {planReadingSession.dayNumber}
              </span>

              <span aria-hidden="true" className="opacity-30 hidden sm:inline">·</span>

              <span className="text-[var(--text-subtle)] hidden sm:inline truncate">
                Chapter {planReadingSession.currentChapterIndex + 1} of {planReadingSession.assignedChapters.length}
              </span>
            </div>

            {/* In-bar Reading Progress Bar & Interactive Chapter Scrubber */}
            <div className="hidden md:flex items-center gap-2.5 flex-1 max-w-[200px] lg:max-w-[260px] mx-2">
              <div
                role="progressbar"
                aria-valuenow={Math.round(planReadingProgressPercent)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Daily reading plan progress"
                className="flex-1 h-1.5 rounded-full bg-[var(--text-primary)]/15 overflow-hidden flex"
              >
                {planReadingSession.assignedChapters.length > 1 ? (
                  // Multi-chapter segmented track
                  planReadingSession.assignedChapters.map((ch, idx) => {
                    const isCompleted = idx < planReadingSession.currentChapterIndex || planReadingSession.isDayFinished;
                    const isCurrent = idx === planReadingSession.currentChapterIndex && !planReadingSession.isDayFinished;
                    const segmentWidth = 100 / planReadingSession.assignedChapters.length;

                    return (
                      <div
                        key={`${ch.bookId}-${ch.chapter}-${idx}`}
                        onClick={() => handleJumpToPlanChapter(idx)}
                        className={`h-full border-r last:border-r-0 border-[var(--bg-app)] cursor-pointer transition-colors ${
                          isCompleted
                            ? 'bg-emerald-600 dark:bg-emerald-400'
                            : isCurrent
                            ? 'bg-[var(--line-subtle)] relative overflow-hidden'
                            : 'bg-transparent'
                        }`}
                        style={{ width: `${segmentWidth}%` }}
                        title={`Jump to ${formatAssignedChapterLabel(ch)} (${idx + 1} of ${planReadingSession.assignedChapters.length})`}
                      >
                        {isCurrent && (
                          <div
                            className="h-full w-full origin-left bg-[var(--text-primary)] transition-transform duration-150 ease-out"
                            style={{ transform: `scaleX(${chapterScrollProgress})` }}
                          />
                        )}
                      </div>
                    );
                  })
                ) : (
                  // Single chapter smooth fill
                  <div
                    className={`h-full w-full origin-left rounded-full transition-transform duration-150 ease-out ${
                      planReadingSession.isDayFinished
                        ? 'bg-emerald-600 dark:bg-emerald-400'
                        : 'bg-[var(--text-primary)]'
                    }`}
                    style={{ transform: `scaleX(${Math.max(0, Math.min(1, planReadingProgressPercent / 100))})` }}
                  />
                )}
              </div>

              <span
                className={`text-[11px] font-sans tabular-nums shrink-0 ${
                  planReadingSession.isDayFinished
                    ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                    : 'text-[var(--text-subtle)]'
                }`}
              >
                {Math.round(planReadingProgressPercent)}%
              </span>
            </div>

            <div className="flex items-center gap-2.5 sm:gap-3 shrink-0">
              {/* Mobile reading progress percentage */}
              <span
                className={`text-[11px] font-sans tabular-nums md:hidden ${
                  planReadingSession.isDayFinished
                    ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                    : 'text-[var(--text-subtle)]'
                }`}
              >
                {Math.round(planReadingProgressPercent)}%
              </span>

              {planReadingSession.isDayFinished ? (
                <span className="text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
                  <span>✓ Day Finished</span>
                </span>
              ) : (
                <span className="text-[var(--text-subtle)] hidden lg:inline text-[11px] font-sans">
                  {planReadingSession.assignedChapters[planReadingSession.currentChapterIndex]?.displayRef}
                </span>
              )}

              <button
                type="button"
                onClick={() => setPlanReadingSession(null)}
                className="text-[var(--text-subtle)] hover:text-[var(--text-primary)] transition-colors underline cursor-pointer text-[11px]"
                title="Exit Plan Mode to browse freely"
              >
                Exit Plan Mode
              </button>
            </div>
          </div>

          {/* Sticky Top Reading Progress Bar Pinned Edge-to-Edge */}
          <div
            role="progressbar"
            aria-valuenow={Math.round(planReadingProgressPercent)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Daily reading progress bar"
            className="absolute bottom-0 left-0 right-0 h-[3px] bg-[var(--text-primary)]/15 overflow-hidden"
          >
            <div
              className={`h-full w-full origin-left transition-transform duration-150 ease-out ${
                planReadingSession.isDayFinished
                  ? 'bg-emerald-600 dark:bg-emerald-400'
                  : 'bg-[var(--text-primary)]'
              }`}
              style={{ transform: `scaleX(${Math.max(0, Math.min(1, planReadingProgressPercent / 100))})` }}
            />
          </div>
            </div>
          )}
        </div>
      )}

      {/* Sticky Header for Settings View */}
      {currentView === 'settings' && (
        <header className="sticky top-0 z-40 bg-[var(--bg-omnibar)] backdrop-blur-xl border-b border-[var(--line-subtle)]/70 [box-shadow:var(--shadow-omnibar)] pt-4 sm:pt-5 pb-4 px-4 sm:px-8">
          <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
            <div className="flex-1 min-w-0 flex items-center py-1">
              <h1 className="w-full font-sans text-xl sm:text-2xl md:text-3xl font-semibold tracking-tight text-[var(--text-primary)] py-1 m-0 leading-normal select-none truncate">
                Appearance & Reading
              </h1>
            </div>
          </div>
        </header>
      )}

      {/* Main Content Area */}
      {currentView === 'reader' && (
        <main className="max-w-7xl mx-auto px-4 sm:px-8 pt-4 sm:pt-6 md:pt-8 pb-28 sm:pb-32">
          {!isChapterReady || !chapterData ? (
            <ReaderViewSkeleton
              readerFontSizeClass={readerFontSizeClass}
              readerLineSpacingClass={readerLineSpacingClass}
            />
          ) : (
            <div className={`flex flex-col w-full pb-32 ${chapterLoadCount > 1 ? 'animate-fade-in' : ''}`}>
              {displayedVerses.map((v) => {
                const note = notesByVerse.get(v.verse);
                const hasNote = Boolean(note && note.content && note.content.trim().length > 0);
                const verseKey = `${position.bookId}:${position.chapter}:${v.verse}`;
                const isNoteActive = exposedNotes.has(verseKey);

                return (
                  <VerseRow
                    key={v.verse}
                    verse={v}
                    bookName={chapterData.bookName}
                    bookAbbr={getBookAbbreviation(position.bookId)}
                    chapter={chapterData.chapter}
                    noteContent={note?.content}
                    hasNote={hasNote}
                    isNoteActive={isNoteActive}
                    isFocused={focusedVerse === v.verse}
                    isMobile={isMobile}
                    readerFontSizeClass={readerFontSizeClass}
                    readerLineSpacingClass={readerLineSpacingClass}
                    onVerseRowClick={handleVerseRowClick}
                    onVerseNumberClick={handleVerseNumberClick}
                    onUpdateContent={handleNoteChange}
                    onDeleteNote={handleDeleteNoteForVerse}
                    onTokenClick={handleNoteTokenClick}
                  />
                );
              })}

              {/* Plan Mode Day Completion Footer (when reading inside a Plan) */}
              {planReadingSession && (
                <div
                  className="mt-16 pt-8 pb-4 border-t border-[var(--line-subtle)] flex items-center justify-between max-w-2xl lg:max-w-4xl mx-auto w-full select-none gap-4"
                >
                  <button
                    type="button"
                    onClick={() => setCurrentView('plans')}
                    className="inline-flex items-center gap-1.5 py-2 px-2.5 -ml-2 rounded hover:bg-[var(--text-primary)]/5 text-[var(--text-subtle)] hover:text-[var(--text-primary)] transition-colors cursor-pointer text-xs sm:text-sm font-sans"
                  >
                    <span aria-hidden="true">←</span>
                    <span>Back to Plan</span>
                  </button>

                  <div className={`text-center hidden sm:flex flex-col items-center ${readerFontFamilyClass}`}>
                    <span className="text-sm font-medium text-[var(--text-primary)]">
                      {activePlanAssignedChapter
                        ? formatAssignedChapterLabel(activePlanAssignedChapter)
                        : `${chapterData.bookName} ${chapterData.chapter}`}
                    </span>
                    <span className="text-[11px] font-sans text-[var(--text-subtle)]">
                      Day {planReadingSession.dayNumber} · Chapter {planReadingSession.currentChapterIndex + 1} of{' '}
                      {planReadingSession.assignedChapters.length}
                    </span>
                  </div>

                  {planReadingSession.currentChapterIndex >= planReadingSession.assignedChapters.length - 1 ? (
                    <button
                      type="button"
                      onClick={() => void handleFinishPlanDay()}
                      className={`inline-flex items-center gap-1.5 py-2 px-4 rounded-full transition-all cursor-pointer font-sans text-xs sm:text-sm font-semibold shadow-sm ${
                        planReadingSession.isDayFinished
                          ? 'bg-emerald-600 text-white dark:bg-emerald-500'
                          : 'bg-[var(--text-primary)] text-[var(--bg-app)] hover:opacity-90 active:scale-95'
                      }`}
                      title="Finish day reading"
                    >
                      <span>{planReadingSession.isDayFinished ? 'Finished ✓' : 'Finish Reading'}</span>
                    </button>
                  ) : (
                    <span className="text-xs font-sans text-[var(--text-subtle)]">
                      Chapter {planReadingSession.currentChapterIndex + 1} of {planReadingSession.assignedChapters.length}
                    </span>
                  )}
                </div>
              )}

              {/* NET Attribution Fine Print & About Modal Link */}
              <footer className="mt-12 sm:mt-16 md:mt-20 pt-6 border-t border-[var(--line-subtle)]/60 text-center font-sans">
                <p className="text-[11px] sm:text-xs text-[var(--text-subtle)] leading-relaxed max-w-2xl mx-auto">
                  Scripture text provided by the{' '}
                  <a
                    href="https://labs.bible.org"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-[var(--text-primary)] transition-colors"
                  >
                    NET Bible® API
                  </a>
                  . Quotations designated (NET) are from the NET Bible® copyright ©1996, 2019 by Biblical Studies Press, L.L.C.{' '}
                  (<a
                    href="http://netbible.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-[var(--text-primary)] transition-colors"
                  >
                    netbible.com
                  </a>
                  ). Quoted by permission. All rights reserved.
                </p>
                <div className="mt-2.5 flex items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => setIsAboutOpen(true)}
                    className="text-[11.5px] font-medium text-[var(--text-subtle)] hover:text-[var(--text-primary)] underline underline-offset-4 cursor-pointer transition-colors"
                  >
                    About Reneu
                  </button>
                </div>
              </footer>
            </div>
          )}
        </main>
      )}

      {currentView === 'plans' && (
        <Suspense fallback={<ReadingPlansViewSkeleton />}>
          <ReadingPlansView
            onNavigate={handleNavigateFromNotes}
            onStartPlanReading={handleStartPlanReading}
            onPlanProgressChange={handlePlanProgressChange}
            initialDayNumber={planReadingSession?.dayNumber}
            fontFamily={appearance.fontFamily}
          />
        </Suspense>
      )}

      {currentView === 'notes' && (
        <Suspense fallback={<NotesViewSkeleton />}>
          <AllNotesView
            onNavigate={handleNavigateFromNotes}
            isComposingPlainNote={isComposingPlainNote}
            onToggleComposePlainNote={setIsComposingPlainNote}
          />
        </Suspense>
      )}

      {currentView === 'settings' && (
        <Suspense fallback={<SettingsViewSkeleton />}>
          <SettingsView
            settings={appearance}
            onUpdateSettings={handleUpdateAppearance}
            onNavigateToReader={() => setCurrentView('reader')}
            onOpenLoginSplash={() => setIsLoginSplashOpen(true)}
          />
        </Suspense>
      )}

      {/* Full-width dock on mobile when not in Notes; room for Add Note button in Notes; compact centered/anchored on tablet+ */}
      <div className="fixed bottom-4 sm:bottom-6 inset-x-0 z-50 flex items-center justify-center pointer-events-none select-none px-4 sm:px-6 md:px-8">
        <div className="relative flex items-center justify-between md:justify-start w-full lg:w-auto">
        {/* Navigation Dock Wrapper */}
        <div
          className={`relative dock-nav-transition dock-nav-animated md:w-auto shrink-0 ${
            currentView === 'notes'
              ? 'w-[calc(100%-4.75rem)] dock-anchored-left'
              : 'w-full dock-centered'
          }`}
        >
          {/* Floating Previous / Next Chapter Circular Buttons: stay visible at any scroll state in Reader view */}
          {(() => {
            const canShowChapterArrows = currentView === 'reader' && isChapterReady;
            const isDockHidden = currentView === 'reader' && !isReaderOmnibarVisible;
            const prevChapterBtn = planReadingSession
              ? planReadingSession.currentChapterIndex > 0
                ? {
                    onClick: () => handleNavigatePlanChapter('prev'),
                    title: `Previous: ${formatAssignedChapterLabel(planReadingSession.assignedChapters[planReadingSession.currentChapterIndex - 1])}`,
                    ariaLabel: `Previous reading (${formatAssignedChapterLabel(planReadingSession.assignedChapters[planReadingSession.currentChapterIndex - 1])})`,
                  }
                : null
              : prevChapterTarget
              ? {
                  onClick: () => handleNavigateToChapter(prevChapterTarget.bookId, prevChapterTarget.chapter),
                  title: `Previous: ${prevChapterTarget.label}`,
                  ariaLabel: `Previous chapter (${prevChapterTarget.label})`,
                }
              : null;

            const nextChapterBtn = planReadingSession
              ? planReadingSession.currentChapterIndex < planReadingSession.assignedChapters.length - 1
                ? {
                    onClick: () => handleNavigatePlanChapter('next'),
                    title: `Next: ${formatAssignedChapterLabel(planReadingSession.assignedChapters[planReadingSession.currentChapterIndex + 1])}`,
                    ariaLabel: `Next reading (${formatAssignedChapterLabel(planReadingSession.assignedChapters[planReadingSession.currentChapterIndex + 1])})`,
                  }
                : null
              : nextChapterTarget
              ? {
                  onClick: () => handleNavigateToChapter(nextChapterTarget.bookId, nextChapterTarget.chapter),
                  title: `Next: ${nextChapterTarget.label}`,
                  ariaLabel: `Next chapter (${nextChapterTarget.label})`,
                }
              : null;

            return (
              <div
                className="reader-chapter-arrows absolute bottom-full left-0 right-0 mb-2.5 sm:mb-3 flex items-center justify-between pointer-events-none"
                aria-hidden={!canShowChapterArrows}
              >
                <div>
                  {prevChapterBtn && (
                    <button
                      type="button"
                      tabIndex={canShowChapterArrows ? 0 : -1}
                      onClick={prevChapterBtn.onClick}
                      title={prevChapterBtn.title}
                      aria-label={prevChapterBtn.ariaLabel}
                      className={`reader-chapter-arrow-btn ${
                        isDockHidden ? 'is-dock-hidden' : ''
                      } ${
                        canShowChapterArrows ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
                      } w-11 h-11 sm:w-12 sm:h-12 rounded-full border border-[var(--line-subtle)] bg-[var(--bg-dock)] backdrop-blur-xl [box-shadow:var(--shadow-dock)] flex items-center justify-center text-[var(--text-primary)] hover:bg-[var(--text-primary)] hover:text-[var(--bg-app)] hover:border-[var(--text-primary)] hover:scale-105 active:scale-95 cursor-pointer group`}
                    >
                      <svg
                        className="w-5 h-5 transition-transform group-hover:-translate-x-0.5"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <line x1="19" y1="12" x2="5" y2="12" />
                        <polyline points="12 19 5 12 12 5" />
                      </svg>
                    </button>
                  )}
                </div>

                <div>
                  {nextChapterBtn && (
                    <button
                      type="button"
                      tabIndex={canShowChapterArrows ? 0 : -1}
                      onClick={nextChapterBtn.onClick}
                      title={nextChapterBtn.title}
                      aria-label={nextChapterBtn.ariaLabel}
                      className={`reader-chapter-arrow-btn ${
                        isDockHidden ? 'is-dock-hidden' : ''
                      } ${
                        canShowChapterArrows ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
                      } w-11 h-11 sm:w-12 sm:h-12 rounded-full border border-[var(--line-subtle)] bg-[var(--bg-dock)] backdrop-blur-xl [box-shadow:var(--shadow-dock)] flex items-center justify-center text-[var(--text-primary)] hover:bg-[var(--text-primary)] hover:text-[var(--bg-app)] hover:border-[var(--text-primary)] hover:scale-105 active:scale-95 cursor-pointer group`}
                    >
                      <svg
                        className="w-5 h-5 transition-transform group-hover:translate-x-0.5"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <line x1="5" y1="12" x2="19" y2="12" />
                        <polyline points="12 5 19 12 12 19" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            );
          })()}

          <nav
            aria-label="App navigation"
            aria-hidden={currentView === 'reader' && !isReaderOmnibarVisible}
            data-active-tab={activeDockIndex}
            className={`relative w-full pointer-events-auto font-sans h-16 p-1.5 flex items-center gap-[var(--dock-gap)] rounded-full border border-[var(--line-subtle)] bg-[var(--bg-dock)] backdrop-blur-xl [box-shadow:var(--shadow-dock)] dock-bottom-chrome ${
              currentView === 'reader' && !isReaderOmnibarVisible ? 'is-dock-hidden' : ''
            }`}
          >
          {/* Active Background Indicator Track (pure compositor CSS transform transition glides cleanly across viewports) */}
          <div className="dock-indicator-track absolute inset-1.5 pointer-events-none" aria-hidden="true">
            <div
              className="dock-indicator-pill absolute top-0 h-[50px] rounded-full bg-[var(--text-primary)] shadow-sm"
            />
          </div>

          <button
            type="button"
            tabIndex={currentView === 'reader' && !isReaderOmnibarVisible ? -1 : 0}
            onClick={() => handleSelectTab('reader')}
            className={`dock-nav-item relative z-10 min-w-0 flex-1 md:flex-none md:w-[72px] h-[50px] px-1 md:px-3.5 rounded-full font-sans inline-flex flex-col items-center justify-center gap-0.5 cursor-pointer hover:scale-105 active:scale-95 ${
              currentView === 'reader'
                ? 'text-[var(--bg-app)]'
                : 'text-[var(--text-subtle)] hover:text-[var(--text-primary)] hover:bg-[var(--text-primary)]/5'
            }`}
            title="Reader"
            aria-label="Reader"
            aria-current={currentView === 'reader' ? 'page' : undefined}
          >
            <svg
              className="w-5 h-5 sm:w-5 sm:h-5 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
              <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
            </svg>
            <span className="font-sans text-[9px] sm:text-[9.5px] font-medium leading-none tracking-normal">
              Reader
            </span>
          </button>

          <button
            type="button"
            tabIndex={currentView === 'reader' && !isReaderOmnibarVisible ? -1 : 0}
            onClick={() => handleSelectTab('notes')}
            className={`dock-nav-item relative z-10 min-w-0 flex-1 md:flex-none md:w-[72px] h-[50px] px-1 md:px-3.5 rounded-full font-sans inline-flex flex-col items-center justify-center gap-0.5 cursor-pointer hover:scale-105 active:scale-95 ${
              currentView === 'notes'
                ? 'text-[var(--bg-app)]'
                : 'text-[var(--text-subtle)] hover:text-[var(--text-primary)] hover:bg-[var(--text-primary)]/5'
            }`}
            title="Notes"
            aria-label="Notes"
            aria-current={currentView === 'notes' ? 'page' : undefined}
          >
            <svg
              className="w-5 h-5 sm:w-5 sm:h-5 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
            <span className="font-sans text-[9px] sm:text-[9.5px] font-medium leading-none tracking-normal">
              Notes
            </span>
          </button>

          <button
            type="button"
            tabIndex={currentView === 'reader' && !isReaderOmnibarVisible ? -1 : 0}
            onClick={() => handleSelectTab('plans')}
            className={`dock-nav-item relative z-10 min-w-0 flex-1 md:flex-none md:w-[72px] h-[50px] px-1 md:px-3.5 rounded-full font-sans inline-flex flex-col items-center justify-center gap-0.5 cursor-pointer hover:scale-105 active:scale-95 ${
              currentView === 'plans'
                ? 'text-[var(--bg-app)]'
                : 'text-[var(--text-subtle)] hover:text-[var(--text-primary)] hover:bg-[var(--text-primary)]/5'
            }`}
            title="Reading Plans"
            aria-label="Reading Plans"
            aria-current={currentView === 'plans' ? 'page' : undefined}
          >
            <svg
              className="w-5 h-5 sm:w-5 sm:h-5 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
              <path d="m9 16 2 2 4-4" />
            </svg>
            <span className="font-sans text-[9px] sm:text-[9.5px] font-medium leading-none tracking-normal">
              Plans
            </span>
          </button>

          <button
            type="button"
            tabIndex={currentView === 'reader' && !isReaderOmnibarVisible ? -1 : 0}
            onClick={() => handleSelectTab('settings')}
            className={`dock-nav-item relative z-10 min-w-0 flex-1 md:flex-none md:w-[72px] h-[50px] px-1 md:px-3.5 rounded-full font-sans inline-flex flex-col items-center justify-center gap-0.5 cursor-pointer hover:scale-105 active:scale-95 ${
              currentView === 'settings'
                ? 'text-[var(--bg-app)]'
                : 'text-[var(--text-subtle)] hover:text-[var(--text-primary)] hover:bg-[var(--text-primary)]/5'
            }`}
            title="Appearance & Typography Settings"
            aria-label="Settings"
            aria-current={currentView === 'settings' ? 'page' : undefined}
          >
            <svg
              className="w-5 h-5 sm:w-5 sm:h-5 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            <span className="font-sans text-[9px] sm:text-[9.5px] font-medium leading-none tracking-normal">
              Settings
            </span>
          </button>
          </nav>
        </div>

        {/* Animated Add Note Button (Pure compositor transform + opacity across all viewports) */}
        <div
          className={`dock-action-wrapper overflow-visible flex items-center justify-center shrink-0 absolute inset-y-0 right-0 w-16 ml-0 lg:right-auto lg:left-full lg:ml-4 ${
            currentView === 'notes' ? 'is-open' : 'is-closed'
          }`}
          aria-hidden={currentView !== 'notes'}
        >
          <button
            type="button"
            tabIndex={currentView === 'notes' ? 0 : -1}
            onClick={() => {
              setIsComposingPlainNote((prev) => !prev);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className={`w-16 h-16 shrink-0 rounded-full border backdrop-blur-xl [box-shadow:var(--shadow-dock)] flex items-center justify-center transition-[transform,background-color,color,border-color] duration-200 cursor-pointer hover:scale-105 active:scale-95 ${
              isComposingPlainNote
                ? 'bg-[var(--text-primary)]/90 text-[var(--bg-app)] border-[var(--text-primary)]'
                : 'border-[var(--line-subtle)] bg-[var(--bg-dock)] text-[var(--text-primary)] hover:bg-[var(--text-primary)] hover:text-[var(--bg-app)] hover:border-[var(--text-primary)]'
            }`}
            title={isComposingPlainNote ? 'Close new note' : 'New note'}
            aria-label="Add new note"
          >
            <svg
              className={`w-5 h-5 sm:w-6 sm:h-6 transition-transform duration-300 ${
                isComposingPlainNote ? 'rotate-45' : ''
              }`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.25"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>
        </div>
      </div>

      {/* Toast confirming verse reference copied to clipboard (smooth in/out animation) */}
      <CopiedToast
        toast={copiedToast}
        onDismiss={handleDismissToast}
      />

      {/* Log-In Splash Page (Accessible upon logged-out visit, ?login=true, Settings, or Header trigger) */}
      {isLoginSplashOpen && (
        <Suspense fallback={null}>
          <LoginSplash
            isOpen={isLoginSplashOpen}
            onClose={() => setIsLoginSplashOpen(false)}
            onContinueAsGuest={handleContinueAsGuest}
            onAuthenticated={handleAuthenticated}
          />
        </Suspense>
      )}

      {/* About & Attribution Modal */}
      <AboutModal
        isOpen={isAboutOpen}
        onClose={() => setIsAboutOpen(false)}
      />

      {/* Confirmation Prompt before soft-deleting a verse note */}
      <ConfirmModal
        isOpen={pendingDeleteVerse !== null}
        onClose={() => setPendingDeleteVerse(null)}
        onConfirm={handleConfirmDeleteVerseNote}
        title="Delete note?"
        message={
          pendingDeleteVerse !== null && chapterData
            ? `Move your note on ${chapterData.bookName} ${chapterData.chapter}:${pendingDeleteVerse} to Deleted notes? It will be excluded from search and Intelligent Summaries, and retained for 30 days before permanent removal.`
            : 'Move this note to Deleted notes? It will be retained for 30 days before permanent removal.'
        }
        confirmLabel="Delete Note"
      />
    </div>
  );
};

export default App;
