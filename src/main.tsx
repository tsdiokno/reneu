import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { registerSW } from 'virtual:pwa-register';

// Register service worker in production environments
if (typeof window !== 'undefined' && 'serviceWorker' in navigator && import.meta.env.PROD) {
  try {
    const hadControllerAtBoot = Boolean(navigator.serviceWorker.controller);
    let hasReloadedForUpdate = false;

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hasReloadedForUpdate) return;
      const win = window as unknown as { __pwaApplyUpdateRequested?: boolean };
      const splashEl = document.getElementById('pwa-splash');
      const isSplashStillCovering =
        Boolean(splashEl) && !splashEl?.classList.contains('splash-dismissed');

      // Only auto-reload if user explicitly clicked Apply Update, or if the splash screen is
      // still actively covering an immediate boot update (< 1.5s) — never strobe mid-session or on wake.
      if (
        win.__pwaApplyUpdateRequested ||
        (hadControllerAtBoot &&
          isSplashStillCovering &&
          typeof performance !== 'undefined' &&
          performance.now() < 1500)
      ) {
        hasReloadedForUpdate = true;
        window.location.reload();
      }
    });

    const updateSW = registerSW({
      immediate: true,
      onNeedRefresh() {
        // Dispatch update available event for settings and active checkers
        window.dispatchEvent(new CustomEvent('pwa-update-available'));
      },
      onOfflineReady() {
        console.info('Reneu ready for offline reading.');
      },
      onRegisterError(error) {
        // Silently handle iframe sandbox or restricted permissions
        console.warn('SW registration skipped in preview:', error?.message || error);
      },
    });
    (window as unknown as { __pwaUpdateSW?: (reload?: boolean) => Promise<void> }).__pwaUpdateSW = updateSW;
  } catch {
    // Ignore restricted iframe environments
  }
}

// In development, clear any stale service workers from previous builds so they don't intercept dev assets
if (typeof window !== 'undefined' && 'serviceWorker' in navigator && import.meta.env.DEV) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const registration of registrations) {
      registration.unregister().catch(() => {});
    }
  }).catch(() => {});
}

const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
