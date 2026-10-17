import { useEffect, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { useAccount } from "./useAccount";
import { buzz } from "../haptics";
import { click } from "../sound";
import { t } from "../i18n";
import { trackSignUp } from "./telemetry";
import "./memberModal.css";

export interface MemberModalProps {
  isOpen: boolean;
  onClose: () => void;
  streak?: number;
  xp?: number;
  multiplier?: number;
  source?: string;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function MemberModal({
  isOpen,
  onClose,
  streak = 1,
  xp = 150,
  multiplier = 1.0,
  source = "game_victory",
}: MemberModalProps) {
  const { act, me } = useAccount();
  const [step, setStep] = useState<"email" | "password" | "signin" | "done">("email");
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setStep("email");
      setPassword("");
      setError(null);
      return;
    }
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
    if (!cleanEmail || !EMAIL_REGEX.test(cleanEmail)) {
      setError(t("auth.email_invalid", "Please enter a valid email address."));
      return;
    }
    setError(null);
    setBusy(true);
    click();
    buzz("tap");

    try {
      const wasGuest = me?.guest;
      const res = await act((b) => b.register(cleanEmail, undefined, undefined, consent), { inline: true });
      if (!res) throw new Error("Could not create account");
      buzz("win");
      setEmail(cleanEmail);
      setStep("password");
      if (wasGuest) trackSignUp("email", source);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Couldn't save progress";
      // If the email already has an account, switch straight to sign in
      if (/sign in instead|already an account/i.test(msg)) {
        setEmail(cleanEmail);
        setStep("signin");
        setError(null);
        buzz("tap");
      } else {
        setError(msg);
        buzz("alert");
      }
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
        const res = await act((b) => (b.setPassword ? b.setPassword(password) : b.changePassword("", password)), { inline: true });
        if (!res) throw new Error("Couldn't save password");
      }
      buzz("win");
      setStep("done");
      setTimeout(() => {
        onClose();
      }, 1000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Couldn't set password";
      setError(msg);
      buzz("alert");
    } finally {
      setBusy(false);
    }
  };

  const handleSignInSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !password) {
      setError(t("auth.enter_both", "Enter your email and password."));
      return;
    }
    setError(null);
    setBusy(true);
    click();
    buzz("tap");

    try {
      const res = await act((b) => b.login(cleanEmail, password), { inline: true });
      if (!res) throw new Error("Sign-in failed");
      buzz("win");
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Sign-in failed";
      setError(msg);
      buzz("alert");
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div
      className="member-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Become a Member"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
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

              {error && <div className="member-error-text" role="alert">{error}</div>}

              <button type="submit" className="member-btn-primary" disabled={busy}>
                {busy ? "SAVING..." : t("member.cta_button", "★ SAVE MY STREAK & PASS (FREE)")}
              </button>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
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

                <button
                  type="button"
                  className="member-skip-btn"
                  style={{ textDecoration: "underline" }}
                  onClick={() => {
                    click();
                    setError(null);
                    setStep("signin");
                  }}
                >
                  Already have an account? Sign in
                </button>
              </div>
            </form>
          </>
        ) : step === "signin" ? (
          <>
            <div className="member-badge-row">
              <span className="member-badge">
                <span>🔑</span> SIGN IN TO ACCOUNT
              </span>
            </div>

            <h2 className="member-title">
              <span>WELCOME BACK</span>
            </h2>

            <p className="member-sub">
              Enter your password to sign in and restore your saved account on this device.
            </p>

            <form className="member-form" onSubmit={handleSignInSubmit}>
              <div className="member-input-wrap">
                <span className="member-input-icon">✉️</span>
                <input
                  type="email"
                  className="member-input"
                  placeholder="Your account email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={busy}
                  required
                />
              </div>

              <div className="member-input-wrap">
                <span className="member-input-icon">🔒</span>
                <input
                  type="password"
                  className="member-input"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={busy}
                  autoComplete="current-password"
                  autoFocus
                  required
                />
              </div>

              {error && <div className="member-error-text" role="alert">{error}</div>}

              <button type="submit" className="member-btn-primary" disabled={busy}>
                {busy ? "SIGNING IN..." : "SIGN IN TO ACCOUNT ➔"}
              </button>

              <button
                type="button"
                className="member-skip-btn"
                onClick={() => {
                  click();
                  setError(null);
                  setStep("email");
                }}
              >
                ← Back to create account
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
                "Choose a password so you can sign in and recover your streak across any device if your browser cache clears."
              )}
            </p>

            <form className="member-form" onSubmit={handlePasswordSubmit}>
              <div className="member-opt-box">
                <div className="member-opt-title">
                  {t("member.optional_pass_title", "Set Account Password")}
                </div>
                <div className="member-opt-sub">
                  Required to sign in on other devices or restore if your cache clears.
                </div>
                <div className="member-input-wrap">
                  <span className="member-input-icon">🔒</span>
                  <input
                    type="password"
                    className="member-input"
                    placeholder={t("member.password_placeholder", "Create password (min 8 characters)")}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={busy}
                    autoComplete="new-password"
                    minLength={8}
                    autoFocus
                    required
                  />
                </div>
              </div>

              {error && <div className="member-error-text" role="alert">{error}</div>}

              <div className="member-actions-row">
                <button
                  type="submit"
                  className="member-btn-primary"
                  style={{ flex: 1.2 }}
                  disabled={busy || password.length < 8}
                >
                  {busy ? "Saving..." : t("member.set_password_btn", "★ Lock With Password")}
                </button>
                <button
                  type="button"
                  className="member-btn-secondary"
                  onClick={() => {
                    click();
                    onClose();
                  }}
                >
                  {t("member.continue_playing", "Skip For Now ➔")}
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
              {t("member.all_set_sub", "Password saved. Your account is fully protected across all your devices. Have fun!")}
            </p>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
