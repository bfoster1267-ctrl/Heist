import { useEffect, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { useAccount } from "./useAccount";
import { buzz } from "../haptics";
import { click } from "../sound";
import { t } from "../i18n";
import "./memberModal.css";

export interface MemberModalProps {
  isOpen: boolean;
  onClose: () => void;
  streak?: number;
  xp?: number;
  multiplier?: number;
  source?: string;
}

export function MemberModal({
  isOpen,
  onClose,
  streak = 1,
  xp = 150,
  multiplier = 1.0,
  source = "game_victory",
}: MemberModalProps) {
  const { act, me } = useAccount();
  const [step, setStep] = useState<"email" | "password" | "done">("email");
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(true);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleEmailSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes("@") || !cleanEmail.includes(".")) {
      setError(t("auth.email_invalid", "Please enter a valid email address."));
      return;
    }
    setError(null);
    setBusy(true);
    click();
    buzz("tap");

    try {
      await act((b) => b.register(cleanEmail, undefined, undefined, consent));
      buzz("win");
      setEmail(cleanEmail);
      setStep("password");
      try {
        if (typeof window !== "undefined" && "gtag" in window && typeof (window as any).gtag === "function") {
          (window as any).gtag("event", "sign_up", { method: "email" });
        }
      } catch {
        // analytics blocked by adblock
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Couldn't save progress";
      setError(msg);
      buzz("alert");
    } finally {
      setBusy(false);
    }
  };

  const handlePasswordSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password || password.length < 8) {
      setError(t("auth.password_min", "Password must be at least 8 characters."));
      return;
    }
    setError(null);
    setBusy(true);
    click();
    buzz("tap");

    try {
      if (act) {
        await act((b) => b.setPassword ? b.setPassword(password) : b.changePassword("", password));
      }
      buzz("win");
      setStep("done");
      setTimeout(() => {
        onClose();
      }, 1200);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Couldn't set password";
      setError(msg);
      buzz("alert");
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="member-overlay" role="dialog" aria-modal="true" aria-label="Become a Member">
      <div className="member-box" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="member-close-btn"
          onClick={() => {
            click();
            onClose();
          }}
          aria-label="Close"
        >
          ✕
        </button>

        {step === "email" ? (
          <>
            <div className="member-badge-row">
              <span className="member-badge">
                <span>👑</span> {t("member.badge", "FREE MEMBERSHIP")}
              </span>
            </div>

            <h2 className="member-title">
              {t("member.title_prefix", "LOCK IN YOUR")} <span>{t("member.title_highlight", "PROGRESS")}</span>
            </h2>

            <p className="member-sub">
              {t("member.subtitle", "Never lose your daily streak, Battle Pass XP, or wardrobe skins across your devices.")}
            </p>

            <div className="member-perks">
              <div className="member-perk-row">
                <span className="member-perk-icon" aria-hidden="true">🔥</span>
                <div className="member-perk-text">
                  <b>{streak}-Day Streak Active ({multiplier}x XP)</b>
                  <span>Daily fire protected if your browser cache clears</span>
                </div>
              </div>

              <div className="member-perk-row">
                <span className="member-perk-icon" aria-hidden="true">🎫</span>
                <div className="member-perk-text">
                  <b>Season Pass Progress Saved</b>
                  <span>Bank your +{xp} XP and unlock upcoming tier rewards</span>
                </div>
              </div>

              <div className="member-perk-row">
                <span className="member-perk-icon" aria-hidden="true">🎨</span>
                <div className="member-perk-text">
                  <b>Custom Skins &amp; Wardrobe Cloud Sync</b>
                  <span>Card backs, avatars, and table felts linked to your account</span>
                </div>
              </div>
            </div>

            <form className="member-form" onSubmit={handleEmailSubmit}>
              <div className="member-input-wrap">
                <span className="member-input-icon">✉️</span>
                <input
                  type="email"
                  className="member-input"
                  placeholder={t("member.email_placeholder", "Enter your email")}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={busy}
                  autoFocus
                  required
                />
              </div>

              <label className="member-consent-label">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                <span>
                  {t(
                    "member.consent_text",
                    "I agree to receive daily challenge deals, streak alerts & secret loot drops (unsubscribe anytime)."
                  )}
                </span>
              </label>

              {error && <div className="member-error-text">{error}</div>}

              <button type="submit" className="member-btn-primary" disabled={busy}>
                {busy ? "SAVING..." : t("member.cta_button", "★ SAVE MY STREAK & PASS (FREE)")}
              </button>

              <button
                type="button"
                className="member-skip-btn"
                onClick={() => {
                  click();
                  onClose();
                }}
              >
                {t("member.maybe_later", "Maybe later (continue as guest)")}
              </button>
            </form>
          </>
        ) : step === "password" ? (
          <>
            <div className="member-success-icon">🎉</div>
            <h2 className="member-title">
              <span>{t("member.saved_title", "PROGRESS SECURED!")}</span>
            </h2>
            <div className="member-saved-email">
              ✉️ {email}
            </div>
            <p className="member-sub">
              {t(
                "member.saved_sub",
                "Your streak, XP, and skins are safely anchored. You can log in via 1-tap email link anytime."
              )}
            </p>

            <form className="member-form" onSubmit={handlePasswordSubmit}>
              <div className="member-opt-box">
                <div className="member-opt-title">
                  {t("member.optional_pass_title", "Optional: Lock with a Password")}
                </div>
                <div className="member-opt-sub">
                  {t(
                    "member.optional_pass_sub",
                    "Add a password now if you prefer password sign-in over email links."
                  )}
                </div>
                <div className="member-input-wrap">
                  <span className="member-input-icon">🔒</span>
                  <input
                    type="password"
                    className="member-input"
                    placeholder={t("member.password_placeholder", "Create password (optional, min 8 chars)")}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={busy}
                    autoFocus
                  />
                </div>
              </div>

              {error && <div className="member-error-text">{error}</div>}

              <div className="member-actions-row">
                <button
                  type="submit"
                  className="member-btn-secondary"
                  disabled={busy || password.length < 8}
                >
                  {busy ? "Saving..." : t("member.set_password_btn", "Set Password")}
                </button>
                <button
                  type="button"
                  className="member-btn-primary"
                  style={{ flex: 1.2 }}
                  onClick={() => {
                    click();
                    onClose();
                  }}
                >
                  {t("member.continue_playing", "Keep Playing ➔")}
                </button>
              </div>
            </form>
          </>
        ) : (
          <>
            <div className="member-success-icon">✓</div>
            <h2 className="member-title">
              <span>{t("member.all_set_title", "YOU'RE ALL SET!")}</span>
            </h2>
            <p className="member-sub">
              {t("member.all_set_sub", "Password saved. Your account is fully protected. Have fun!")}
            </p>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
