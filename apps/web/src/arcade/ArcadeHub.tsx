import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { Progress } from "@heist/profile";
import { shareUrl } from "../crazygames";
import { buzz } from "../haptics";
import { card as cardSound, click } from "../sound";
import { ChallengeBanner } from "../daily/ChallengeBanner";
import { t } from "../i18n";
import "./arcade.css";

export type ArcadeGameId =
  | "solitaire"
  | "freecell"
  | "spider"
  | "tripeaks"
  | "pyramid"
  | "yukon"
  | "ers"
  | "scoundrel"
  | "checkers"
  | "minesweeper"
  | "sudoku";

export type ArcadeCategory = "all" | "solitaire" | "action" | "puzzle";
export type ArcadeDifficulty = "Casual" | "Medium" | "Expert";

export interface ArcadeGame {
  id: ArcadeGameId;
  title: string;
  subtitle: string;
  tagline: string;
  category: "solitaire" | "action" | "puzzle";
  difficulty: ArcadeDifficulty;
  tags: string[];
  deckInfo: string;
  path: string;
  art: {
    cards: Array<{ rank: string; suit: string; red?: boolean; isSymbol?: boolean }>;
    badge?: string;
  };
  rules: {
    overview: string;
    goal: string;
    keyRule: string;
    tip: string;
  };
}

