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
    <div className="pro-modal-overlay" onClick={onClose}>
      <div className="pro-modal-card" onClick={(e) => e.stopPropagation()}>
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

        <div className="pro-badge">👑 Premium Membership</div>
        <h2 className="pro-title">Heist Pro Pass</h2>

        <div className="pro-price-wrap">
          <span className="pro-price">$4.99</span>
          <span className="pro-price-sub">/ one-time · lifetime access</span>
        </div>

        <div className="pro-perks-list">
          <div className="pro-perk">
            <span className="pro-perk-icon">🗓️</span>
            <div>
              <div className="pro-perk-title">365-Day Daily Puzzle Archive</div>
              <div className="pro-perk-desc">Play every past daily puzzle and fill out your calendar with monthly trophies.</div>
            </div>
          </div>

          <div className="pro-perk">
            <span className="pro-perk-icon">🛡️</span>
            <div>
              <div className="pro-perk-title">Streak Shield Protection</div>
              <div className="pro-perk-desc">Never lose your 30-day or 100-day daily streaks if life gets busy.</div>
            </div>
          </div>

          <div className="pro-perk">
            <span className="pro-perk-icon">🧠</span>
            <div>
              <div className="pro-perk-title">100% Winnable Deals Engine</div>
              <div className="pro-perk-desc">Guaranteed mathematical solutions for Solitaire, FreeCell, and Spider.</div>
            </div>
          </div>

          <div className="pro-perk">
            <span className="pro-perk-icon">⏪</span>
            <div>
              <div className="pro-perk-title">AI "Pivotal Move" Rewind</div>
              <div className="pro-perk-desc">See the exact move where your deal branched and rewind straight to it.</div>
            </div>
          </div>

          <div className="pro-perk">
            <span className="pro-perk-icon">👑</span>
            <div>
              <div className="pro-perk-title">Gold VIP Profile & Percentile Stats</div>
              <div className="pro-perk-desc">Exclusive gold badge on multiplayer tables and global leaderboard percentiles.</div>
            </div>
          </div>
        </div>

        {pro ? (
          <div style={{ padding: "12px", background: "rgba(34, 197, 94, 0.15)", borderRadius: "14px", border: "1px solid #22c55e", color: "#86efac", fontWeight: 700 }}>
            ✓ You have Heist Pro Active! Thank you for supporting an ad-free web.
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
            Unlock Heist Pro — $4.99
          </a>
        )}

        <div className="pro-trust-footer">
          🔒 Secure checkout powered by Stripe · Apple Pay, Google Pay & Cards
        </div>
      </div>
    </div>
  );
}
