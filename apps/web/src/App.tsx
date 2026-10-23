import type { Answer } from "@heist/engine";
import { ALL_DRINKS, FIRST_HAND, currentPass, getDailyStreak, getStreakMultiplier, lessonFor, type Reward } from "@heist/profile";
import { AnimatePresence } from "motion/react";
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ProfileChip } from "./account/bits";
import { joinTable, useFriends, useFriendsSync } from "./account/social";
import { Rewards } from "./account/Rewards";
import { MemberModal } from "./account/MemberModal";
import type { LostAsk } from "./account/WhatLostYou";
import { AccountProvider, useAccount } from "./account/useAccount";
import "./account/account.css";
import "./account/premium.css";
import { CookieBanner } from "./account/CookieBanner";
import { Lobby, type LobbyChoice, type LobbyPage, type TourStep } from "./Lobby";
import { inviteCode, session } from "./online/session";
import type { ArcadeGameId } from "./arcade/ArcadeHub";
import { crazyGamesLoaded, onCrazyGames, onCrazyGamesSignIn, startPath, useCrazyGamesChatOff, useCrazyGamesPlay } from "./crazygames";
import { menuTaps } from "./menuTap";
import { trackScreen } from "./track";
import type { TableSettings } from "./useTable";
import { t } from "./i18n";

const Table = lazy(() => import("./table/Table").then((m) => ({ default: m.Table })));
const OnlineLobby = lazy(() => import("./online/OnlineLobby").then((m) => ({ default: m.OnlineLobby })));
const QueueBar = lazy(() => import("./online/OnlineLobby").then((m) => ({ default: m.QueueBar })));
const TableBar = lazy(() => import("./online/OnlineLobby").then((m) => ({ default: m.TableBar })));
const Solitaire = lazy(() => import("./solitaire/Solitaire").then((m) => ({ default: m.Solitaire })));
const FreeCell = lazy(() => import("./freecell/FreeCell").then((m) => ({ default: m.FreeCell })));
const TriPeaks = lazy(() => import("./tripeaks/TriPeaks").then((m) => ({ default: m.TriPeaks })));
const Ers = lazy(() => import("./ers/Ers").then((m) => ({ default: m.Ers })));
const Spider = lazy(() => import("./spider/Spider").then((m) => ({ default: m.Spider })));
const Pyramid = lazy(() => import("./pyramid/Pyramid").then((m) => ({ default: m.Pyramid })));
const Yukon = lazy(() => import("./yukon/Yukon").then((m) => ({ default: m.Yukon })));
const Scoundrel = lazy(() => import("./scoundrel/Scoundrel").then((m) => ({ default: m.Scoundrel })));
const Minesweeper = lazy(() => import("./minesweeper/Minesweeper").then((m) => ({ default: m.Minesweeper })));
const Sudoku = lazy(() => import("./sudoku/Sudoku").then((m) => ({ default: m.Sudoku })));
const Checkers = lazy(() => import("./checkers/Checkers").then((m) => ({ default: m.Checkers })));
const Hearts = lazy(() => import("./hearts/Hearts").then((m) => ({ default: m.Hearts })));
const Spades = lazy(() => import("./spades/Spades").then((m) => ({ default: m.Spades })));
const Profile = lazy(() => import("./account/Profile").then((m) => ({ default: m.Profile })));
const LoungeDock = lazy(() => import("./account/Friends").then((m) => ({ default: m.LoungeDock })));
const InviteToast = lazy(() => import("./account/Friends").then((m) => ({ default: m.InviteToast })));
const ArcadeHub = lazy(() => import("./arcade/ArcadeHub").then((m) => ({ default: m.ArcadeHub })));
const DailyHub = lazy(() => import("./daily/DailyHub").then((m) => ({ default: m.DailyHub })));
const WhatLostYou = lazy(() => import("./account/WhatLostYou").then((m) => ({ default: m.WhatLostYou })));
const ProModal = lazy(() => import("./account/ProModal").then((m) => ({ default: m.ProModal })));
import { checkStripeProReturn } from "./account/pro";

export function App() {
  return (
    <AccountProvider>
      <Game />
    </AccountProvider>
  );
}

interface Seated extends TableSettings {
  seed: number;
  gameId: string;
}

