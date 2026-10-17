// Asymmetric "Beat My Score / Deal" Friend Challenge Modal & Card
// Lets players challenge friends to the exact same seed and displays head-to-head comparisons.

import { useState } from "react";
import { buzz } from "../haptics";
import { click } from "../sound";
import { shareFriendChallenge, type FriendChallengePayload } from "./shareHelpers";
import { t } from "../i18n";

export interface FriendChallengeModalProps {
  game: string;
  gameTitle: string;
  seed: number;
  time?: string;
  moves?: number;
  score?: number;
  challengerTime?: string | null;
  challengerMoves?: number | null;
  challengerScore?: number | null;
  onClose: () => void;
}

export function FriendChallengeModal({
  game,
  gameTitle,
  seed,
  time,
  moves,
  score,
  challengerTime,
  challengerMoves,
  challengerScore,
  onClose,
}: FriendChallengeModalProps) {
  const [copied, setCopied] = useState(false);

  const hasChallenger = Boolean(challengerTime || challengerMoves !== null || challengerScore !== null);

  // Determine winner if playing against a friend's record
  let beatChallenger = false;
  let tied = false;

  if (hasChallenger) {
    if (moves !== undefined && challengerMoves !== null && challengerMoves !== undefined) {
      if (moves < challengerMoves) beatChallenger = true;
      else if (moves === challengerMoves) tied = true;
    } else if (score !== undefined && challengerScore !== null && challengerScore !== undefined) {
      if (score > challengerScore) beatChallenger = true;
      else if (score === challengerScore) tied = true;
    }
  }

  const handleShare = async () => {
    click();
    buzz("tap");
    const ok = await shareFriendChallenge({
      game,
      gameTitle,
      seed,
      time,
      moves,
      score,
    });
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2400);
    }
  };

  return (
    <div className="daily-hub-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label={t("fc.aria")}>
      <div className="daily-hub-box" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="daily-hub-header">
          <div className="daily-title-group">
            <span className="daily-super">
              <span>⚔️</span> {t("dly.deal", { n: String(seed % 10000) })}
            </span>
            <h2 className="daily-title">
              {hasChallenger ? t("fc.h2h") : t("fc.challengeA")} <span>{t("fc.friend")}</span>
            </h2>
          </div>
          <button className="daily-close-btn" onClick={onClose} aria-label={t("fc.close")}>
            ✕
          </button>
        </div>

        {/* Head-to-Head Comparison if challenged */}
        {hasChallenger && (
          <div
            style={{
              background: beatChallenger
                ? "linear-gradient(135deg, rgba(34, 197, 94, 0.2), rgba(0, 0, 0, 0.4))"
                : "linear-gradient(135deg, rgba(231, 181, 60, 0.15), rgba(0, 0, 0, 0.4))",
              border: `1px solid ${beatChallenger ? "#22c55e" : "var(--gold)"}`,
              borderRadius: 14,
              padding: 16,
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 24, marginBottom: 4 }}>
              {beatChallenger ? t("fc.won") : tied ? t("fc.tied") : t("fc.close2")}
            </div>
            <div style={{ fontSize: 14, color: "#fff", fontWeight: 700 }}>
              {beatChallenger ? t("fc.beatText") : t("fc.leadText")}
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
                marginTop: 14,
                padding: "10px 0",
                borderTop: "1px solid rgba(255, 255, 255, 0.1)",
              }}
            >
              <div>
                <div style={{ fontSize: 11, color: "var(--gold)", fontFamily: "var(--cond)", letterSpacing: 1 }}>
                  {t("fc.yours")}
                </div>
                <div style={{ fontSize: 18, fontFamily: "var(--title)", color: "#fff" }}>
                  {time || t("fc.moves", { count: moves ?? 0 })}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "#a8a09b", fontFamily: "var(--cond)", letterSpacing: 1 }}>
                  {t("fc.theirs")}
                </div>
                <div style={{ fontSize: 18, fontFamily: "var(--title)", color: "#fff" }}>
                  {challengerTime || t("fc.moves", { count: challengerMoves ?? 0 })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Your stats card */}
        {!hasChallenger && (
          <div
            style={{
              background: "rgba(255, 255, 255, 0.04)",
              border: "1px solid rgba(231, 181, 60, 0.3)",
              borderRadius: 14,
              padding: 16,
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 13, color: "var(--gold)", fontFamily: "var(--cond)", letterSpacing: 1.5, textTransform: "uppercase" }}>
              {t("fc.perf")}
            </div>
            <div style={{ display: "flex", justifyContent: "center", gap: 20, marginTop: 8 }}>
              {time && (
                <div>
                  <span style={{ fontSize: 11, color: "#a8a09b", display: "block" }}>{t("fc.time")}</span>
                  <span style={{ fontSize: 22, fontFamily: "var(--title)", color: "#fff" }}>{time}</span>
                </div>
              )}
              {moves !== undefined && (
                <div>
                  <span style={{ fontSize: 11, color: "#a8a09b", display: "block" }}>{t("fc.movesLbl")}</span>
                  <span style={{ fontSize: 22, fontFamily: "var(--title)", color: "#fff" }}>{moves}</span>
                </div>
              )}
              {score !== undefined && (
                <div>
                  <span style={{ fontSize: 11, color: "#a8a09b", display: "block" }}>{t("fc.score")}</span>
                  <span style={{ fontSize: 22, fontFamily: "var(--title)", color: "#fff" }}>{score}</span>
                </div>
              )}
            </div>
            <div style={{ fontSize: 12, color: "#a8a09b", marginTop: 8 }}>
              {t("fc.sameDeal")}
            </div>
          </div>
        )}

        {/* Action button */}
        <button
          type="button"
          className="btn gold big"
          style={{ width: "100%", height: 50, fontSize: 16 }}
          onClick={handleShare}
          aria-label={t("fc.textAria")}
        >
          {copied ? t("fc.copied") : hasChallenger ? t("fc.textResult") : t("fc.invite")}
        </button>

        <button
          type="button"
          className="btn ghost"
          onClick={onClose}
          aria-label={t("common.close")}
        >
          {t("common.done")}

        </button>
      </div>
    </div>
  );
}
