import React, { useState, useEffect } from 'react';
import type { AppearanceSettings, ThemeMode, FontFamily, FontSize, LineSpacing } from '../types/bible';
import {
  getGeminiApiKey,
  saveGeminiApiKey,
  testGeminiApiKey,
  syncAllWithCloud,
  getLastSyncedTime,
  signOutUser,
  getCurrentUser,
  onAuthStateChange,
  type SupabaseUserProfile,
} from '../services/bibleStorage';
import { usePWAInstall } from '../utils/usePWAInstall';
import { usePWAUpdate } from '../utils/usePWAUpdate';
import { Modal } from './Modal';
import { ConfirmModal } from './ConfirmModal';
import { AboutModal } from './AboutModal';
import { PWAInstructionsModal } from './PWAInstructionsModal';
import { ApiKeyInstructionsModal } from './ApiKeyInstructionsModal';
import { PrivacyPolicyModal } from './PrivacyPolicyModal';
import { LicenseWarrantyModal } from './LicenseWarrantyModal';

interface SettingsViewProps {
  settings: AppearanceSettings;
  onUpdateSettings: (newSettings: AppearanceSettings) => void;
  onNavigateToReader?: () => void;
  onOpenLoginSplash?: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  onUpdateSettings,
  onNavigateToReader,
  onOpenLoginSplash,
}) => {
  const [apiKey, setApiKey] = useState<string>('');
  const [showApiKey, setShowApiKey] = useState<boolean>(false);
  const [isSavedRecently, setIsSavedRecently] = useState<boolean>(false);
  const [isTestingKey, setIsTestingKey] = useState<boolean>(false);
  const [keyTestFeedback, setKeyTestFeedback] = useState<{ success: boolean; message: string } | null>(null);
  const [isAboutOpen, setIsAboutOpen] = useState<boolean>(false);
  const [isApiKeyGuideOpen, setIsApiKeyGuideOpen] = useState<boolean>(false);
  const [isPrivacyOpen, setIsPrivacyOpen] = useState<boolean>(false);
  const [isLicenseOpen, setIsLicenseOpen] = useState<boolean>(false);

  const [activeDetailModal, setActiveDetailModal] = useState<
    'summaries' | 'install' | 'updates' | 'sync' | null
  >(null);

  // Cloud Sync & Multi-User State
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);
  const [lastSyncDisplay, setLastSyncDisplay] = useState<string | null>(() => getLastSyncedTime());

  // User Account State
  const [currentUser, setCurrentUser] = useState<SupabaseUserProfile | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(false);
  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    onConfirm: () => void | Promise<void>;
  } | null>(null);
  const [isConfirmLoading, setIsConfirmLoading] = useState<boolean>(false);

  useEffect(() => {
    let mounted = true;
    getCurrentUser().then((u) => {
      if (mounted) setCurrentUser(u);
    });
    const unsubscribe = onAuthStateChange((u) => {
      if (mounted) setCurrentUser(u);
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const handleSignOut = async () => {
    setAuthLoading(true);
    try {
      await signOutUser();
      setCurrentUser(null);
      setSyncFeedback('Signed out. Notes will continue saving locally on this device.');
      setTimeout(() => setSyncFeedback(null), 4000);
    } catch (err: any) {
      setSyncFeedback(err?.message || 'Sign out failed.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleManualSync = async () => {
    setIsSyncing(true);
    setSyncFeedback(null);
    try {
      const res = await syncAllWithCloud();
      if (res.success) {
        setSyncFeedback(`Synced successfully! ${res.notesPushed} pushed, ${res.notesPulled} pulled.`);
        setLastSyncDisplay(getLastSyncedTime());
      } else {
        setSyncFeedback(`Sync failed: ${res.error || 'Check network connection'}`);
      }
    } catch (err: any) {
      setSyncFeedback(`Sync error: ${err?.message || 'Unknown error'}`);
    } finally {
      setIsSyncing(false);
      setTimeout(() => setSyncFeedback(null), 5000);
    }
  };

  const {
    updateStatus,
    hasUpdate,
    isChecking,
    lastCheckedTime,
    appVersion,
    isStandalone,
    checkForUpdate,
    applyUpdate,
  } = usePWAUpdate();

  const {
    deferredPrompt,
    isInstalled: isPWAInstalled,
    platform: pwaPlatform,
    formFactor: pwaFormFactor,
    browser: pwaBrowser,
    install: triggerPWAInstall,
  } = usePWAInstall();

  const isAppInstalled = isStandalone || isPWAInstalled;

  const [instructionModal, setInstructionModal] = useState<{
    isOpen: boolean;
    mode: 'install' | 'uninstall';
  }>({
    isOpen: false,
    mode: 'install',
  });

  useEffect(() => {
    let mounted = true;
    getGeminiApiKey().then((saved) => {
      if (mounted) setApiKey(saved);
    });
    return () => {
      mounted = false;
    };
  }, []);

  // Close About overlay on Escape key
  useEffect(() => {
    if (!isAboutOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsAboutOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isAboutOpen]);

  const handleApiKeyChange = (val: string) => {
    setApiKey(val);
    setKeyTestFeedback(null);
    void saveGeminiApiKey(val);
    setIsSavedRecently(true);
    setTimeout(() => setIsSavedRecently(false), 2000);
  };

  const handleTestApiKey = async () => {
    if (!apiKey || apiKey.trim().length === 0) {
      setKeyTestFeedback({ success: false, message: 'Please enter a Gemini API key first.' });
      return;
    }
    setIsTestingKey(true);
    setKeyTestFeedback(null);
    try {
      const result = await testGeminiApiKey(apiKey);
      setKeyTestFeedback({
        success: result.success,
        message: result.message,
      });
    } catch (err: any) {
      setKeyTestFeedback({
        success: false,
        message: err?.message || 'Verification test failed.',
      });
    } finally {
      setIsTestingKey(false);
    }
  };
  const handleThemeChange = (theme: ThemeMode) => {
    onUpdateSettings({ ...settings, theme });
  };

  const handleFontFamilyChange = (fontFamily: FontFamily) => {
    onUpdateSettings({ ...settings, fontFamily });
  };

  const handleFontSizeChange = (fontSize: FontSize) => {
    onUpdateSettings({ ...settings, fontSize });
  };

  const handleLineSpacingChange = (lineSpacing: LineSpacing) => {
    onUpdateSettings({ ...settings, lineSpacing });
  };

  const handleReset = () => {
    onUpdateSettings({
      theme: 'parchment',
      fontFamily: 'serif',
      fontSize: 'base',
      lineSpacing: 'loose',
    });
  };

  // Preview styling classes
  const getPreviewFontFamilyClass = () => {
    switch (settings.fontFamily) {
      case 'sans':
        return 'font-sans';
      case 'mono':
        return 'font-mono';
      case 'serif':
      default:
        return 'font-serif';
    }
  };

  const getPreviewFontSizeClass = () => {
    switch (settings.fontSize) {
      case 'sm':
        return 'text-base sm:text-lg';
      case 'lg':
        return 'text-xl sm:text-2xl';
      case 'xl':
        return 'text-2xl sm:text-3xl';
      case 'base':
      default:
        return 'text-lg sm:text-xl';
    }
  };

  const getPreviewLineSpacingClass = () => {
    switch (settings.lineSpacing) {
      case 'normal':
        return 'leading-normal';
      case 'relaxed':
        return 'leading-relaxed';
      case 'loose':
      default:
        return 'leading-loose';
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto px-6 sm:px-8 pt-8 md:pt-12 pb-36 md:pb-48 selection:bg-[var(--text-selection)] animate-fade-in min-h-screen font-sans">
      <div className="flex flex-col gap-10">
        {/* Section 1: Color Themes */}
        <section className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <h2 className="font-sans text-xs font-semibold uppercase tracking-wider text-[var(--text-subtle)]">
              Theme
            </h2>
            <span className="font-sans text-xs text-[var(--text-subtle)] opacity-60 capitalize">
              Active: {settings.theme}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {[
              { id: 'parchment', label: 'Parchment', swatchBg: '#f5efeb', swatchBorder: '#ded3c4' },
              { id: 'white', label: 'White', swatchBg: '#ffffff', swatchBorder: '#e5e7eb' },
              { id: 'black', label: 'Obsidian', swatchBg: '#111113', swatchBorder: '#2c2c34' },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => handleThemeChange(t.id as ThemeMode)}
                className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded border transition-colors cursor-pointer text-xs font-sans ${
                  settings.theme === t.id
                    ? 'border-[var(--text-primary)] bg-[var(--text-primary)]/5 font-semibold text-[var(--text-primary)]'
                    : 'border-[var(--line-subtle)] text-[var(--text-subtle)] hover:border-[var(--text-primary)]/40 hover:text-[var(--text-primary)]'
                }`}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0 border"
                  style={{ backgroundColor: t.swatchBg, borderColor: t.swatchBorder }}
                />
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        </section>

        {/* Section 2: Font Family */}
        <section className="flex flex-col gap-3 pt-4 border-t border-[var(--line-subtle)]">
          <div className="flex items-baseline justify-between">
            <h2 className="font-sans text-xs font-semibold uppercase tracking-wider text-[var(--text-subtle)]">
              Typeface
            </h2>
            <span className="font-sans text-xs text-[var(--text-subtle)] opacity-60 capitalize">
              Active: {settings.fontFamily}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2 sm:gap-3 w-full">
            {[
              { id: 'serif', label: 'Serif', specimen: 'Ag', fontClass: 'font-serif' },
              { id: 'sans', label: 'Sans', specimen: 'Ag', fontClass: 'font-sans' },
              { id: 'mono', label: 'Mono', specimen: 'Ag', fontClass: 'font-mono' },
            ].map((font) => (
              <button
                key={font.id}
                type="button"
                onClick={() => handleFontFamilyChange(font.id as FontFamily)}
                className={`flex flex-col items-center justify-center py-3 px-2 sm:py-5 sm:px-4 rounded-lg border transition-all cursor-pointer text-center min-w-0 w-full ${
                  settings.fontFamily === font.id
                    ? 'border-[var(--text-primary)] bg-[var(--text-primary)]/5 font-semibold text-[var(--text-primary)]'
                    : 'border-[var(--line-subtle)] text-[var(--text-subtle)] hover:border-[var(--text-primary)]/40 hover:text-[var(--text-primary)]'
                }`}
              >
                <span className={`${font.fontClass} text-3xl sm:text-4xl md:text-5xl font-medium text-[var(--text-primary)] mb-1 sm:mb-2 leading-none`}>
                  {font.specimen}
                </span>
                <span className={`${font.fontClass} text-xs sm:text-sm tracking-tight truncate w-full`}>
                  {font.label}
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* Section 3: Font Size */}
        <section className="flex flex-col gap-3 pt-4 border-t border-[var(--line-subtle)]">
          <div className="flex items-baseline justify-between">
            <h2 className="font-sans text-xs font-semibold uppercase tracking-wider text-[var(--text-subtle)]">
              Font Size
            </h2>
            <span className="font-sans text-xs text-[var(--text-subtle)] opacity-70">
              {settings.fontSize === 'base'
                ? 'Standard (18–20px)'
                : settings.fontSize === 'sm'
                ? 'Compact (16–18px)'
                : settings.fontSize === 'lg'
                ? 'Large (20–24px)'
                : 'Extra (24–30px)'}
            </span>
          </div>

          <div className="grid grid-cols-4 gap-2">
            {[
              { id: 'sm', label: 'Compact', note: '16px' },
              { id: 'base', label: 'Standard', note: '18px' },
              { id: 'lg', label: 'Large', note: '20px' },
              { id: 'xl', label: 'Extra', note: '24px' },
            ].map((size) => (
              <button
                key={size.id}
                type="button"
                onClick={() => handleFontSizeChange(size.id as FontSize)}
                className={`flex flex-col items-center justify-center py-3 px-2 rounded border transition-colors cursor-pointer text-center ${
                  settings.fontSize === size.id
                    ? 'border-[var(--text-primary)] bg-[var(--text-primary)]/5 font-semibold text-[var(--text-primary)]'
                    : 'border-[var(--line-subtle)] text-[var(--text-subtle)] hover:border-[var(--text-primary)]/40 hover:text-[var(--text-primary)]'
                }`}
              >
                <span className="font-sans text-xs">{size.label}</span>
                <span className="font-sans text-xs opacity-60">{size.note}</span>
              </button>
            ))}
          </div>
        </section>

        {/* Section 4: Line Spacing */}
        <section className="flex flex-col gap-3 pt-4 border-t border-[var(--line-subtle)]">
          <div className="flex items-baseline justify-between">
            <h2 className="font-sans text-xs font-semibold uppercase tracking-wider text-[var(--text-subtle)]">
              Line Spacing
            </h2>
            <span className="font-sans text-xs text-[var(--text-subtle)] opacity-60 capitalize">
              {settings.lineSpacing}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {[
              { id: 'normal', label: 'Compact', desc: 'Dense study' },
              { id: 'relaxed', label: 'Relaxed', desc: 'Balanced rhythm' },
              { id: 'loose', label: 'Spacious', desc: 'Meditative pace' },
            ].map((spacing) => (
              <button
                key={spacing.id}
                type="button"
                onClick={() => handleLineSpacingChange(spacing.id as LineSpacing)}
                className={`flex flex-col items-center justify-center py-3 px-2 rounded border transition-colors cursor-pointer text-center ${
                  settings.lineSpacing === spacing.id
                    ? 'border-[var(--text-primary)] bg-[var(--text-primary)]/5 font-semibold text-[var(--text-primary)]'
                    : 'border-[var(--line-subtle)] text-[var(--text-subtle)] hover:border-[var(--text-primary)]/40 hover:text-[var(--text-primary)]'
                }`}
              >
                <span className="font-sans text-xs">{spacing.label}</span>
                <span className="font-sans text-xs opacity-60">{spacing.desc}</span>
              </button>
            ))}
          </div>
        </section>

        {/* Section 5: Live Scripture Sample Preview */}
        <section className="flex flex-col gap-3 pt-4 border-t border-[var(--line-subtle)]">
          <h2 className="font-sans text-xs font-semibold uppercase tracking-wider text-[var(--text-subtle)]">
            Live Preview
          </h2>

          <div className="p-5 sm:p-6 rounded-xl border border-[var(--line-subtle)] bg-[var(--bg-surface)] shadow-xs transition-colors">
            <div className="flex items-center justify-between text-xs text-[var(--text-subtle)] font-sans pb-3 mb-3 border-b border-[var(--line-subtle)]">
              <span>John 1:1</span>
              <span>NET Bible</span>
            </div>

            <p
              className={`${getPreviewFontFamilyClass()} ${getPreviewFontSizeClass()} ${getPreviewLineSpacingClass()} text-[var(--text-primary)] transition-all`}
            >
              <span className="font-sans text-xs text-[var(--text-subtle)] mr-2 select-none">1</span>
              In the beginning was the Word, and the Word was with God, and the Word was fully God.
            </p>
          </div>
        </section>

        {/* Progressive Disclosure Settings List */}
        <section
          aria-label="Application Settings"
          className="flex flex-col border-t border-b border-[var(--line-subtle)] divide-y divide-[var(--line-subtle)]"
        >
          {[
            { id: 'summaries' as const, label: 'Intelligent Summaries' },
            { id: 'install' as const, label: 'Installed As App' },
            { id: 'updates' as const, label: 'App Software Updates' },
            { id: 'sync' as const, label: 'Cloud Sync' },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveDetailModal(item.id)}
              className="w-full flex items-center justify-between py-4 text-left font-sans text-sm font-medium text-[var(--text-primary)] hover:text-[var(--text-subtle)] transition-colors cursor-pointer group"
            >
              <span>{item.label}</span>
              <svg
                className="w-4 h-4 text-[var(--text-subtle)] group-hover:text-[var(--text-primary)] group-hover:translate-x-0.5 transition-all shrink-0"
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
          ))}
        </section>

        {/* Legal, About & Defaults */}
        <section
          aria-label="Information and Defaults"
          className="flex flex-col border-t border-b border-[var(--line-subtle)] divide-y divide-[var(--line-subtle)]"
        >
          {[
            {
              id: 'about',
              label: 'About Reneu',
              onClick: () => setIsAboutOpen(true),
            },
            {
              id: 'privacy',
              label: 'Privacy Policy',
              onClick: () => setIsPrivacyOpen(true),
            },
            {
              id: 'license',
              label: 'License & Warranty',
              onClick: () => setIsLicenseOpen(true),
            },
            {
              id: 'reset',
              label: 'Reset to Defaults',
              onClick: () =>
                setConfirmAction({
                  title: 'Reset appearance settings?',
                  message:
                    'Theme, font family, font size, and line spacing will be restored to their default values.',
                  confirmLabel: 'Reset Settings',
                  onConfirm: () => {
                    handleReset();
                  },
                }),
            },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={item.onClick}
              className="w-full flex items-center justify-between py-4 text-left font-sans text-sm font-medium text-[var(--text-primary)] hover:text-[var(--text-subtle)] transition-colors cursor-pointer group"
            >
              <span>{item.label}</span>
              <svg
                className="w-4 h-4 text-[var(--text-subtle)] group-hover:text-[var(--text-primary)] group-hover:translate-x-0.5 transition-all shrink-0"
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
          ))}
        </section>

        {/* Auto-save indicator */}
        <div className="flex items-center justify-end gap-1.5 text-xs font-sans text-[var(--text-subtle)] select-none">
          <svg
            className="w-3.5 h-3.5 text-[var(--text-subtle)] shrink-0"
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
          <span>Changes saved automatically</span>
        </div>
      </div>

      {/* Progressive Disclosure Detail Modal */}
      <Modal
        isOpen={activeDetailModal !== null}
        onClose={() => {
          if (
            !instructionModal.isOpen &&
            !isApiKeyGuideOpen &&
            !confirmAction
          ) {
            setActiveDetailModal(null);
          }
        }}
        title={
          activeDetailModal === 'summaries'
            ? 'Intelligent Summaries'
            : activeDetailModal === 'install'
            ? 'Installed As App'
            : activeDetailModal === 'updates'
            ? 'App Software Updates'
            : activeDetailModal === 'sync'
            ? 'Cloud Sync'
            : undefined
        }
        description={
          activeDetailModal === 'updates'
            ? `Version ${appVersion.startsWith('v') || appVersion === 'Dev' ? appVersion : `v${appVersion}`}`
            : undefined
        }
        maxWidthClassName="max-w-lg"
      >
        <div className="px-6 sm:px-7 pb-6 sm:pb-7 pt-2 flex flex-col gap-4 font-sans">
          {activeDetailModal === 'summaries' && (
            <div className="flex flex-col gap-2">
              <label htmlFor="gemini-api-key-input" className="font-sans text-xs font-medium text-[var(--text-primary)]">
                Gemini API Key
              </label>

              <div className="relative flex items-center">
                <input
                  id="gemini-api-key-input"
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => handleApiKeyChange(e.target.value)}
                  placeholder="AIzaSy... (Your Gemini API Key)"
                  className="w-full font-sans text-xs px-3.5 py-2.5 pr-20 rounded border border-[var(--line-subtle)] bg-[var(--bg-input)] text-[var(--text-primary)] placeholder-[var(--text-subtle)]/45 focus:outline-none focus:border-[var(--text-primary)] focus:ring-1 focus:ring-[var(--text-primary)] transition-colors"
                  autoComplete="off"
                  spellCheck={false}
                />
                <div className="absolute right-2.5 flex items-center gap-1.5">
                  {apiKey.length > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        setConfirmAction({
                          title: 'Clear Gemini API key?',
                          message:
                            'This removes your saved Gemini API key from this device. Intelligent Summaries will pause until a key is entered again.',
                          confirmLabel: 'Clear Key',
                          onConfirm: () => {
                            handleApiKeyChange('');
                          },
                        })
                      }
                      className="text-xs text-[var(--text-subtle)] hover:text-rose-500 px-1 py-0.5 rounded cursor-pointer transition-colors"
                      title="Clear API key"
                    >
                      Clear
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowApiKey((prev) => !prev)}
                    className="text-[var(--text-subtle)] hover:text-[var(--text-primary)] p-1 rounded cursor-pointer focus:outline-none"
                    title={showApiKey ? 'Hide API key' : 'Show API key'}
                    aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
                  >
                    {showApiKey ? (
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs font-sans text-[var(--text-subtle)] pt-1">
                <div className="flex items-center gap-2">
                  {apiKey.trim().length > 0 ? (
                    <span className="flex items-center gap-1.5 text-[var(--text-primary)] font-medium">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-primary)]" />
                      {isSavedRecently ? 'Key saved' : 'Custom key active'}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 opacity-80">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-subtle)]" />
                      Key required for Intelligent Summaries
                    </span>
                  )}
                </div>

                {apiKey.trim().length > 0 && (
                  <button
                    type="button"
                    onClick={handleTestApiKey}
                    disabled={isTestingKey}
                    className="self-start sm:self-auto inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-sans rounded border border-[var(--line-subtle)] hover:border-[var(--text-primary)]/40 hover:text-[var(--text-primary)] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed bg-[var(--bg-surface)]"
                    title="Test Gemini API key connectivity and quota"
                  >
                    {isTestingKey ? (
                      <>
                        <svg className="w-3 h-3 animate-spin text-[var(--text-primary)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        <span>Testing...</span>
                      </>
                    ) : (
                      <>
                        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        <span>Test Key</span>
                      </>
                    )}
                  </button>
                )}
              </div>

              {keyTestFeedback && (
                <div
                  className={`p-2.5 rounded text-xs font-sans border transition-all ${
                    keyTestFeedback.success
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300'
                      : 'border-red-500/30 bg-red-500/10 text-red-800 dark:text-red-300'
                  }`}
                  role="status"
                >
                  <div className="flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full ${keyTestFeedback.success ? 'bg-emerald-500' : 'bg-red-500'}`} />
                    <span>{keyTestFeedback.message}</span>
                  </div>
                </div>
              )}

              <div className="pt-2 flex flex-col gap-3 text-xs font-sans text-[var(--text-subtle)] leading-relaxed">
                <p>
                  As you take study notes across Scripture, Intelligent Summaries periodically notice connections between your reflections and weave them into concise, verse-cited summaries of recurring biblical themes—grounded in Scripture interpreting Scripture and Christ-centered unity.
                </p>
                <p>
                  This is an automated pattern-matching assistant, not an inerrant commentator or spiritual counselor; test every observation against Scripture itself (Acts 17:11; 1 Thess 5:21).
                </p>
                <div className="flex items-center justify-between flex-wrap gap-2.5 pt-1">
                  <span className="font-sans text-[11px] opacity-75">
                    100% free • No credit card required
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsApiKeyGuideOpen(true)}
                    className="px-3.5 py-1.5 rounded-full bg-[var(--text-primary)] text-[var(--bg-app)] text-xs font-semibold hover:opacity-90 active:scale-95 transition-all cursor-pointer inline-flex items-center gap-1.5 shadow-sm whitespace-nowrap shrink-0"
                    title="How to get a free Gemini API key"
                  >
                    <span>Get API Key</span>
                    <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeDetailModal === 'install' && (
            <div className="flex flex-col gap-4 font-sans">
              <div className="flex items-start gap-3">
                <div
                  className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                    isAppInstalled
                      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                      : 'bg-[var(--text-primary)]/8 text-[var(--text-primary)]'
                  }`}
                >
                  {isAppInstalled ? (
                    <svg className="w-4.5 h-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                      <polyline points="22 4 12 14.01 9 11.01" />
                    </svg>
                  ) : (
                    <svg className="w-4.5 h-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                      <line x1="8" y1="21" x2="16" y2="21" />
                      <line x1="12" y1="17" x2="12" y2="21" />
                    </svg>
                  )}
                </div>

                <div className="flex flex-col gap-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-sans text-sm font-semibold text-[var(--text-primary)]">
                      {isAppInstalled ? 'Installed on This Device' : 'Install for Offline Reading'}
                    </span>
                    {isAppInstalled && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                        Active
                      </span>
                    )}
                  </div>
                  <p className="font-sans text-xs text-[var(--text-subtle)] leading-relaxed">
                    {isAppInstalled
                      ? 'Reneu is installed as a standalone app on this device. Offline reading and local data storage are fully enabled.'
                      : 'Reneu is installable as an app so you can use it offline like a normal app, with zero browser clutter.'}
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end pt-2 border-t border-[var(--line-subtle)]">
                {isAppInstalled ? (
                  <button
                    type="button"
                    onClick={() => setInstructionModal({ isOpen: true, mode: 'uninstall' })}
                    className="px-3.5 py-1.5 rounded-full border border-[var(--line-subtle)] hover:border-rose-500/40 hover:text-rose-600 dark:hover:text-rose-400 text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 shadow-xs whitespace-nowrap shrink-0"
                    title="View instructions to uninstall Reneu"
                  >
                    <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 6h18" />
                      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                    </svg>
                    <span>Uninstall App</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setInstructionModal({ isOpen: true, mode: 'install' })}
                    className="px-3.5 py-1.5 rounded-full bg-[var(--text-primary)] text-[var(--bg-app)] text-xs font-semibold hover:opacity-90 active:scale-95 transition-all cursor-pointer flex items-center gap-1.5 shadow-sm whitespace-nowrap shrink-0"
                    title="View installation instructions for your device"
                  >
                    <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    <span>Install as app</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {activeDetailModal === 'updates' && (
            <div className="flex flex-col gap-4 font-sans">
              <div className="flex items-start gap-3">
                <div
                  className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                    updateStatus === 'available' || hasUpdate
                      ? 'bg-[var(--text-primary)]/12 text-[var(--text-primary)]'
                      : updateStatus === 'checking'
                      ? 'bg-[var(--text-primary)]/10 text-[var(--text-primary)]'
                      : 'bg-[var(--text-primary)]/8 text-[var(--text-primary)]'
                  }`}
                >
                  {updateStatus === 'checking' ? (
                    <svg className="w-4.5 h-4.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                  ) : updateStatus === 'available' || hasUpdate ? (
                    <svg className="w-4.5 h-4.5 animate-pulse" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                  ) : (
                    <svg className="w-4.5 h-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </div>

                <div className="flex flex-col gap-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-sans text-sm font-semibold text-[var(--text-primary)]">
                      {updateStatus === 'checking'
                        ? 'Checking for software updates…'
                        : updateStatus === 'available' || hasUpdate
                        ? 'New Application Build Available'
                        : 'Application Software is Current'}
                    </span>
                    {(updateStatus === 'available' || hasUpdate) && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[var(--text-primary)] text-[var(--bg-app)]">
                        New Build
                      </span>
                    )}
                  </div>
                  <p className="font-sans text-xs text-[var(--text-subtle)] leading-relaxed">
                    {updateStatus === 'checking'
                      ? 'Looking for latest application release…'
                      : updateStatus === 'available' || hasUpdate
                      ? 'A newer version of the reader software is ready to activate.'
                      : lastCheckedTime
                      ? `Checked ${lastCheckedTime} • Offline Bible reader assets are cached.`
                      : 'Offline Bible reader and interface assets are cached on this device.'}
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end pt-2 border-t border-[var(--line-subtle)]">
                {updateStatus === 'available' || hasUpdate ? (
                  <button
                    type="button"
                    onClick={() => void applyUpdate()}
                    className="px-3.5 py-1.5 rounded-full bg-[var(--text-primary)] text-[var(--bg-app)] text-xs font-semibold hover:opacity-90 active:scale-95 transition-all cursor-pointer flex items-center gap-1.5 shadow-sm whitespace-nowrap shrink-0"
                    title="Reload with latest application build"
                  >
                    <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                    </svg>
                    <span className="whitespace-nowrap">Update &amp; Reload</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void checkForUpdate()}
                    disabled={isChecking}
                    className="px-3.5 py-1.5 rounded-full bg-[var(--text-primary)] text-[var(--bg-app)] text-xs font-semibold hover:opacity-90 active:scale-95 transition-all cursor-pointer flex items-center gap-1.5 shadow-sm whitespace-nowrap shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Check for newer software build"
                  >
                    <svg
                      className={`w-3.5 h-3.5 shrink-0 ${isChecking ? 'animate-spin' : ''}`}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                    </svg>
                    <span className="whitespace-nowrap">{isChecking ? 'Checking…' : 'Check for Updates'}</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {activeDetailModal === 'sync' && (
            <div className="flex flex-col gap-4 font-sans">
              <div className="flex items-start gap-3">
                <div
                  className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                    currentUser
                      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                      : 'bg-[var(--text-primary)]/8 text-[var(--text-primary)]'
                  }`}
                >
                  {isSyncing ? (
                    <svg className="w-4.5 h-4.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                  ) : currentUser ? (
                    <svg className="w-4.5 h-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                  ) : (
                    <svg className="w-4.5 h-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
                    </svg>
                  )}
                </div>

                <div className="flex flex-col gap-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-sans text-sm font-semibold text-[var(--text-primary)]">
                      {currentUser
                        ? currentUser.email || 'Signed In Account'
                        : 'Personal Device Storage'}
                    </span>
                    {currentUser ? (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 whitespace-nowrap shrink-0">
                        {currentUser.provider === 'google' ? 'Google Account' : 'Cloud Sync Active'}
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[var(--text-primary)]/10 text-[var(--text-primary)] whitespace-nowrap shrink-0">
                        Local Storage
                      </span>
                    )}
                  </div>
                  <p className="font-sans text-xs text-[var(--text-subtle)] leading-relaxed">
                    {currentUser
                      ? lastSyncDisplay
                        ? `Last synced at ${lastSyncDisplay}. Your verse reflections, bookmarks, and syntheses sync privately across devices.`
                        : 'Authenticated. Your personal study notes sync privately to your Reneu cloud account.'
                      : 'All notes and reading progress are preserved safely on this device. Sign in to sync your study data across devices.'}
                  </p>
                </div>
              </div>

              {syncFeedback && (
                <div className="py-2 px-3 rounded text-xs leading-relaxed bg-[var(--text-primary)]/5 text-[var(--text-primary)] border border-[var(--line-subtle)]">
                  {syncFeedback}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 flex-wrap pt-2 border-t border-[var(--line-subtle)]">
                {currentUser ? (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        setConfirmAction({
                          title: 'Sign out of Cloud Sync?',
                          message:
                            'Your notes remain safely stored on this device, and cloud syncing across devices will pause until you sign back in.',
                          confirmLabel: 'Sign Out',
                          onConfirm: async () => {
                            await handleSignOut();
                          },
                        })
                      }
                      disabled={authLoading}
                      className="px-3 py-1.5 rounded-full border border-[var(--line-subtle)] hover:border-rose-500/40 hover:text-rose-600 dark:hover:text-rose-400 text-xs font-medium text-[var(--text-subtle)] transition-all cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-50"
                    >
                      <span className="whitespace-nowrap">Sign Out</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => void handleManualSync()}
                      disabled={isSyncing}
                      className="px-3.5 py-1.5 rounded-full bg-[var(--text-primary)] text-[var(--bg-app)] text-xs font-semibold hover:opacity-90 active:scale-95 transition-all cursor-pointer flex items-center gap-1.5 shadow-sm whitespace-nowrap shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Sync local study notes with cloud account"
                    >
                      <svg className={`w-3.5 h-3.5 shrink-0 ${isSyncing ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                      </svg>
                      <span className="whitespace-nowrap">{isSyncing ? 'Syncing…' : 'Sync Now'}</span>
                    </button>
                  </>
                ) : (
                  onOpenLoginSplash && (
                    <button
                      type="button"
                      onClick={() => {
                        setActiveDetailModal(null);
                        onOpenLoginSplash();
                      }}
                      className="px-3.5 py-1.5 rounded-full bg-[var(--text-primary)] text-[var(--bg-app)] hover:opacity-90 active:scale-95 text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 shadow-sm whitespace-nowrap shrink-0"
                      title="Sync study data across devices"
                    >
                      <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                      </svg>
                      <span className="whitespace-nowrap">Sync</span>
                    </button>
                  )
                )}
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* Dismissable About & Attribution Overlay */}
      <AboutModal
        isOpen={isAboutOpen}
        onClose={() => setIsAboutOpen(false)}
      />

      {/* Generic Blanket Privacy Policy Modal */}
      <PrivacyPolicyModal
        isOpen={isPrivacyOpen}
        onClose={() => setIsPrivacyOpen(false)}
      />

      {/* Open-Source License & Warranty Modal */}
      <LicenseWarrantyModal
        isOpen={isLicenseOpen}
        onClose={() => setIsLicenseOpen(false)}
      />

      {/* PWA Platform-Specific Install / Uninstall Modal */}
      <PWAInstructionsModal
        isOpen={instructionModal.isOpen}
        onClose={() => setInstructionModal((prev) => ({ ...prev, isOpen: false }))}
        mode={instructionModal.mode}
        initialPlatform={pwaPlatform}
        initialFormFactor={pwaFormFactor}
        initialBrowser={pwaBrowser}
        deferredPrompt={deferredPrompt}
        onPromptInstall={triggerPWAInstall}
      />

      {/* Free Gemini API Key Instructions Modal */}
      <ApiKeyInstructionsModal
        isOpen={isApiKeyGuideOpen}
        onClose={() => setIsApiKeyGuideOpen(false)}
      />

      {/* Confirmation Prompt for Negative Actions */}
      <ConfirmModal
        isOpen={Boolean(confirmAction)}
        onClose={() => {
          if (!isConfirmLoading) setConfirmAction(null);
        }}
        onConfirm={async () => {
          if (!confirmAction) return;
          setIsConfirmLoading(true);
          try {
            await confirmAction.onConfirm();
          } finally {
            setIsConfirmLoading(false);
            setConfirmAction(null);
          }
        }}
        title={confirmAction?.title || 'Confirm action'}
        message={confirmAction?.message || ''}
        confirmLabel={confirmAction?.confirmLabel || 'Confirm'}
        isLoading={isConfirmLoading}
      />
    </div>
  );
};

export default SettingsView;