export const ARCADE_GAMES: ArcadeGame[] = [
  {
    id: "solitaire",
    title: "Solitaire",
    subtitle: "Classic Klondike",
    tagline: "The golden casino classic: build 4 suits from Ace to King.",
    category: "solitaire",
    difficulty: "Casual",
    tags: ["Cascade", "Foundation", "Draw 1/3"],
    deckInfo: "Standard 52-card deck",
    path: "/solitaire",
    art: {
      cards: [
        { rank: "A", suit: "♠", red: false },
        { rank: "K", suit: "♥", red: true },
      ],
      badge: "Classic",
    },
    rules: {
      overview: "Classic 7-column Klondike solitaire. Build columns in descending order with alternating colors.",
      goal: "Move all 52 cards to the 4 foundation piles at the top, building each suit up from Ace to King.",
      keyRule: "Only Kings (or stacks starting with a King) can fill empty tableau slots. Tap the stock pile to draw fresh cards.",
      tip: "Prioritize exposing face-down tableau cards before digging deep into the stock waste.",
    },
  },
  {
    id: "freecell",
    title: "FreeCell",
    subtitle: "8 Cascades & 4 Cells",
    tagline: "Pure strategy, zero luck: 4 open reserve cells and 8 cascade lanes.",
    category: "solitaire",
    difficulty: "Expert",
    tags: ["Cascade", "Open Info", "4 Reserve Cells"],
    deckInfo: "Standard 52-card deck (Face-up)",
    path: "/freecell",
    art: {
      cards: [
        { rank: "8", suit: "♣", red: false },
        { rank: "7", suit: "♦", red: true },
      ],
      badge: "Open Info",
    },
    rules: {
      overview: "All 52 cards are dealt face-up into 8 cascade columns. Nearly every deal is mathematically winnable.",
      goal: "Sort all 4 suits onto the foundations from Ace to King.",
      keyRule: "Use 4 free cells to hold temporary staging cards. The number of cards you can move together depends on open free cells and columns.",
      tip: "Empty an entire tableau column early. It acts as an unlimited super-cell to maneuver complex runs.",
    },
  },
  {
    id: "spider",
    title: "Spider Solitaire",
    subtitle: "10 Tableau Columns",
    tagline: "Master 10 tableau cascades and assemble full King-to-Ace suit runs.",
    category: "solitaire",
    difficulty: "Expert",
    tags: ["10 Columns", "Suit Runs", "High Depth"],
    deckInfo: "104 cards (2 decks)",
    path: "/spider",
    art: {
      cards: [
        { rank: "K", suit: "♠", red: false },
        { rank: "A", suit: "♠", red: false },
      ],
      badge: "10 Columns",
    },
    rules: {
      overview: "104 cards dealt across 10 tableau columns. Build complete descending sequences from King down to Ace.",
      goal: "Assemble 8 full King-to-Ace suit sequences to clear them from the board.",
      keyRule: "Pack cards down in rank regardless of suit, but only same-suit sequences can be moved together! Empty spaces take any card or run.",
      tip: "Keep sequences single-suited whenever possible. Split-suit stacks paralyze your column mobility.",
    },
  },
  {
    id: "tripeaks",
    title: "TriPeaks",
    subtitle: "3 Cascading Summits",
    tagline: "Chain ascending & descending runs to topple 3 peaks in record time.",
    category: "solitaire",
    difficulty: "Casual",
    tags: ["Combo Streak", "Fast Clear", "Pyramidal"],
    deckInfo: "Standard 52-card deck",
    path: "/tripeaks",
    art: {
      cards: [
        { rank: "Q", suit: "♠", red: false },
        { rank: "K", suit: "♥", red: true },
      ],
      badge: "Combo Runs",
    },
    rules: {
      overview: "Three overlapping peaks of face-down cards topped by face-up base cards, with an active waste card.",
      goal: "Clear all cards from the three peaks into the waste pile before your draw pile runs out.",
      keyRule: "Tap any uncovered peak card that is exactly 1 rank higher or 1 rank lower than the active waste card (Aces connect with Kings).",
      tip: "Plan ahead for long alternating up/down runs. Long combos earn massive streak XP multipliers!",
    },
  },
  {
    id: "pyramid",
    title: "Pyramid",
    subtitle: "Sum to 13 Pair Elimination",
    tagline: "Pair exposed cards that sum to 13 to tear down the 28-card vault.",
    category: "solitaire",
    difficulty: "Medium",
    tags: ["Pair to 13", "Kings Solo", "Uncover Layers"],
    deckInfo: "Standard 52-card deck",
    path: "/pyramid",
    art: {
      cards: [
        { rank: "K", suit: "♦", red: true },
        { rank: "7", suit: "♠", red: false },
      ],
      badge: "Pairing",
    },
    rules: {
      overview: "A 28-card pyramid arranged in 7 overlapping rows, backed by a draw stock and discard waste.",
      goal: "Clear every card from the pyramid by pairing exposed cards that add up to 13.",
      keyRule: "Values: Ace=1, 2-10=value, J=11, Q=12, K=13. Kings discard alone. Only completely uncovered cards can be paired.",
      tip: "Always check if matching a card unlocks two cards below it before drawing from the stock.",
    },
  },
  {
    id: "yukon",
    title: "Yukon",
    subtitle: "Deep Stack Maneuvers",
    tagline: "Move deep un-ordered piles without restriction to build 4 foundations.",
    category: "solitaire",
    difficulty: "Medium",
    tags: ["Deep Moves", "Wild Tableau", "Alternating"],
    deckInfo: "Standard 52-card deck",
    path: "/yukon",
    art: {
      cards: [
        { rank: "K", suit: "♠", red: false },
        { rank: "Q", suit: "♦", red: true },
      ],
      badge: "Deep Drag",
    },
    rules: {
      overview: "7 tableau columns with all remaining deck cards dealt face-up immediately. No reserve stock pile.",
      goal: "Transfer all 52 cards to the 4 foundations in suit order from Ace up to King.",
      keyRule: "Move ANY face-up card regardless of how deep it is in a column, dragging all cards on top along with it! Target must match alternating color & descending rank.",
      tip: "Dig towards face-down cards relentlessly. Freeing up an empty column lets you park a King stack.",
    },
  },
  {
    id: "ers",
    title: "Egyptian Rat Screw",
    subtitle: "Combat Slap & 2P Duel",
    tagline: "High-octane card duel: live 2-player multiplayer with invite links or solo vs bot.",
    category: "action",
    difficulty: "Expert",
    tags: ["2P Online Duel", "Invite Friends", "Reaction", "Slap Rules"],
    deckInfo: "Shared 52-card duel deck",
    path: "/ers",
    art: {
      cards: [
        { rank: "J", suit: "♣", red: false },
        { rank: "⚡", suit: "", red: true, isSymbol: true },
      ],
      badge: "2P Duel",
    },
    rules: {
      overview: "Fast-action card-slapping game. Play solo against AI bots, or challenge friends with a shareable invite link in real-time 2-player PvP!",
      goal: "Capture the entire deck by winning face-card challenge bounties and slapping pile combinations.",
      keyRule: "Face cards demand tributes (Ace=4, King=3, Queen=2, Jack=1 cards). Slap on Doubles (7-7), Sandwiches (8-K-8), Tens (6+4), Marriage (K-Q), or Top-Bottom match!",
      tip: "Keep your finger hovered right over the slap target. Hesitation for even a fraction of a second costs the pot!",
    },
  },
  {
    id: "scoundrel",
    title: "Scoundrel",
    subtitle: "Card Dungeon Roguelike",
    tagline: "Cult-classic rogue dungeon crawler: slay beasts, equip blades, survive.",
    category: "action",
    difficulty: "Medium",
    tags: ["Dungeon Crawl", "Roguelike", "Weapon & HP"],
    deckInfo: "44-card dungeon deck (No red faces)",
    path: "/scoundrel",
    art: {
      cards: [
        { rank: "💀", suit: "", red: false, isSymbol: true },
        { rank: "🗡️", suit: "", red: true, isSymbol: true },
      ],
      badge: "Roguelike",
    },
    rules: {
      overview: "Zach Gage & Kurt Bieg's iconic roguelike dungeon crawler played with a stripped 44-card deck.",
      goal: "Clear the entire dungeon deck and emerge alive with 1 or more HP.",
      keyRule: "Rooms hold 4 cards. Face 3 before advancing or flee (can't flee two rooms in a row). Clubs/Spades are Monsters. Diamonds are Weapons. Hearts are Healing Potions.",
      tip: "Fight low-rank monsters (2-4) barehanded to preserve your high-value weapon durability for dragons (J, Q, K).",
    },
  },
  {
    id: "minesweeper",
    title: "Minesweeper",
    subtitle: "Crack the Minefield",
    tagline: "The logic classic, vault edition: read the numbers, flag the mines, crack the safe.",
    category: "puzzle",
    difficulty: "Medium",
    tags: ["Logic", "3 Boards", "Safe First Click", "Chording"],
    deckInfo: "Beginner 9x9 · Intermediate 16x16 · Expert 16x30",
    path: "/minesweeper",
    art: {
      cards: [
        { rank: "💣", suit: "", red: false, isSymbol: true },
        { rank: "🚩", suit: "", red: true, isSymbol: true },
      ],
      badge: "Logic",
    },
    rules: {
      overview: "Classic Minesweeper on three boards: Beginner (10 mines), Intermediate (40) and Expert (99). Your first click is always safe.",
      goal: "Open every cell that doesn't hide a mine.",
      keyRule: "A number shows how many of its 8 neighbours are mines. Long-press (or flag mode, or right-click) to flag. Tap a number whose mines are all flagged to open the rest around it.",
      tip: "Look for 1-2-1 and 1-2-2-1 patterns along walls of opened cells: they tell you exactly where the mines sit without guessing.",
    },
  },
  {
    id: "sudoku",
    title: "Sudoku",
    subtitle: "The Combination Lock",
    tagline: "Unique-solution puzzles from Easy to Expert, graded by the techniques they take.",
    category: "puzzle",
    difficulty: "Medium",
    tags: ["Logic", "Pencil Marks", "4 Levels", "Hints"],
    deckInfo: "9x9 grid · Easy, Medium, Hard, Expert",
    path: "/sudoku",
    art: {
      cards: [
        { rank: "9", suit: "", red: false, isSymbol: true },
        { rank: "🔐", suit: "", red: true, isSymbol: true },
      ],
      badge: "Puzzle",
    },
    rules: {
      overview: "Fill the grid so every row, column and 3x3 box holds 1 to 9 exactly once. Every puzzle has exactly one solution.",
      goal: "Complete the grid with fewer than 3 mistakes.",
      keyRule: "A wrong digit counts as a mistake, and three mistakes end the puzzle. Pencil marks are free, and correct digits lock in place.",
      tip: "Scan each box for the one cell a digit can go (hidden singles) before reaching for pencil marks.",
    },
  },
  {
    id: "checkers",
    title: "Checkers",
    subtitle: "Duel the House Bot",
    tagline: "Casino-noir checkers with poker-chip pieces: outjump the Rookie, the Pro and the Boss.",
    category: "action",
    difficulty: "Medium",
    tags: ["Vs Bot", "3 Difficulties", "Strategy", "Kings"],
    deckInfo: "8x8 board, 12 chips a side",
    path: "/checkers",
    art: {
      cards: [
        { rank: "⛀", suit: "", red: true, isSymbol: true },
        { rank: "♛", suit: "", red: false, isSymbol: true },
      ],
      badge: "Vs Bot",
    },
    rules: {
      overview: "Classic American checkers on an 8x8 board against a house bot at Rookie, Pro or Boss strength.",
      goal: "Capture every bot chip, or leave it with no legal move.",
      keyRule: "Chips move diagonally forward; jumps are forced and chain into multi-jumps. Reach the far row to crown a king that moves both ways. 40 moves each without a capture, or a position seen three times, is a draw.",
      tip: "Keep your back row home as long as you can: it stops the bot crowning kings behind your lines.",
    },
  },
];

