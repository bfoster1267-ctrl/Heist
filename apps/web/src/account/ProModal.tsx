import { useEffect, useRef } from "react";
import { HEIST_PRO_STRIPE_URL, useHeistPro } from "./pro";
import { buzz } from "../haptics";
import { click } from "../sound";
import "./proModal.css";

export function ProModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const pro = useHeistPro();
  const cardRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Focus management and Escape key handling
  useEffect(() => {
    if (!isOpen) return;

    prevFocusRef.current = document.activeElement as HTMLElement | null;
    const timer = setTimeout(() => {
      closeBtnRef.current?.focus();
    }, 50);

    const handleWindowKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        onCloseRef.current();
      }
    };

    window.addEventListener("keydown", handleWindowKeyDown);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", handleWindowKeyDown);
      prevFocusRef.current?.focus();
    };
  }, [isOpen]);

  // Tab focus trap scoped to modal card
  const handleCardKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab" || !cardRef.current) return;

    const focusables = cardRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]):not([aria-hidden="true"]), [href]:not([aria-hidden="true"]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (focusables.length === 0) return;

    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="pro-modal-overlay" onClick={onClose} role="presentation">
      <div
        ref={cardRef}
        className="pro-modal-card"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleCardKeyDown}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pro-modal-title"
      >
        <button
          ref={closeBtnRef}
          type="button"
          className="pro-modal-close"
          onClick={() => {
            click();
            buzz("tap");
            onClose();
          }}
          aria-label="Close dialog"
        >
          ✕
        </button>

        <div className="pro-badge">👑 VIP Founder Pass</div>
        <h2 id="pro-modal-title" className="pro-title">
          VIP Founder Pass
        </h2>

        <div className="pro-price-wrap">
          <span className="pro-price">$4.99</span>
          <span className="pro-price-sub">/ one-time · lifetime access</span>
        </div>

        <div className="pro-perks-list">
          <div className="pro-perk">
            <span className="pro-perk-icon">👑</span>
            <div>
              <div className="pro-perk-title">Gold VIP Status & Table Crown</div>
              <div className="pro-perk-desc">
                Exclusive gold VIP badge and crown on your profile, leaderboard entry, and game table.
              </div>
            </div>
          </div>

          <div className="pro-perk">
            <span className="pro-perk-icon">🛡️</span>
            <div>
              <div className="pro-perk-title">Streak Shield Protection</div>
              <div className="pro-perk-desc">
                Never lose your hard-earned daily streaks — missed challenge days are shielded from breaking your streak.
              </div>
            </div>
          </div>

          <div className="pro-perk">
            <span className="pro-perk-icon">🚫</span>
            <div>
              <div className="pro-perk-title">100% Ad-Free Forever Guarantee</div>
              <div className="pro-perk-desc">
                Instant distraction-free gaming with zero banner ads, interstitials, or video popups on phone and web.
              </div>
            </div>
          </div>

          <div className="pro-perk">
            <span className="pro-perk-icon">🚀</span>
            <div>
              <div className="pro-perk-title">Founder Roadmap Priority</div>
              <div className="pro-perk-desc">
                Early supporter access to upcoming 365-day daily puzzle archives, AI replay review, and guaranteed winnable deal modes as they roll out.
              </div>
            </div>
          </div>

          <div className="pro-perk">
            <span className="pro-perk-icon">❤️</span>
            <div>
              <div className="pro-perk-title">Direct Indie Game Support</div>
              <div className="pro-perk-desc">
                Support independent game development and help us keep card gaming clean, fast, and respectful.
              </div>
            </div>
          </div>
        </div>

        {pro ? (
          <div className="pro-active-banner">
            ✓ You have VIP Founder Status Active! Thank you for supporting Heist.
          </div>
        ) : (
          <a
            href={HEIST_PRO_STRIPE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="pro-buy-btn"
            aria-label="Unlock VIP Founder Pass for $4.99 on Stripe (opens in new tab)"
            onClick={() => {
              click();
              buzz("tap");
            }}
          >
            Unlock VIP Founder Pass — $4.99
          </a>
        )}

        <div className="pro-trust-footer">
          🔒 Secure checkout powered by Stripe · Apple Pay, Google Pay & Cards
        </div>
      </div>
    </div>
  );
}
