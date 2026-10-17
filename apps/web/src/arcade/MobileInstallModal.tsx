import { useEffect, useState } from "react";
import { isIOS, isStandalone } from "../appShell";
import { buzz } from "../haptics";
import { click } from "../sound";
import "./mobileInstall.css";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// Global hook to store beforeinstallprompt across the app lifecycle
let globalDeferredPrompt: BeforeInstallPromptEvent | null = null;
const promptListeners = new Set<() => void>();

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    globalDeferredPrompt = e as BeforeInstallPromptEvent;
    promptListeners.forEach((fn) => fn());
  });
}

export function useInstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(() => globalDeferredPrompt);

  useEffect(() => {
    const update = () => setDeferred(globalDeferredPrompt);
    promptListeners.add(update);
    return () => {
      promptListeners.delete(update);
    };
  }, []);

  return deferred;
}

export function isMobileDevice(): boolean {
  if (typeof window === "undefined") return false;
  return isIOS() || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

export function MobileInstallModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const deferred = useInstallPrompt();
  const [installed, setInstalled] = useState(false);
  const isApple = isIOS();
  const isAndroid = !isApple && /Android/i.test(typeof navigator !== "undefined" ? navigator.userAgent : "");

  if (!isOpen) return null;

  const handleInstallClick = async () => {
    click();
    buzz("tap");
    if (deferred) {
      try {
        await deferred.prompt();
        const choice = await deferred.userChoice;
        if (choice.outcome === "accepted") {
          setInstalled(true);
        }
      } catch {
        /* fallback to instructions */
      }
    }
  };

  return (
    <div className="install-modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="install-modal-card" onClick={(e) => e.stopPropagation()}>
        <button className="install-modal-close" onClick={onClose} aria-label="Close">
          ✕
        </button>

        <div className="install-badge">
          <span>📲</span> FULL SCREEN APP
        </div>

        <h2 className="install-title">INSTALL HEIST</h2>
        <p className="install-subtitle">
          Play in <b>immersive full-screen</b> with no browser address bars, instant loading, and offline access!
        </p>

        {/* Benefits Grid */}
        <div className="install-benefits-grid">
          <div className="install-benefit-pill">
            <span className="install-benefit-icon">✨</span>
            <div>
              <div className="install-benefit-title">Zero Browser Bars</div>
              <div className="install-benefit-desc">Maximum screen space for cards</div>
            </div>
          </div>
          <div className="install-benefit-pill">
            <span className="install-benefit-icon">⚡</span>
            <div>
              <div className="install-benefit-title">Instant App Launch</div>
              <div className="install-benefit-desc">Tap once from your home screen</div>
            </div>
          </div>
          <div className="install-benefit-pill">
            <span className="install-benefit-icon">✈️</span>
            <div>
              <div className="install-benefit-title">Offline Capable</div>
              <div className="install-benefit-desc">Play all 13 solo games anywhere</div>
            </div>
          </div>
          <div className="install-benefit-pill">
            <span className="install-benefit-icon">🔥</span>
            <div>
              <div className="install-benefit-title">Never Lose Streak</div>
              <div className="install-benefit-desc">Get daily challenge reminders</div>
            </div>
          </div>
        </div>

        {/* Platform Specific Instructions */}
        {isApple ? (
          <div className="install-guide-box ios">
            <div className="install-guide-head">
              <span className="install-guide-os">🍎 SAFARI ON IPHONE / IPAD</span>
            </div>
            <ol className="install-steps-list">
              <li>
                <div className="install-step-num">1</div>
                <div className="install-step-text">
                  Tap the <b>Share</b> button in Safari's bottom toolbar:
                  <span className="install-inline-icon share-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2">
                      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                      <polyline points="16 6 12 2 8 6" />
                      <line x1="12" y1="2" x2="12" y2="15" />
                    </svg>
                  </span>
                </div>
              </li>
              <li>
                <div className="install-step-num">2</div>
                <div className="install-step-text">
                  Scroll down the menu and tap <b>"Add to Home Screen"</b>:
                  <span className="install-inline-icon plus-icon" aria-hidden="true">
                    ⊞
                  </span>
                </div>
              </li>
              <li>
                <div className="install-step-num">3</div>
                <div className="install-step-text">
                  Tap <b>"Add"</b> in the top right corner. Done!
                </div>
              </li>
            </ol>
            <div className="install-ios-pointer">
              <span>👇</span> Look for the Share icon at the bottom of your screen
            </div>
          </div>
        ) : (
          <div className="install-guide-box android">
            <div className="install-guide-head">
              <span className="install-guide-os">🤖 ANDROID / CHROME</span>
            </div>

            {deferred && !installed ? (
              <div style={{ marginBottom: "1rem" }}>
                <button type="button" className="install-action-btn" onClick={handleInstallClick}>
                  <span>📲</span> 1-TAP INSTALL APP NOW
                </button>
              </div>
            ) : null}

            <ol className="install-steps-list">
              <li>
                <div className="install-step-num">1</div>
                <div className="install-step-text">
                  Tap the <b>Menu (⋮)</b> in the top right corner of Chrome.
                </div>
              </li>
              <li>
                <div className="install-step-num">2</div>
                <div className="install-step-text">
                  Tap <b>"Install app"</b> or <b>"Add to Home screen"</b>.
                </div>
              </li>
              <li>
                <div className="install-step-num">3</div>
                <div className="install-step-text">
                  Confirm <b>"Install"</b>. The app icon will appear on your home screen!
                </div>
              </li>
            </ol>
          </div>
        )}

        <button type="button" className="install-modal-dismiss" onClick={onClose}>
          Got it, let's play!
        </button>
      </div>
    </div>
  );
}