export interface ArcadeHubProps {
  onClose: () => void;
  onSelectGame: (gameId: ArcadeGameId, pvp?: boolean) => void;
  activeGame?: ArcadeGameId | null;
  progress?: Progress;
  onOpenDaily?: () => void;
}

export function ArcadeHub({ onClose, onSelectGame, activeGame, progress, onOpenDaily }: ArcadeHubProps) {
  const [tab, setTab] = useState<ArcadeCategory>("all");
  const [search, setSearch] = useState("");
  const [openRules, setOpenRules] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toggleRules = (id: string) => {
    click();
    buzz("tap");
    setOpenRules((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const copyGameLink = async (game: ArcadeGame) => {
    // on CrazyGames, their invite link to the game on their portal (see crazygames.ts)
    const url = shareUrl(game.path);
    buzz("tap");
    click();
    try {
      if (navigator.share) {
        await navigator.share({
          title: `Heist Solo Arcade - ${game.title}`,
          text: `Play ${game.title} on Heist Solo Arcade!`,
          url,
        });
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        setCopiedId(game.id);
        window.setTimeout(() => {
          setCopiedId((curr) => (curr === game.id ? null : curr));
        }, 1800);
      }
    } catch {
      /* user dismissed native share */
    }
  };

  const filteredGames = useMemo(() => {
    return ARCADE_GAMES.filter((game) => {
      if (tab === "solitaire" && game.category !== "solitaire") return false;
      if (tab === "action" && game.category !== "action") return false;
      if (tab === "puzzle" && game.category !== "puzzle") return false;

      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        game.title.toLowerCase().includes(q) ||
        game.subtitle.toLowerCase().includes(q) ||
        game.tagline.toLowerCase().includes(q) ||
        game.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [tab, search]);

  const solitaireCount = useMemo(
    () => ARCADE_GAMES.filter((g) => g.category === "solitaire").length,
    [],
  );
  const actionCount = useMemo(
    () => ARCADE_GAMES.filter((g) => g.category === "action").length,
    [],
  );
  const puzzleCount = useMemo(
    () => ARCADE_GAMES.filter((g) => g.category === "puzzle").length,
    [],
  );

  return createPortal(
    <div className="arcade-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label="Solo Arcade Hub">
      <div className="arcade-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="arcade-header">
          <div className="arcade-title-group">
            <div className="arcade-badge-row">
              <span className="arcade-pill-badge">
                <span className="sparkle">✦</span> {t("arcade.badge")}
              </span>
            </div>
            <h2 className="arcade-title">
              {t("arcade.title_prefix")} <span>{t("arcade.title_suffix")}</span>
            </h2>
            <p className="arcade-tagline">
              {t("arcade.tagline")}
            </p>
          </div>
          <button
            className="arcade-back-lobby-btn"
            onClick={() => {
              click();
              buzz("tap");
              onClose();
            }}
            aria-label={t("common.back_to_lobby")}
          >
            <span className="arcade-back-arrow">←</span>
            <span className="arcade-back-text">{t("common.back_to_lobby")}</span>
          </button>
        </div>

        {/* Bridge to Multiplayer Heist */}
        <div
          className="arcade-heist-bridge"
          onClick={() => {
            click();
            buzz("tap");
            onClose();
          }}
          role="button"
          tabIndex={0}
          aria-label="Enter Multiplayer Heist"
        >
          <div className="arcade-heist-bridge-left">
            <div className="arcade-heist-bridge-badge">
              <span className="sparkle">🃏</span> {t("arcade.bridge_badge")}
            </div>
            <div className="arcade-heist-bridge-title">
              {t("arcade.bridge_title")}
            </div>
            <div className="arcade-heist-bridge-desc">
              {t("arcade.bridge_desc")}
            </div>
          </div>
          <button
            type="button"
            className="arcade-heist-bridge-btn"
            onClick={(e) => {
              e.stopPropagation();
              click();
              buzz("tap");
              onClose();
            }}
          >
            {t("arcade.bridge_btn")}
          </button>
        </div>

        {onOpenDaily && (
          <div style={{ padding: "0 20px 10px" }}>
            <ChallengeBanner progress={progress} onOpenDaily={onOpenDaily} />
          </div>
        )}

        {/* Filter Tabs & Search */}
        <div className="arcade-controls-bar">
          <div className="arcade-tabs" role="tablist">
            <button
              className={`arcade-tab-btn ${tab === "all" ? "active" : ""}`}
              onClick={() => {
                click();
                buzz("tap");
                setTab("all");
              }}
              role="tab"
              aria-selected={tab === "all"}
            >
              {t("arcade.tab_all")} <span className="arcade-tab-count">{ARCADE_GAMES.length}</span>
            </button>
            <button
              className={`arcade-tab-btn ${tab === "solitaire" ? "active" : ""}`}
              onClick={() => {
                click();
                buzz("tap");
                setTab("solitaire");
              }}
              role="tab"
              aria-selected={tab === "solitaire"}
            >
              {t("arcade.tab_solitaire")} <span className="arcade-tab-count">{solitaireCount}</span>
            </button>
            <button
              className={`arcade-tab-btn ${tab === "action" ? "active" : ""}`}
              onClick={() => {
                click();
                buzz("tap");
                setTab("action");
              }}
              role="tab"
              aria-selected={tab === "action"}
            >
              {t("arcade.tab_action")} <span className="arcade-tab-count">{actionCount}</span>
            </button>
            <button
              className={`arcade-tab-btn ${tab === "puzzle" ? "active" : ""}`}
              onClick={() => {
                click();
                buzz("tap");
                setTab("puzzle");
              }}
              role="tab"
              aria-selected={tab === "puzzle"}
            >
              {t("arcade.tab_puzzle")} <span className="arcade-tab-count">{puzzleCount}</span>
            </button>
          </div>

          <div className="arcade-search-box">
            <span className="arcade-search-icon" aria-hidden>🔍</span>
            <input
              type="text"
              className="arcade-search-input"
              placeholder={t("arcade.filter_placeholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Filter arcade games"
            />
          </div>
        </div>

        {/* Scrollable Games Grid */}
        <div className="arcade-body">
          <div className="arcade-grid">
            {filteredGames.map((game) => {
              const isOpen = !!openRules[game.id];
              const isCurrent = activeGame === game.id;
              const isCopied = copiedId === game.id;

              return (
                <article
                  key={game.id}
                  className={`arcade-card ${isCurrent ? "active-game" : ""}`}
                >
                  <div className="arcade-card-top">
                    {/* Mini card visual */}
                    <div className="arcade-card-art" aria-hidden="true">
                      {game.art.cards.map((c, i) => (
                        <div
                          key={i}
                          className={`arcade-mini-card ${i === 0 ? "c1" : "c2"} ${c.red ? "red" : ""} ${c.isSymbol ? "symbol-card" : ""}`}
                        >
                          {c.isSymbol ? (
                            <span>{c.rank}</span>
                          ) : (
                            <>
                              <span>{c.rank}</span>
                              <i>{c.suit}</i>
                            </>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Metadata */}
                    <div className="arcade-card-meta">
                      <div className="arcade-card-row-1">
                        <h3 className="arcade-game-name">{game.title}</h3>
                        <span
                          className={`arcade-difficulty ${game.difficulty.toLowerCase()}`}
                          title={`Difficulty: ${game.difficulty}`}
                        >
                          {game.difficulty}
                        </span>
                      </div>
                      <span className="arcade-game-subtitle">{game.subtitle}</span>
                      <p className="arcade-game-tagline">{game.tagline}</p>
                    </div>
                  </div>

                  {/* Core Mechanic Tags */}
                  <div className="arcade-tags-row">
                    <span className="arcade-mechanic-tag arcade-deck-tag">
                      🂠 {game.deckInfo}
                    </span>
                    {game.tags.map((tag) => (
                      <span key={tag} className="arcade-mechanic-tag">
                        {tag}
                      </span>
                    ))}
                  </div>

                  {/* Quick "How to play" dropdown */}
                  <button
                    type="button"
                    className={`arcade-how-to-toggle ${isOpen ? "open" : ""}`}
                    onClick={() => toggleRules(game.id)}
                    aria-expanded={isOpen}
                    aria-label={`How to play and rules for ${game.title}`}
                  >
                    <span>How to play & Rules</span>
                    <span className="arrow" aria-hidden>▼</span>
                  </button>

                  {isOpen && (
                    <div className="arcade-rules-drawer">
                      <div className="arcade-rule-item">
                        <span className="arcade-rule-label">🎯 Goal</span>
                        <p className="arcade-rule-text">{game.rules.goal}</p>
                      </div>
                      <div className="arcade-rule-item">
                        <span className="arcade-rule-label">📜 Core Rule</span>
                        <p className="arcade-rule-text">{game.rules.keyRule}</p>
                      </div>
                      <div className="arcade-rule-item tip">
                        <span className="arcade-rule-label">💡 Winning Tip</span>
                        <p className="arcade-rule-text">{game.rules.tip}</p>
                      </div>
                    </div>
                  )}

                  {/* Footer actions */}
                  <div className="arcade-card-actions">
                    <button
                      type="button"
                      className="arcade-link-btn"
                      onClick={() => copyGameLink(game)}
                      title={`Direct link: ${game.path} (Click to copy)`}
                      aria-label={`Copy direct link for ${game.title}`}
                    >
                      <span className="chain-icon" aria-hidden>🔗</span>
                      <span>{isCopied ? "Link Copied!" : game.path}</span>
                    </button>

                    {game.id === "ers" && (
                      <button
                        type="button"
                        className="arcade-duel-btn"
                        onClick={() => {
                          cardSound();
                          buzz("tap");
                          onSelectGame(game.id, true);
                        }}
                        aria-label="Play 2-Player Real-time PvP Duel"
                        title="2-Player PvP with Invite Link"
                      >
                        ⚔️ 2P DUEL
                      </button>
                    )}

                    <button
                      type="button"
                      className="arcade-play-btn"
                      onClick={() => {
                        cardSound();
                        buzz("tap");
                        onSelectGame(game.id, false);
                      }}
                      aria-label={`${isCurrent ? "Resume" : "Play"} ${game.title}`}
                    >
                      {isCurrent ? "RESUME" : "PLAY"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
