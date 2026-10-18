import { useEffect, useState } from "react";
import { HEIST_PRO_STRIPE_URL, isHeistPro, onProChange } from "./pro";
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
  const [pro, setPro] = useState(isHeistPro);

  useEffect(() => {
    return onProChange(setPro);
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (isOpen) {
      window.addEventListener("keydown", handleKey);
    }
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="pro-modal-overlay" onClick={onClose} role="presentation">
      <div
        className="pro-modal-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pro-modal-title"
      >
        <button
          className="pro-modal-close"
          onClick={() => {
            click();
            buzz("tap");
            onClose();
          }}
          aria-label="Close"
        >
          ✕
        </button>

        <div className="pro-badge">👑 Lifetime Membership</div>
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
                Exclusive gold VIP badge and crown on your profile, leaderboards, and multiplayer tables.
              </div>
            </div>
          </div>

          <div className="pro-perk">
            <span className="pro-perk-icon">🛡️</span>
            <div>
              <div className="pro-perk-title">Streak Shield Protection</div>
              <div className="pro-perk-desc">
                Never lose your hard-earned 30-day or 100-day daily streaks if life gets busy.
              </div>
            </div>
          </div>

          <div className="pro-perk">
            <span className="pro-perk-icon">🚫</span>
            <div>
              <div className="pro-perk-title">100% Ad-Free Forever Guarantee</div>
              <div className="pro-perk-desc">
                Instant distraction-free gaming with zero 30-second video popups on phone and computer.
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
                Support independent game development and help us keep the web fast, fun, and free of spam.
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
