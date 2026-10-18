import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
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

  // Focus management, background inert/aria-hidden, and Escape key handling
  useEffect(() => {
    if (!isOpen) return;

    prevFocusRef.current = document.activeElement as HTMLElement | null;

    // Focus close button on open
    const focusTimer = requestAnimationFrame(() => {
      closeBtnRef.current?.focus();
    });

    // Mark root inert and aria-hidden while modal is open in portal
    const root = document.getElementById("root");
    if (root) {
      root.setAttribute("aria-hidden", "true");
      root.setAttribute("inert", "");
    }

    const handleWindowKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
      }
    };

    window.addEventListener("keydown", handleWindowKeyDown);
    return () => {
      cancelAnimationFrame(focusTimer);
      if (root) {
        root.removeAttribute("aria-hidden");
        root.removeAttribute("inert");
      }
      window.removeEventListener("keydown", handleWindowKeyDown);
      if (prevFocusRef.current && document.body.contains(prevFocusRef.current)) {
        prevFocusRef.current.focus();
      }
    };
  }, [isOpen]);

  // Tab focus trap scoped to modal card
  const handleCardKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab" || !cardRef.current) return;

    const focusables = cardRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]):not([aria-hidden="true"]), [href]:not([aria-hidden="true"]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (focusables.length === 0) {
      e.preventDefault();
      return;
    }

    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    if (!cardRef.current.contains(document.activeElement)) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  if (!isOpen || typeof document === "undefined") return null;

  return createPortal(
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
                Exclusive gold VIP badge and crown on your seat, personal profile, and your rank on the leaderboard.
              </div>
            </div>
          </div>

          <div className="pro-perk">
            <span className="pro-perk-icon">🛡️</span>
            <div>
              <div className="pro-perk-title">Streak Shield Protection</div>
              <div className="pro-perk-desc">
                Permanent, unlimited streak protection — missed challenge days are shielded from breaking your streak without burning freezes.
              </div>
            </div>
          </div>

          <div className="pro-perk">
            <span className="pro-perk-icon">🚫</span>
            <div>
              <div className="pro-perk-title">Ad-Free Play</div>
              <div className="pro-perk-desc">
                Skip platform ads and midgame breaks. Enjoy uninterrupted, distraction-free card play on every game mode.
              </div>
            </div>
          </div>

          <div className="pro-perk">
            <span className="pro-perk-icon">🚀</span>
            <div>
              <div className="pro-perk-title">Founder Roadmap & Feedback Priority</div>
              <div className="pro-perk-desc">
                Direct priority on community feedback, upcoming game modes, and feature suggestions in the Heist Lounge.
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
    </div>,
    document.body
  );
}
