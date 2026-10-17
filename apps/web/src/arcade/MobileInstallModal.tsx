import { useEffect, useState } from "react";
import { isIOS, isStandalone } from "../appShell";
import { buzz } from "../haptics";
import { click } from "../sound";
import "./mobileInstall.css";
import { t, tRich } from "../i18n";

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
        <button className="install-modal-close" onClick={onClose} aria-label={t("common.close")}>
          ✕
        </button>

        <div className="install-badge">
          <span>📲</span> {t("inst.badge")}
        </div>

        <h2 className="install-title">{t("inst.title")}</h2>
        <p className="install-subtitle">{tRich("inst.sub")}</p>

        {/* Benefits Grid */}
        <div className="install-benefits-grid">
          <div className="install-benefit-pill">
            <span className="install-benefit-icon">✨</span>
            <div>
              <div className="install-benefit-title">{t("inst.b1")}</div>
              <div className="install-benefit-desc">{t("inst.b1d")}</div>
            </div>
          </div>
          <div className="install-benefit-pill">
            <span className="install-benefit-icon">⚡</span>
            <div>
              <div className="install-benefit-title">{t("inst.b2")}</div>
              <div className="install-benefit-desc">{t("inst.b2d")}</div>
            </div>
          </div>
          <div className="install-benefit-pill">
            <span className="install-benefit-icon">✈️</span>
            <div>
              <div className="install-benefit-title">{t("inst.b3")}</div>
              <div className="install-benefit-desc">{t("inst.b3d")}</div>
            </div>
          </div>
          <div className="install-benefit-pill">
            <span className="install-benefit-icon">🔥</span>
            <div>
              <div className="install-benefit-title">{t("inst.b4")}</div>
              <div className="install-benefit-desc">{t("inst.b4d")}</div>
            </div>
          </div>
        </div>

        {/* Platform Specific Instructions */}
        {isApple ? (
          <div className="install-guide-box ios">
            <div className="install-guide-head">
              <span className="install-guide-os">🍎 {t("inst.ios")}</span>
            </div>
            <ol className="install-steps-list">
              <li>
                <div className="install-step-num">1</div>
                <div className="install-step-text">
                  {tRich("inst.ios1")}
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
                  {tRich("inst.ios2")}
                  <span className="install-inline-icon plus-icon" aria-hidden="true">
                    ⊞
                  </span>
                </div>
              </li>
              <li>
                <div className="install-step-num">3</div>
                <div className="install-step-text">
                  {tRich("inst.ios3")}
                </div>
              </li>
            </ol>
            <div className="install-ios-pointer">
              <span>👇</span> {t("inst.iosLook")}
            </div>
          </div>
        ) : (
          <div className="install-guide-box android">
            <div className="install-guide-head">
              <span className="install-guide-os">🤖 {t("inst.android")}</span>
            </div>

            {deferred && !installed ? (
              <div style={{ marginBottom: "1rem" }}>
                <button type="button" className="install-action-btn" onClick={handleInstallClick}>
                  <span>📲</span> {t("inst.oneTap")}
                </button>
              </div>
            ) : null}

            <ol className="install-steps-list">
              <li>
                <div className="install-step-num">1</div>
                <div className="install-step-text">
                  {tRich("inst.and1")}
                </div>
              </li>
              <li>
                <div className="install-step-num">2</div>
                <div className="install-step-text">
                  {tRich("inst.and2")}
                </div>
              </li>
              <li>
                <div className="install-step-num">3</div>
                <div className="install-step-text">
                  {tRich("inst.and3")}
                </div>
              </li>
            </ol>
          </div>
        )}

        <button type="button" className="install-modal-dismiss" onClick={onClose}>
          {t("inst.gotIt")}

        </button>
      </div>
    </div>
  );
}
