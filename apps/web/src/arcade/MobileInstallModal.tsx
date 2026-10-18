import { useEffect, useState } from "react";
import { isIOS, isStandalone } from "../appShell";
import { buzz } from "../haptics";
import { click } from "../sound";
import { t } from "../i18n";
import { trackPwaInstall } from "../account/telemetry";
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

  useEffect(() => {
    if (isOpen) {
      trackPwaInstall(isApple ? "ios" : isAndroid ? "android" : "other");
    }
  }, [isOpen, isApple, isAndroid]);

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
          trackPwaInstall("android");
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
          <span>📲</span> {t("install.badge")}
        </div>

        <h2 className="install-title">{t("install.title")}</h2>
        <p className="install-subtitle">
          {t("install.subtitle")}
        </p>

        {/* Benefits Grid */}
        <div className="install-benefits-grid">
          <div className="install-benefit-pill">
            <span className="install-benefit-icon">✨</span>
            <div>
              <div className="install-benefit-title">{t("install.b1_title")}</div>
              <div className="install-benefit-desc">{t("install.b1_desc")}</div>
            </div>
          </div>
          <div className="install-benefit-pill">
            <span className="install-benefit-icon">⚡</span>
            <div>
              <div className="install-benefit-title">{t("install.b2_title")}</div>
              <div className="install-benefit-desc">{t("install.b2_desc")}</div>
            </div>
          </div>
          <div className="install-benefit-pill">
            <span className="install-benefit-icon">✈️</span>
            <div>
              <div className="install-benefit-title">{t("install.b3_title")}</div>
              <div className="install-benefit-desc">{t("install.b3_desc")}</div>
            </div>
          </div>
          <div className="install-benefit-pill">
            <span className="install-benefit-icon">🔥</span>
            <div>
              <div className="install-benefit-title">{t("install.b4_title")}</div>
              <div className="install-benefit-desc">{t("install.b4_desc")}</div>
            </div>
          </div>
        </div>

        {/* Platform Specific Instructions */}
        {isApple ? (
          <div className="install-guide-box ios">
            <div className="install-guide-head">
              <span className="install-guide-os">{t("install.ios_header")}</span>
            </div>
            <ol className="install-steps-list">
              <li>
                <div className="install-step-num">1</div>
                <div className="install-step-text">
                  {t("install.ios_step1")}
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
                  {t("install.ios_step2")}
                  <span className="install-inline-icon plus-icon" aria-hidden="true">
                    ⊞
                  </span>
                </div>
              </li>
              <li>
                <div className="install-step-num">3</div>
                <div className="install-step-text">
                  {t("install.ios_step3")}
                </div>
              </li>
            </ol>
            <div className="install-ios-pointer">
              <span>👇</span> {t("install.ios_pointer")}
            </div>
          </div>
        ) : (
          <div className="install-guide-box android">
            <div className="install-guide-head">
              <span className="install-guide-os">{t("install.android_header")}</span>
            </div>

            {deferred && !installed ? (
              <div style={{ marginBottom: "1rem" }}>
                <button type="button" className="install-action-btn" onClick={handleInstallClick}>
                  <span>📲</span> {t("install.android_btn")}
                </button>
              </div>
            ) : null}

            <ol className="install-steps-list">
              <li>
                <div className="install-step-num">1</div>
                <div className="install-step-text">
                  {t("install.android_step1")}
                </div>
              </li>
              <li>
                <div className="install-step-num">2</div>
                <div className="install-step-text">
                  {t("install.android_step2")}
                </div>
              </li>
              <li>
                <div className="install-step-num">3</div>
                <div className="install-step-text">
                  {t("install.android_step3")}
                </div>
              </li>
            </ol>
          </div>
        )}

        <button type="button" className="install-modal-dismiss" onClick={onClose}>
          {t("install.dismiss")}
        </button>
      </div>
    </div>
  );
}