function Game() {
  const { me, backend, failed, suspended, act, showReward, error, clearError } = useAccount();
  // friends, requests, invites and messages stay fresh while the app is open
  useFriendsSync(backend, !!me);
  const friendsView = useFriends();
  // can't reach the server: check back every few seconds and reload once it answers
  useEffect(() => {
    if (!failed) return;
    const base = import.meta.env.VITE_SERVER_URL === "same-origin" ? "" : ((import.meta.env.VITE_SERVER_URL as string | undefined) ?? "").replace(/\/$/, "");
    const t = window.setInterval(() => {
      fetch(`${base}/api/config`, { cache: "no-store" }).then((r) => r.ok && location.reload(), () => {});
    }, 5000);
    return () => clearInterval(t);
  }, [failed]);
  const [table, setTable] = useState<Seated | null>(null);
  const [memberModalOpen, setMemberModalOpen] = useState(false);
  const [proModalOpen, setProModalOpen] = useState(false);
  useEffect(() => {
    if (checkStripeProReturn()) {
      setProModalOpen(true);
    }
  }, []);
  const [round, setRound] = useState(0);
  // the profile sheet and which tab it opens on (false = closed)
  const [profile, setProfile] = useState<false | LobbyPage | "account" | "friends">(() => (opened().friends ? "friends" : false));
  // a friend's chat to open (from a message notification)
  const [chatWith, setChatWith] = useState<string | null>(() => opened().chat);
  const finished = useRef(false);
  // "What lost you?": a brand-new player's first visit to the tables, asked once when they walk out of a
  // game or head back to the lobby (after finishing one, if they did)
  const firstGame = useRef(false);
  const finishedOne = useRef(false);
  const turnRef = useRef(0);
  const [ask, setAsk] = useState<LostAsk | null>(null);
  const [firstReward, setFirstReward] = useState<Reward | null>(null);
  // Solitaire: from the lobby, or straight in at playheist.net/solitaire (its own link to share)
  const [sol, setSolState] = useState(() => {
    const on = startPath() === "/solitaire";
    try {
      // someone who came for Solitaire isn't dropped into the Heist lesson when they head to the lobby
      if (on) localStorage.setItem("heist.welcomed", "1");
    } catch {
      /* fine without */
    }
    return on;
  });
  const setSol = useCallback((on: boolean) => {
    setSolState(on);
    try {
      history.replaceState(null, "", on ? "/solitaire" + location.search : "/" + location.search);
      if (on) localStorage.setItem("heist.welcomed", "1");
    } catch {
      /* fine without */
    }
  }, []);
  // FreeCell: from the lobby, or straight in at playheist.net/freecell (its own link to share)
  const [fc, setFcState] = useState(() => {
    const on = startPath() === "/freecell";
    try {
      if (on) localStorage.setItem("heist.welcomed", "1");
    } catch {
      /* fine without */
    }
    return on;
  });
  const setFc = useCallback((on: boolean) => {
    setFcState(on);
    try {
      history.replaceState(null, "", on ? "/freecell" + location.search : "/" + location.search);
      if (on) localStorage.setItem("heist.welcomed", "1");
    } catch {
      /* fine without */
    }
  }, []);
  // TriPeaks: from the lobby, or straight in at playheist.net/tripeaks (its own link to share)
  const [tp, setTpState] = useState(() => {
    const on = startPath() === "/tripeaks";
    try {
      if (on) localStorage.setItem("heist.welcomed", "1");
    } catch {
      /* fine without */
    }
    return on;
  });
  const setTp = useCallback((on: boolean) => {
    setTpState(on);
    try {
      history.replaceState(null, "", on ? "/tripeaks" + location.search : "/" + location.search);
      if (on) localStorage.setItem("heist.welcomed", "1");
    } catch {
      /* fine without */
    }
  }, []);
  // Egyptian Rat Screw: from the lobby, or straight in at playheist.net/ers (or via PvP duel invite ?join=)
  const [ersPvp, setErsPvp] = useState(() => {
    try {
      const p = new URLSearchParams(location.search);
      return p.has("join") || p.has("joinErs") || p.has("pvp") || startPath() === "/ers/pvp";
    } catch {
      return false;
    }
  });
  const [ers, setErsState] = useState(() => {
    let hasErsJoin = false;
    try {
      const p = new URLSearchParams(location.search);
      hasErsJoin = p.has("joinErs") || (p.has("join") && !p.has("table"));
    } catch {
      /* fine without */
    }
    const on = startPath() === "/ers" || startPath().startsWith("/ers") || hasErsJoin;
    try {
      if (on) localStorage.setItem("heist.welcomed", "1");
    } catch {
      /* fine without */
    }
    return on;
  });
  const setErs = useCallback((on: boolean) => {
    setErsState(on);
    if (!on) setErsPvp(false);
    try {
      history.replaceState(null, "", on ? "/ers" + location.search : "/" + location.search);
      if (on) localStorage.setItem("heist.welcomed", "1");
    } catch {
      /* fine without */
    }
  }, []);
  // Spider Solitaire: from the lobby, or straight in at playheist.net/spider
  const [spider, setSpiderState] = useState(() => {
    const on = startPath() === "/spider";
    try {
      if (on) localStorage.setItem("heist.welcomed", "1");
    } catch {
      /* fine without */
    }
    return on;
  });
  const setSpider = useCallback((on: boolean) => {
    setSpiderState(on);
    try {
      history.replaceState(null, "", on ? "/spider" + location.search : "/" + location.search);
      if (on) localStorage.setItem("heist.welcomed", "1");
    } catch {
      /* fine without */
    }
  }, []);
  // Pyramid Solitaire: from the lobby, or straight in at playheist.net/pyramid
  const [pyramid, setPyramidState] = useState(() => {
    const on = startPath() === "/pyramid";
    try {
      if (on) localStorage.setItem("heist.welcomed", "1");
    } catch {
      /* fine without */
    }
    return on;
  });
  const setPyramid = useCallback((on: boolean) => {
    setPyramidState(on);
    try {
      history.replaceState(null, "", on ? "/pyramid" + location.search : "/" + location.search);
      if (on) localStorage.setItem("heist.welcomed", "1");
    } catch {
      /* fine without */
    }
  }, []);
  // Yukon Solitaire: from the lobby, or straight in at playheist.net/yukon
  const [yukon, setYukonState] = useState(() => {
    const on = startPath() === "/yukon";
    try {
      if (on) localStorage.setItem("heist.welcomed", "1");
    } catch {
      /* fine without */
    }
    return on;
  });
  const setYukon = useCallback((on: boolean) => {
    setYukonState(on);
    try {
      history.replaceState(null, "", on ? "/yukon" + location.search : "/" + location.search);
      if (on) localStorage.setItem("heist.welcomed", "1");
    } catch {
      /* fine without */
    }
  }, []);
  // Scoundrel: from the lobby, or straight in at playheist.net/scoundrel
  const [scoundrel, setScoundrelState] = useState(() => {
    const on = startPath() === "/scoundrel";
    try {
      if (on) localStorage.setItem("heist.welcomed", "1");
    } catch {
      /* fine without */
    }
    return on;
  });
  const setScoundrel = useCallback((on: boolean) => {
    setScoundrelState(on);
    try {
      history.replaceState(null, "", on ? "/scoundrel" + location.search : "/" + location.search);
      if (on) localStorage.setItem("heist.welcomed", "1");
    } catch {
      /* fine without */
    }
  }, []);
  // Minesweeper: from the lobby, or straight in at playheist.net/minesweeper
  const [minesweeper, setMinesweeperState] = useState(() => {
    const on = startPath() === "/minesweeper";
    try {
      if (on) localStorage.setItem("heist.welcomed", "1");
    } catch {
      /* fine without */
    }
    return on;
  });
  const setMinesweeper = useCallback((on: boolean) => {
    setMinesweeperState(on);
    try {
      history.replaceState(null, "", on ? "/minesweeper" + location.search : "/" + location.search);
      if (on) localStorage.setItem("heist.welcomed", "1");
    } catch {
      /* fine without */
    }
  }, []);
  // Sudoku: from the lobby, or straight in at playheist.net/sudoku
  const [sudoku, setSudokuState] = useState(() => {
    const on = startPath() === "/sudoku";
    try {
      if (on) localStorage.setItem("heist.welcomed", "1");
    } catch {
      /* fine without */
    }
    return on;
  });
  const setSudoku = useCallback((on: boolean) => {
    setSudokuState(on);
    try {
      history.replaceState(null, "", on ? "/sudoku" + location.search : "/" + location.search);
      if (on) localStorage.setItem("heist.welcomed", "1");
    } catch {
      /* fine without */
    }
  }, []);
  // Checkers vs bot: from the lobby, or straight in at playheist.net/checkers
  const [checkers, setCheckersState] = useState(() => {
    const on = startPath() === "/checkers";
    try {
      if (on) localStorage.setItem("heist.welcomed", "1");
    } catch {
      /* fine without */
    }
    return on;
  });
  const setCheckers = useCallback((on: boolean) => {
    setCheckersState(on);
    try {
      history.replaceState(null, "", on ? "/checkers" + location.search : "/" + location.search);
      if (on) localStorage.setItem("heist.welcomed", "1");
    } catch {
      /* fine without */
    }
  }, []);
  // Hearts vs bots: from the lobby, or straight in at playheist.net/hearts
  const [hearts, setHeartsState] = useState(() => {
    const on = startPath() === "/hearts";
    try {
      if (on) localStorage.setItem("heist.welcomed", "1");
    } catch {
      /* fine without */
    }
    return on;
  });
  const setHearts = useCallback((on: boolean) => {
    setHeartsState(on);
    try {
      history.replaceState(null, "", on ? "/hearts" + location.search : "/" + location.search);
      if (on) localStorage.setItem("heist.welcomed", "1");
    } catch {
      /* fine without */
    }
  }, []);
  // Spades vs bots: from the lobby, or straight in at playheist.net/spades
  const [spades, setSpadesState] = useState(() => {
    const on = startPath() === "/spades";
    try {
      if (on) localStorage.setItem("heist.welcomed", "1");
    } catch {
      /* fine without */
    }
    return on;
  });
  const setSpades = useCallback((on: boolean) => {
    setSpadesState(on);
    try {
      history.replaceState(null, "", on ? "/spades" + location.search : "/" + location.search);
      if (on) localStorage.setItem("heist.welcomed", "1");
    } catch {
      /* fine without */
    }
  }, []);
  // the lobby tour a new player gets after their one-hand first lesson (kept, so a reload picks it up)
  const [tour, setTourState] = useState<TourStep | null>(savedTour);
  const setTour = useCallback((t: TourStep | null) => {
    setTourState(t);
    saveTour(t ?? "done");
  }, []);
  // an upright phone needs no asking: the table draws itself sideways (turn.ts)
  const enter = (go: () => void) => go();
  // online: the player's name, set while the friends lobby or an online table is open
  const [online, setOnline] = useState<string | null>(() =>
    inviteCode() ? savedName() : null,
  );
  // still in line for an online table after stepping out of the online lobby (its name, for the socket):
  // a bar on the other screens says so, and the table pulls the player back in when it's dealt
  const [away, setAwayState] = useState<string | null>(null);
  // a table you were dealt into before the app closed: the bar's "Back to table" sits you down there
  const [rejoin, setRejoin] = useState<string | null>(null);
  const awayRef = useRef<string | null>(null);
  const setAway = useCallback((n: string | null) => {
    awayRef.current = n;
    setAwayState(n);
  }, []);
  const openSoloGame = useCallback(
    (id: ArcadeGameId | null, pvp = false) => {
      setSol(id === "solitaire");
      setFc(id === "freecell");
      setTp(id === "tripeaks");
      setErs(id === "ers");
      if (id === "ers") setErsPvp(pvp);
      setSpider(id === "spider");
      setPyramid(id === "pyramid");
      setYukon(id === "yukon");
      setScoundrel(id === "scoundrel");
      setMinesweeper(id === "minesweeper");
      setSudoku(id === "sudoku");
      setCheckers(id === "checkers");
      setHearts(id === "hearts");
      setSpades(id === "spades");
    },
    [setSol, setFc, setTp, setErs, setSpider, setPyramid, setYukon, setScoundrel, setCheckers, setMinesweeper, setSudoku, setHearts, setSpades],
  );
  const activeSoloGame: ArcadeGameId | null =
    sol ? "solitaire"
    : fc ? "freecell"
    : tp ? "tripeaks"
    : ers ? "ers"
    : spider ? "spider"
    : pyramid ? "pyramid"
    : yukon ? "yukon"
    : scoundrel ? "scoundrel"
    : minesweeper ? "minesweeper"
    : sudoku ? "sudoku"
    : checkers ? "checkers"
    : hearts ? "hearts"
    : spades ? "spades"
    : null;
  const [arcadeHubOpen, setArcadeHubOpenState] = useState(() => {
    try {
      const p = startPath();
      const isHubPath = p === "/arcade" || p === "/card-games" || p === "/games";
      if (isHubPath) localStorage.setItem("heist.welcomed", "1");
      return isHubPath || new URLSearchParams(location.search).has("arcade");
    } catch {
      return false;
    }
  });
  const setArcadeHubOpen = useCallback((on: boolean) => {
    setArcadeHubOpenState(on);
    try {
      if (on) {
        history.replaceState(null, "", "/card-games" + location.search);
        localStorage.setItem("heist.welcomed", "1");
      } else if (startPath() === "/arcade" || startPath() === "/card-games" || startPath() === "/games") {
        history.replaceState(null, "", "/" + location.search);
      }
    } catch {
      /* fine without */
    }
  }, []);
  const [dailyHubOpen, setDailyHubOpen] = useState(() => {
    try {
      const p = new URLSearchParams(location.search);
      return p.has("daily");
    } catch {
      return false;
    }
  });

  const [gameConfig, setGameConfig] = useState<{
    seed?: number;
    isDaily?: boolean;
    challengerTime?: string | null;
    challengerMoves?: number | null;
    challengerScore?: number | null;
  }>(() => {
    try {
      const p = new URLSearchParams(location.search);
      const seedStr = p.get("challenge") ?? p.get("seed");
      const seed = seedStr ? parseInt(seedStr, 10) : undefined;
      // a daily deal needs its seed in the link (?dailyGame=1&seed=…); ?daily on its own just opens the Daily Hub
      const isDaily = p.has("dailyGame") && seed !== undefined && !Number.isNaN(seed);
      const challengerTime = p.get("ctime");
      const challengerMoves = p.has("cmoves") ? parseInt(p.get("cmoves")!, 10) : null;
      const challengerScore = p.has("cscore") ? parseInt(p.get("cscore")!, 10) : null;
      return {
        seed: Number.isNaN(seed) ? undefined : seed,
        isDaily,
        challengerTime,
        challengerMoves: Number.isNaN(challengerMoves) ? null : challengerMoves,
        challengerScore: Number.isNaN(challengerScore) ? null : challengerScore,
      };
    } catch {
      return {};
    }
  });

  const launchDailyGame = useCallback(
    (gameId: ArcadeGameId, seed: number) => {
      setDailyHubOpen(false);
      setGameConfig({
        seed,
        isDaily: true,
        challengerTime: null,
        challengerMoves: null,
        challengerScore: null,
      });
      openSoloGame(gameId);
    },
    [openSoloGame],
  );
  const backToLine = useCallback(() => {
    const n = awayRef.current;
    if (n === null) return;
    setAway(null);
    openSoloGame(null);
    setOnline(n);
  }, [setAway, openSoloGame]);
  // After an online game the server sends what it earned. It usually lands while the table is still
  // playing the last moves, so it's held until the table shows the end, then shown like a game vs bots.
  const onlineEnd = useRef<{ reward: Reward | null; ended: boolean }>({
    reward: null,
    ended: false,
  });
  useEffect(() => {
    if (online === null) return;
    return session(online).onMessage((m) => {
      if (m.t === "frames" && m.frames[0]?.i === 0)
        onlineEnd.current = { reward: null, ended: false };
      if (m.t === "renamed") {
        // the server saved it to the account; keep the copy guests use for their next invite too
        try {
          localStorage.setItem("heist.name", m.name);
        } catch {
          /* storage blocked */
        }
        void act((b) => b.me());
        return;
      }
      if (m.t !== "reward") return;
      void act((b) => b.me());
      if (onlineEnd.current.ended) showReward(m.reward);
      else onlineEnd.current.reward = m.reward;
    });
  }, [online, showReward, act]);
  // Tapping a notification while Heist is already open: the service worker hands over where it points.
  // An invite goes straight to the table, unless you're in a game (then its invite card waits for you).
  const busy = useRef(false);
  busy.current = !!table || (online !== null && session(online).room?.status === "playing" && session(online).seat !== null);
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const got = (e: MessageEvent) => {
      if (e.data?.t !== "heist-open" || typeof e.data.url !== "string") return;
      const q = new URL(e.data.url, location.href).searchParams;
      const code = q.get("table");
      if (code && /^[A-Za-z2-9]{5}$/.test(code)) {
        if (!busy.current) joinTable(code.toUpperCase());
        return;
      }
      if (q.get("chat") || q.get("friends")) {
        setChatWith(q.get("chat"));
        if (!busy.current) setProfile("friends");
      }
    };
    navigator.serviceWorker.addEventListener("message", got);
    return () => navigator.serviceWorker.removeEventListener("message", got);
  }, []);
  // the owner's activity log: which screen the player is on
  useEffect(() => {
    const screen =
      profile
        ? `Profile: ${profile}`
        : table
        ? table.stage
          ? `Campaign table ${table.stage}`
          : "Table vs bots"
        : online !== null
        ? "Online Heist"
        : sol
        ? "Klondike Solitaire"
        : fc
        ? "FreeCell"
        : tp
        ? "TriPeaks Solitaire"
        : spider
        ? "Spider Solitaire"
        : pyramid
        ? "Pyramid Solitaire"
        : ers
        ? (ersPvp ? "Egyptian Rat Screw (PvP)" : "Egyptian Rat Screw")
        : yukon
        ? "Yukon Solitaire"
        : scoundrel
        ? "Scoundrel"
        : minesweeper
        ? "Minesweeper"
        : sudoku
        ? "Sudoku"
        : checkers
        ? "Checkers"
        : hearts
        ? "Hearts"
        : spades
        ? "Spades"
        : dailyHubOpen
        ? "Daily Challenge Hub"
        : arcadeHubOpen
        ? "Card Games Hub"
        : "Lobby";
    trackScreen(screen);
  }, [profile, table, online, sol, fc, tp, spider, pyramid, ers, ersPvp, yukon, scoundrel, checkers, minesweeper, sudoku, hearts, spades, dailyHubOpen, arcadeHubOpen]);
  // a soft tap on the menus' buttons (the lobby and the sheets over it); never on a game screen, which
  // has its own sounds, nor online, where the lobby and table already play theirs
  const inMenu = !!profile || (!table && online === null && !sol && !fc && !tp && !spider && !pyramid && !ers && !yukon && !scoundrel && !checkers && !minesweeper && !sudoku && !hearts && !spades);
  useEffect(() => (inMenu ? menuTaps() : undefined), [inMenu]);
  // CrazyGames (does nothing elsewhere): loading ends with the account, gameplay is a table or solo game
  // (online tables tell it from OnlineLobby), and signing in to CrazyGames mid-visit links that account
  useEffect(() => {
    if (me) crazyGamesLoaded();
  }, [me]);
  useCrazyGamesPlay(!!me && (!!table || sol || fc || tp || spider || pyramid || ers || yukon || scoundrel || checkers || minesweeper || sudoku || hearts || spades));
  useEffect(() => onCrazyGamesSignIn(() => void act((b) => b.me())), [act]);
  const chatOff = useCrazyGamesChatOff();
  // the tour's Lounge stop: a hello with their name typed in (no chat on CrazyGames: straight on)
  const greetName = me ? (me.num ? `${me.name} #${me.num}` : me.name) : "";
  const greet = useMemo(
    () => (tour === "lounge" && !profile && greetName ? { text: t("lounge.greet_text", { name: greetName }), onDone: () => setTour("next") } : undefined),
    [tour, profile, greetName, setTour],
  );
  useEffect(() => {
    if (tour === "lounge" && chatOff) setTour("next");
  }, [tour, chatOff, setTour]);
  const onlineTableEnded = useCallback(() => {
    const e = onlineEnd.current;
    if (e.reward) showReward(e.reward);
    onlineEnd.current = { reward: null, ended: !e.reward };
  }, [showReward]);

  // The buy-in is paid and the seed comes from the account (the server, when there is one), so the
  // finished game can be checked and counted toward the career.
  const sit = useCallback(
    async (c: LobbyChoice) => {
      // a game vs bots takes the player out of the online queue (no table pulling them away mid-hand)
      if (awayRef.current !== null) {
        session(awayRef.current).client.unqueue();
        setAway(null);
      }
      if (me && c.name && c.name !== me.name)
        await act((b) => b.rename(c.name));
      const t = await act((b) => b.soloStart(c.players, c.stakes, c.name, c.campaign, c.coached));
      if (!t) return;
      if (t.quit) showReward(t.quit);
      finished.current = false;
      turnRef.current = 0;
      setFirstReward(null);
      if (me && !firstGame.current)
        firstGame.current = backend?.kind === "server" && !me.asked && !lostAsked() && !me.progress.coachGames && !me.progress.stats.games;
      setTable({
        players: t.players ?? c.players,
        name: c.name,
        stakes: t.stage || c.coached ? 0 : c.stakes,
        coached: c.coached,
        gentle: t.gentle,
        lesson: t.lesson,
        seed: t.seed,
        levels: t.levels,
        stage: t.stage,
        gameId: t.gameId,
      });
      setRound((r) => r + 1);
    },
    [me, backend, act, showReward, setAway],
  );

  const gameOver = useCallback(
    async (_won: number, answers: Answer[]) => {
      if (!table || finished.current) return;
      finished.current = true;
      if (firstGame.current) finishedOne.current = true;
      const r = await act((b) => b.soloFinish(table.gameId, answers));
      // the first hand shows its reward (and season pass tier 1) on its own game-over card
      if (r && table.lesson === FIRST_HAND) setFirstReward(r.reward);
      else if (r) showReward(r.reward);
    },
    [table, act, showReward],
  );

  // Walking out mid-game counts as a loss: the buy-in is already in the pot.
  const exit = useCallback(() => {
    if (!finished.current) void act((b) => b.soloQuit());
    // finished the first hand: the lobby tour comes next, not "What lost you?"
    const firstHandDone = finished.current && table?.lesson === FIRST_HAND;
    if (firstHandDone) {
      firstGame.current = false;
      if (!tourStarted()) setTour("profile");
    }
    if (firstGame.current && table && !me?.asked) {
      firstGame.current = false;
      markLostAsked();
      setAsk({ when: finishedOne.current || finished.current ? "finished" : "left", round: finishedOne.current || finished.current ? null : turnRef.current, coached: !!table.coached });
    }
    finished.current = true;
    setTable(null);
  }, [act, table, me, setTour]);

  const buyDrink = useCallback(
    async (emoji: string, count: number) => {
      const d = ALL_DRINKS.find((x) => x.emoji === emoji);
      return !!d && !!(await act((b) => b.drink(d.id, count)));
    },
    [act],
  );

  if (suspended)
    return (
      <div className="loading loading-failed">
        <div>Account suspended</div>
        <p>{suspended}</p>
        <p>If you think this is a mistake, email support@playheist.net.</p>
      </div>
    );
  if (!me)
    return failed ? (
      <div className="loading loading-failed">
        <div>Can't reach the vault</div>
        <p>The game server didn't answer, maybe it's restarting. Your account and chips are safe, and this page reconnects by itself when it's back.</p>
        <button className="btn primary big" onClick={() => location.reload()}>
          Try again
        </button>
      </div>
    ) : (
      <div className="loading">Opening the vault…</div>
    );
  const chips = me.progress.chips;
  // free packs from the season pass waiting to be opened: a dot on the player card leads to them
  const packs = currentPass(me.progress, Date.now())?.packs ?? 0;

  // Online games settle chips, XP and stats on the server (the socket signs in as this account), so the
  // lobby only needs to re-read the account when money moves.
  if (online !== null)
    return (
      <Suspense fallback={<div className="loading">Opening the vault…</div>}>
        <OnlineLobby
          name={online}
          chips={chips}
          join={rejoin ?? inviteCode()}
          onExit={() => {
            if (session(online).queue) setAway(online);
            setRejoin(null);
            setOnline(null);
            void act((b) => b.me());
          }}
          onArcade={(g) => {
            if (session(online).queue) setAway(online);
            setRejoin(null);
            setOnline(null);
            openSoloGame(g ?? "solitaire");
            void act((b) => b.me());
          }}
          onOpenArcade={() => {
            if (session(online).queue) setAway(online);
            setRejoin(null);
            setOnline(null);
            setArcadeHubOpen(true);
            void act((b) => b.me());
          }}
          onBuyIn={() => void act((b) => b.me())}
          onWin={() => {}}
          onEnd={() => {
            onlineTableEnded();
            void act((b) => b.me());
          }}
        />
        <Rewards />
      </Suspense>
    );

  if (sol && !table)
    return (
      <Suspense fallback={<div className="loading">Opening the vault…</div>}>
        <Solitaire
          initialSeed={gameConfig.seed}
          isDaily={gameConfig.isDaily}
          challengerTime={gameConfig.challengerTime}
          challengerMoves={gameConfig.challengerMoves}
          challengerScore={gameConfig.challengerScore}
          onExit={() => {
            setSol(false);
            setGameConfig({});
          }}
          banner={away !== null ? <QueueBar name={away} onBack={backToLine} onDone={() => setAway(null)} onSwitchGame={openSoloGame} activeGame="solitaire" onOpenArcade={() => setArcadeHubOpen(true)} inline /> : undefined}
          // only a guest who never played Heist gets the Heist button (their coached first hand); everyone else has Play now in the lobby
          onHeist={
            me.guest && !me.progress.coachGames && !me.progress.stats.games
              ? () => {
                  setSol(false);
                  setGameConfig({});
                  void sit({ players: 3, name: me.name, stakes: 0, coached: true });
                }
              : undefined
          }
          onSave={me.guest && !onCrazyGames ? () => setMemberModalOpen(true) : undefined}
        />
        <Rewards />
      </Suspense>
    );

  if (fc && !table)
    return (
      <Suspense fallback={<div className="loading">Opening the vault…</div>}>
        <FreeCell
          initialSeed={gameConfig.seed}
          isDaily={gameConfig.isDaily}
          challengerTime={gameConfig.challengerTime}
          challengerMoves={gameConfig.challengerMoves}
          challengerScore={gameConfig.challengerScore}
          onExit={() => {
            setFc(false);
            setGameConfig({});
          }}
          banner={away !== null ? <QueueBar name={away} onBack={backToLine} onDone={() => setAway(null)} onSwitchGame={openSoloGame} activeGame="freecell" onOpenArcade={() => setArcadeHubOpen(true)} inline /> : undefined}
          onHeist={
            me.guest && !me.progress.coachGames && !me.progress.stats.games
              ? () => {
                  setFc(false);
                  setGameConfig({});
                  void sit({ players: 3, name: me.name, stakes: 0, coached: true });
                }
              : undefined
          }
        />
        <Rewards />
      </Suspense>
    );

  if (tp && !table)
    return (
      <Suspense fallback={<div className="loading">Opening the vault…</div>}>
        <TriPeaks
          initialSeed={gameConfig.seed}
          isDaily={gameConfig.isDaily}
          challengerTime={gameConfig.challengerTime}
          challengerMoves={gameConfig.challengerMoves}
          challengerScore={gameConfig.challengerScore}
          onExit={() => {
            setTp(false);
            setGameConfig({});
          }}
          banner={away !== null ? <QueueBar name={away} onBack={backToLine} onDone={() => setAway(null)} onSwitchGame={openSoloGame} activeGame="tripeaks" onOpenArcade={() => setArcadeHubOpen(true)} inline /> : undefined}
          onHeist={
            me.guest && !me.progress.coachGames && !me.progress.stats.games
              ? () => {
                  setTp(false);
                  setGameConfig({});
                  void sit({ players: 3, name: me.name, stakes: 0, coached: true });
                }
              : undefined
          }
        />
        <Rewards />
      </Suspense>
    );

  if (ers && !table)
    return (
      <Suspense fallback={<div className="loading">Opening the vault…</div>}>
        <Ers
          initialPvp={ersPvp}
          initialSeed={gameConfig.seed}
          isDaily={gameConfig.isDaily}
          challengerTime={gameConfig.challengerTime}
          challengerMoves={gameConfig.challengerMoves}
          challengerScore={gameConfig.challengerScore}
          onExit={() => {
            setErs(false);
            setErsPvp(false);
            setGameConfig({});
          }}
          banner={away !== null ? <QueueBar name={away} onBack={backToLine} onDone={() => setAway(null)} onSwitchGame={openSoloGame} activeGame="ers" onOpenArcade={() => setArcadeHubOpen(true)} inline /> : undefined}
          onHeist={
            me.guest && !me.progress.coachGames && !me.progress.stats.games
              ? () => {
                  setErs(false);
                  setErsPvp(false);
                  setGameConfig({});
                  void sit({ players: 3, name: me.name, stakes: 0, coached: true });
                }
              : undefined
          }
        />
        <Rewards />
      </Suspense>
    );

  if (spider && !table)
    return (
      <Suspense fallback={<div className="loading">Opening the vault…</div>}>
        <Spider
          initialSeed={gameConfig.seed}
          isDaily={gameConfig.isDaily}
          challengerTime={gameConfig.challengerTime}
          challengerMoves={gameConfig.challengerMoves}
          challengerScore={gameConfig.challengerScore}
          onExit={() => {
            setSpider(false);
            setGameConfig({});
          }}
          banner={away !== null ? <QueueBar name={away} onBack={backToLine} onDone={() => setAway(null)} onSwitchGame={openSoloGame} activeGame="spider" onOpenArcade={() => setArcadeHubOpen(true)} inline /> : undefined}
          onHeist={
            me.guest && !me.progress.coachGames && !me.progress.stats.games
              ? () => {
                  setSpider(false);
                  setGameConfig({});
                  void sit({ players: 3, name: me.name, stakes: 0, coached: true });
                }
              : undefined
          }
        />
        <Rewards />
      </Suspense>
    );

  if (pyramid && !table)
    return (
      <Suspense fallback={<div className="loading">Opening the vault…</div>}>
        <Pyramid
          initialSeed={gameConfig.seed}
          isDaily={gameConfig.isDaily}
          challengerTime={gameConfig.challengerTime}
          challengerMoves={gameConfig.challengerMoves}
          challengerScore={gameConfig.challengerScore}
          onExit={() => {
            setPyramid(false);
            setGameConfig({});
          }}
          banner={away !== null ? <QueueBar name={away} onBack={backToLine} onDone={() => setAway(null)} onSwitchGame={openSoloGame} activeGame="pyramid" onOpenArcade={() => setArcadeHubOpen(true)} inline /> : undefined}
          onHeist={
            me.guest && !me.progress.coachGames && !me.progress.stats.games
              ? () => {
                  setPyramid(false);
                  setGameConfig({});
                  void sit({ players: 3, name: me.name, stakes: 0, coached: true });
                }
              : undefined
          }
        />
        <Rewards />
      </Suspense>
    );

  if (yukon && !table)
    return (
      <Suspense fallback={<div className="loading">Opening the vault…</div>}>
        <Yukon
          initialSeed={gameConfig.seed}
          isDaily={gameConfig.isDaily}
          challengerTime={gameConfig.challengerTime}
          challengerMoves={gameConfig.challengerMoves}
          challengerScore={gameConfig.challengerScore}
          onExit={() => {
            setYukon(false);
            setGameConfig({});
          }}
          banner={away !== null ? <QueueBar name={away} onBack={backToLine} onDone={() => setAway(null)} onSwitchGame={openSoloGame} activeGame="yukon" onOpenArcade={() => setArcadeHubOpen(true)} inline /> : undefined}
          onHeist={
            me.guest && !me.progress.coachGames && !me.progress.stats.games
              ? () => {
                  setYukon(false);
                  setGameConfig({});
                  void sit({ players: 3, name: me.name, stakes: 0, coached: true });
                }
              : undefined
          }
        />
        <Rewards />
      </Suspense>
    );

  if (scoundrel && !table)
    return (
      <Suspense fallback={<div className="loading">Opening the vault…</div>}>
        <Scoundrel
          initialSeed={gameConfig.seed}
          isDaily={gameConfig.isDaily}
          challengerTime={gameConfig.challengerTime}
          challengerMoves={gameConfig.challengerMoves}
          challengerScore={gameConfig.challengerScore}
          onExit={() => {
            setScoundrel(false);
            setGameConfig({});
          }}
          banner={away !== null ? <QueueBar name={away} onBack={backToLine} onDone={() => setAway(null)} onSwitchGame={openSoloGame} activeGame="scoundrel" onOpenArcade={() => setArcadeHubOpen(true)} inline /> : undefined}
          onHeist={
            me.guest && !me.progress.coachGames && !me.progress.stats.games
              ? () => {
                  setScoundrel(false);
                  setGameConfig({});
                  void sit({ players: 3, name: me.name, stakes: 0, coached: true });
                }
              : undefined
          }
        />
        <Rewards />
      </Suspense>
    );

  if (minesweeper && !table)
    return (
      <Suspense fallback={<div className="loading">Opening the vault…</div>}>
        <Minesweeper
          initialSeed={gameConfig.seed}
          isDaily={gameConfig.isDaily}
          challengerTime={gameConfig.challengerTime}
          challengerMoves={gameConfig.challengerMoves}
          challengerScore={gameConfig.challengerScore}
          onExit={() => {
            setMinesweeper(false);
            setGameConfig({});
          }}
          banner={away !== null ? <QueueBar name={away} onBack={backToLine} onDone={() => setAway(null)} onSwitchGame={openSoloGame} activeGame="minesweeper" onOpenArcade={() => setArcadeHubOpen(true)} inline /> : undefined}
          onHeist={
            me.guest && !me.progress.coachGames && !me.progress.stats.games
              ? () => {
                  setMinesweeper(false);
                  setGameConfig({});
                  void sit({ players: 3, name: me.name, stakes: 0, coached: true });
                }
              : undefined
          }
        />
        <Rewards />
      </Suspense>
    );

  if (sudoku && !table)
    return (
      <Suspense fallback={<div className="loading">Opening the vault…</div>}>
        <Sudoku
          initialSeed={gameConfig.seed}
          isDaily={gameConfig.isDaily}
          challengerTime={gameConfig.challengerTime}
          challengerMoves={gameConfig.challengerMoves}
          challengerScore={gameConfig.challengerScore}
          onExit={() => {
            setSudoku(false);
            setGameConfig({});
          }}
          banner={away !== null ? <QueueBar name={away} onBack={backToLine} onDone={() => setAway(null)} onSwitchGame={openSoloGame} activeGame="sudoku" onOpenArcade={() => setArcadeHubOpen(true)} inline /> : undefined}
          onHeist={
            me.guest && !me.progress.coachGames && !me.progress.stats.games
              ? () => {
                  setSudoku(false);
                  setGameConfig({});
                  void sit({ players: 3, name: me.name, stakes: 0, coached: true });
                }
              : undefined
          }
        />
        <Rewards />
      </Suspense>
    );

  if (checkers && !table)
    return (
      <Suspense fallback={<div className="loading">Opening the vault…</div>}>
        <Checkers
          initialSeed={gameConfig.seed}
          isDaily={gameConfig.isDaily}
          onExit={() => {
            setCheckers(false);
            setGameConfig({});
          }}
          banner={away !== null ? <QueueBar name={away} onBack={backToLine} onDone={() => setAway(null)} onSwitchGame={openSoloGame} activeGame="checkers" onOpenArcade={() => setArcadeHubOpen(true)} inline /> : undefined}
          onHeist={
            me.guest && !me.progress.coachGames && !me.progress.stats.games
              ? () => {
                  setCheckers(false);
                  setGameConfig({});
                  void sit({ players: 3, name: me.name, stakes: 0, coached: true });
                }
              : undefined
          }
        />
        <Rewards />
      </Suspense>
    );

  if (hearts && !table)
    return (
      <Suspense fallback={<div className="loading">Opening the vault…</div>}>
        <Hearts
          initialSeed={gameConfig.seed}
          isDaily={gameConfig.isDaily}
          onExit={() => {
            setHearts(false);
            setGameConfig({});
          }}
          banner={away !== null ? <QueueBar name={away} onBack={backToLine} onDone={() => setAway(null)} onSwitchGame={openSoloGame} activeGame="hearts" onOpenArcade={() => setArcadeHubOpen(true)} inline /> : undefined}
          onHeist={
            me.guest && !me.progress.coachGames && !me.progress.stats.games
              ? () => {
                  setHearts(false);
                  setGameConfig({});
                  void sit({ players: 3, name: me.name, stakes: 0, coached: true });
                }
              : undefined
          }
        />
        <Rewards />
      </Suspense>
    );

  if (spades && !table)
    return (
      <Suspense fallback={<div className="loading">Opening the vault…</div>}>
        <Spades
          initialSeed={gameConfig.seed}
          isDaily={gameConfig.isDaily}
          onExit={() => {
            setSpades(false);
            setGameConfig({});
          }}
          banner={away !== null ? <QueueBar name={away} onBack={backToLine} onDone={() => setAway(null)} onSwitchGame={openSoloGame} activeGame="spades" onOpenArcade={() => setArcadeHubOpen(true)} inline /> : undefined}
          onHeist={
            me.guest && !me.progress.coachGames && !me.progress.stats.games
              ? () => {
                  setSpades(false);
                  setGameConfig({});
                  void sit({ players: 3, name: me.name, stakes: 0, coached: true });
                }
              : undefined
          }
        />
        <Rewards />
      </Suspense>
    );

  return (
    <>
      {!table ? (
        <>
          <Lobby
            chips={chips}
            defaultName={
              me.guest && me.name.startsWith("Guest") ? undefined : me.name
            }
            onPlay={(c) => enter(() => void sit(c))}
            onRefill={() => act((b) => b.refill())}
            onOnline={(n) => enter(() => setOnline(n))}
            onOpen={setProfile}
            onSignIn={() => setProfile("account")}
            onSave={me.guest && !onCrazyGames ? () => setMemberModalOpen(true) : undefined}
            onSolitaire={() => setSol(true)}
            onFreeCell={() => setFc(true)}
            onTriPeaks={() => setTp(true)}
            onErs={() => setErs(true)}
            onSpider={() => setSpider(true)}
            onPyramid={() => setPyramid(true)}
            onYukon={() => setYukon(true)}
            onScoundrel={() => setScoundrel(true)}
            onMinesweeper={() => setMinesweeper(true)}
            onSudoku={() => setSudoku(true)}
            onCheckers={() => setCheckers(true)}
            onHearts={() => setHearts(true)}
            onSpades={() => setSpades(true)}
            cleared={me.progress.campaign ?? 0}
            newbie={!me.progress.coachGames && !me.progress.xp && !me.progress.prestige}
            nextLesson={lessonFor(me.progress.coachGames ?? 0)}
            tour={me.progress.coachGames ? tour : null}
            onTour={setTour}
            progress={me.progress}
            onOpenDaily={() => setDailyHubOpen(true)}
            onOpenPro={() => setProModalOpen(true)}
          />
          <div className="acct-corner">
            <ProfileChip
              me={me}
              packs={packs}
              onOpen={() => setProfile(packs ? "season" : "career")}
              onOpenShop={() => setProfile("shop")}
            />
          </div>
          {/* the Lounge opens after the first lesson, so a new player's first screen stays simple */}
          <Suspense fallback={null}>
            {(me.progress.coachGames || me.progress.xp || me.progress.prestige) && (!tour || greet) && !chatOff ? <LoungeDock meId={me.id} greet={greet} /> : null}
            {away !== null && <QueueBar name={away} onBack={backToLine} onDone={() => setAway(null)} onSwitchGame={openSoloGame} activeGame={null} onOpenArcade={() => setArcadeHubOpen(true)} />}
            {away === null && (
              <TableBar
                onBack={(code) => {
                  setRejoin(code);
                  setOnline(me.guest && me.name.startsWith("Guest") ? savedName() : me.name);
                }}
              />
            )}
          </Suspense>
        </>
      ) : (
        <Suspense fallback={<div className="loading">Opening the vault…</div>}>
          <Table
            key={round}
            settings={table}
            onExit={exit}
            onGameOver={gameOver}
            buyDrink={buyDrink}
            mistakes={me.progress.mistakes}
            place={table.coached ? "Learning to play" : table.stage ? `Campaign, stage ${table.stage}` : `${table.players} players vs bots`}
            turnRef={turnRef}
            firstReward={table.lesson === FIRST_HAND ? firstReward : null}
            onAgain={() => {
              if (chips < table.stakes) return exit();
              void sit({ ...table, campaign: table.stage });
            }}
          />
        </Suspense>
      )}
      <Suspense fallback={null}>
        <AnimatePresence>
          {profile && (
            <Profile
              key={profile}
              tab={profile}
              chat={profile === "friends" ? chatWith : null}
              onClose={() => {
                setProfile(false);
                setChatWith(null);
              }}
            />
          )}
        </AnimatePresence>
        <AnimatePresence>
          {arcadeHubOpen && (
            <ArcadeHub
              progress={me.progress}
              onOpenDaily={() => setDailyHubOpen(true)}
              onClose={() => setArcadeHubOpen(false)}
              onSelectGame={(id, pvp) => {
                setArcadeHubOpen(false);
                openSoloGame(id, pvp);
              }}
              activeGame={activeSoloGame}
            />
          )}
        </AnimatePresence>
        <AnimatePresence>
          {dailyHubOpen && (
            <DailyHub
              progress={me.progress}
              onClose={() => setDailyHubOpen(false)}
              onPlayChallenge={launchDailyGame}
              onOpenPro={() => setProModalOpen(true)}
            />
          )}
        </AnimatePresence>
      </Suspense>
      {profile && !table && tour === "lounge" && (
        <button className="btn primary tour-pill" data-track="tour-continue" onClick={() => setProfile(false)}>
          Keep going →
        </button>
      )}
      {/* no "save your progress" sign-in nudge on CrazyGames: their own account keeps it */}
      <Rewards onSave={onCrazyGames || !me?.guest ? undefined : () => setMemberModalOpen(true)} />
      {memberModalOpen && (
        <MemberModal
          isOpen={memberModalOpen}
          onClose={() => setMemberModalOpen(false)}
          streak={me?.progress ? Math.max(1, getDailyStreak(me.progress, Date.now())) : 1}
          xp={me?.progress?.xp ?? 150}
          multiplier={me?.progress ? getStreakMultiplier(Math.max(1, getDailyStreak(me.progress, Date.now()))) : 1}
          source="lobby_save"
        />
      )}
      <Suspense fallback={null}>
        <ProModal isOpen={proModalOpen} onClose={() => setProModalOpen(false)} />
      </Suspense>
      <Suspense fallback={null}>
        {!!friendsView?.invites.length && <InviteToast busy={!!table} />}
        <AnimatePresence>{ask && !table && <WhatLostYou key="lost" ask={ask} onDone={() => setAsk(null)} />}</AnimatePresence>
      </Suspense>
      {error && (
        <div className="acct-toast" role="alert" onClick={clearError}>
          {error}
        </div>
      )}
      {!onCrazyGames && <CookieBanner />}
    </>
  );
}

/** Opened from a friend request or message notification: ?friends=1 or ?chat=<friend> (read once, then cleared). */
let openedWith: { friends: boolean; chat: string | null } | null = null;
function opened() {
  if (openedWith) return openedWith;
  let q: URLSearchParams;
  try {
    q = new URLSearchParams(location.search);
  } catch {
    return (openedWith = { friends: false, chat: null });
  }
  const chat = q.get("chat");
  openedWith = { friends: q.has("friends") || !!chat, chat: chat && /^[\w-]{1,60}$/.test(chat) ? chat : null };
  if (openedWith.friends)
    try {
      history.replaceState(null, "", location.pathname);
    } catch {
      /* fine without */
    }
  return openedWith;
}

const TOUR_KEY = "heist.tour";
/** the lobby tour step a new player is on (null: never started; "done" counts as over) */
function savedTour(): TourStep | null {
  try {
    const v = localStorage.getItem(TOUR_KEY);
    // "wardrobe" and "season" were the old tour's steps (it spotlit the lobby's bottom bar, now gone)
    return v === "next" || v === "lounge" ? v : v === "profile" || v === "wardrobe" || v === "season" ? "profile" : null;
  } catch {
    return null;
  }
}
function tourStarted() {
  try {
    return localStorage.getItem(TOUR_KEY) !== null;
  } catch {
    return false;
  }
}
function saveTour(v: TourStep | "done") {
  try {
    localStorage.setItem(TOUR_KEY, v);
  } catch {
    // storage blocked: the tour just doesn't come back after a reload
  }
}

const LOST_KEY = "heist.lostAsked";
function lostAsked() {
  try {
    return !!localStorage.getItem(LOST_KEY);
  } catch {
    return false;
  }
}
function markLostAsked() {
  try {
    localStorage.setItem(LOST_KEY, "1");
  } catch {
    // storage blocked: the server still remembers
  }
}

function savedName() {
  try {
    return localStorage.getItem("heist.name") || "Ace";
  } catch {
    return "Ace";
  }
}
