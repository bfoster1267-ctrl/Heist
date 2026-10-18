import {
  easySeed, lessonFor, FIRST_HAND, settleSolitaire, solPay, tallySol, type SolTally, settleFreeCell, fcPay, tallyFreeCell, type FcTally, settleTriPeaks, tpPay, tallyTriPeaks, type TpTally, settleErs, ersPay, tallyErs, type ErsTally, settleSpider, spiderPay, tallySpider, type SpiderTally, settlePyramid, pyramidPay, tallyPyramid, type PyramidTally, settleYukon, yukonPay, tallyYukon, type YukonTally, settleScoundrel, scoundrelPay, tallyScoundrel, type ScoundrelTally, settleCheckers, checkersPay, replayCheckers, checkersTallyOf, isCheckersLevel, type CheckersTally, type CheckersLevel, settleMinesweeper, minesPay, tallyMines, isMinesLevel, MINES_DAILY_LEVEL, type MinesTally, type MinesLevel, settleSudoku, sudokuPay, tallySudoku, isSudokuLevel, SUDOKU_DAILY_LEVEL, getDailySeed, todayUtc, type SudokuTally, type SudokuLevel,
  settleHearts, heartsPay, replayHearts, heartsTallyOf, isHeartsLevel, type HeartsTally, type HeartsLevel,
  settleSpades, spadesPay, replaySpades, spadesTallyOf, isSpadesLevel, type SpadesTally, type SpadesLevel,
  addMistakes, buy, buyIn, daily, settleCoached, equip, failed, newProgress, openPack, payForDrink, payout, prestige, publicProfile, refill, replaySolo, settle,
  botLevelsFor, soloRivals, stage, summarize, upgrade, buyStreakFreeze, claimDailyVault, claimWelcomeGift, type Fail, type Progress, type PublicProfile, type Reward,
} from "@heist/profile";
import type { BotLevel } from "@heist/engine";
import { BackendError, store, type Backend, type Config, type LeaderRow, type Me, type PackOpened, type SoloTicket } from "./backend";
import { isHeistPro, onProChange } from "./pro";

interface LocalSave {
  id: string;
  name: string;
  joined: number;
  progress: Progress;
  solo: { gameId: string; seed: number; players: number; stakes: number; levels?: BotLevel[]; stage?: number; coached?: boolean; gentle?: boolean; lesson?: number } | null;
}

const LOCAL_KEY = "heist.profile";

export class BrowserBackend implements Backend {
  readonly kind = "browser" as const;
  readonly config: Config = { providers: [], apple: null, google: null, facebook: null };
  private save: LocalSave;

  constructor() {
    let s: LocalSave | null = null;
    try {
      s = JSON.parse(store.get(LOCAL_KEY) ?? "null");
    } catch {
      s = null;
    }
    if (!s) {
      const p = newProgress();
      // chips from before profiles existed carry over
      const old = Number(store.get("heist.chips"));
      if (Number.isFinite(old) && old > 0) p.chips = old;
      s = { id: "local", name: store.get("heist.name") || "Ace", joined: Date.now(), progress: p, solo: null };
    }
    s.progress = upgrade(s.progress);
    s.progress.vip = isHeistPro();
    this.save = s;
    this.write();

    onProChange(() => {
      this.save.progress.vip = isHeistPro();
      this.write();
    });
  }

  private write() {
    this.save.progress.vip = isHeistPro();
    store.set(LOCAL_KEY, JSON.stringify(this.save));
  }

  async feedback() {
    return { me: this.view() };
  }

  private view(): Me {
    const s = this.save;
    s.progress.vip = isHeistPro();
    return { id: s.id, name: s.name, guest: true, email: null, logins: [], progress: s.progress, profile: publicProfile(s.id, s.name, s.joined, s.progress) };
  }

  private apply(r: Progress | Fail): Me {
    if (failed(r)) throw new BackendError(r.error);
    r.vip = isHeistPro();
    this.save.progress = r;
    this.write();
    return this.view();
  }

  async me() {
    return this.view();
  }

  private quit(): Reward | null {
    const g = this.save.solo;
    if (!g) return null;
    this.save.solo = null;
    if (g.coached) return null;
    const r = settle(this.save.progress, {
      mode: "bots", players: g.players, stakes: g.stakes, won: false, payout: 0, quit: true, at: Date.now(), rivals: soloRivals(g.players, g), campaign: g.stage,
      summary: { role: null, footholds: 0, jobsLed: 0, jobsWon: 0, defenses: 0, doubleCrosses: 0, loot: 0, bustsWon: 0, betsWon: 0 },
    });
    this.save.progress = r.progress;
    return r.reward;
  }

  async soloStart(players: number, stakes: number, name: string, campaign?: number, coached = false): Promise<SoloTicket> {
    const st = campaign ? stage(campaign) : undefined;
    if (campaign && (!st || st.n > this.save.progress.campaign + 1)) throw new BackendError("Clear the stage before that one first");
    if (st) [players, stakes] = [st.players, 0];
    const quit = this.quit();
    if (coached) [players, stakes] = [3, 0];
    if (name) this.save.name = name;
    const p = buyIn(this.save.progress, stakes);
    if (failed(p)) throw new BackendError(p.error);
    this.save.progress = p;
    const rand = () => Math.floor(Math.random() * 2 ** 31);
    const lesson = coached ? lessonFor(this.save.progress.coachGames) : undefined;
    const seed = coached ? easySeed(rand, players, 16, 250, undefined, lesson) : rand();
    const levels = st || coached ? undefined : botLevelsFor(this.save.progress.rating, players - 1);
    this.save.solo = { gameId: `l_${seed}`, seed, players, stakes, levels, stage: st?.n, ...(coached ? { coached: true, gentle: true } : {}), ...(lesson ? { lesson } : {}) };
    this.write();
    return { gameId: this.save.solo.gameId, seed, levels, stage: st?.n, players, gentle: coached || undefined, lesson, me: this.view(), quit };
  }

  private sol: { gameId: string; seed: number; isDaily?: boolean; paid?: SolTally; paidXp?: number; drain?: number; startedAt?: number } | null = null;
  async solitaireStart(seed?: number, isDaily = false) {
    const s = typeof seed === "number" && Number.isInteger(seed) && seed >= 0 && seed <= 2 ** 31 - 1 ? seed : Math.floor(Math.random() * 2 ** 31);
    this.sol = { gameId: `l_${s}`, seed: s, isDaily, startedAt: Date.now() };
    return { gameId: this.sol.gameId, seed: s };
  }
  async solitaireFinish(gameId: string, moves: string[], drain: number) {
    const r = await this.solitaireBank(gameId, moves, drain, true);
    return { me: r.me, reward: r.reward! };
  }
  async solitaireBank(gameId: string, moves: string[], drain: number, finish = false) {
    const g = this.sol;
    if (!g || g.gameId !== gameId) throw new BackendError("That game isn't running any more");
    const t = tallySol(g.seed, moves);
    if (finish && !t.won) throw new BackendError("That game isn't won yet");
    g.drain = Math.max(g.drain ?? 0, drain);
    const pay = solPay(g.paid, g.paidXp, t, g.drain);
    g.paid = pay.paid;
    g.paidXp = pay.paidXp;
    const secondsTaken = g.startedAt ? Math.max(1, Math.round((Date.now() - g.startedAt) / 1000)) : undefined;
    if (t.won) this.sol = null;
    if (!pay.xp && !pay.gained.won) return { me: this.view(), reward: null };
    const r = settleSolitaire(this.save.progress, Date.now(), pay.gained, pay.xp, g.isDaily, secondsTaken);
    this.save.progress = r.progress;
    this.write();
    return { me: this.view(), reward: r.reward };
  }

  private fc: { gameId: string; seed: number; isDaily?: boolean; paid?: FcTally; paidXp?: number; drain?: number; startedAt?: number } | null = null;
  async freecellStart(seed?: number, isDaily = false) {
    const s = typeof seed === "number" && Number.isInteger(seed) && seed >= 0 && seed <= 2 ** 31 - 1 ? seed : Math.floor(Math.random() * 2 ** 31);
    this.fc = { gameId: `l_${s}`, seed: s, isDaily, startedAt: Date.now() };
    return { gameId: this.fc.gameId, seed: s };
  }
  async freecellFinish(gameId: string, moves: string[], drain: number) {
    const r = await this.freecellBank(gameId, moves, drain, true);
    return { me: r.me, reward: r.reward! };
  }
  async freecellBank(gameId: string, moves: string[], drain: number, finish = false) {
    const g = this.fc;
    if (!g || g.gameId !== gameId) throw new BackendError("That game isn't running any more");
    const t = tallyFreeCell(g.seed, moves);
    if (finish && !t.won) throw new BackendError("That game isn't won yet");
    g.drain = Math.max(g.drain ?? 0, drain);
    const pay = fcPay(g.paid, g.paidXp, t, g.drain);
    g.paid = pay.paid;
    g.paidXp = pay.paidXp;
    const secondsTaken = g.startedAt ? Math.max(1, Math.round((Date.now() - g.startedAt) / 1000)) : undefined;
    if (t.won) this.fc = null;
    if (!pay.xp && !pay.gained.won) return { me: this.view(), reward: null };
    const r = settleFreeCell(this.save.progress, Date.now(), pay.gained, pay.xp, g.isDaily, secondsTaken);
    this.save.progress = r.progress;
    this.write();
    return { me: this.view(), reward: r.reward };
  }

  private tp: { gameId: string; seed: number; isDaily?: boolean; paid?: TpTally; paidXp?: number; drain?: number; startedAt?: number } | null = null;
  async tripeaksStart(seed?: number, isDaily = false) {
    const s = typeof seed === "number" && Number.isInteger(seed) && seed >= 0 && seed <= 2 ** 31 - 1 ? seed : Math.floor(Math.random() * 2 ** 31);
    this.tp = { gameId: `l_${s}`, seed: s, isDaily, startedAt: Date.now() };
    return { gameId: this.tp.gameId, seed: s };
  }
  async tripeaksFinish(gameId: string, moves: string[], drain: number) {
    const r = await this.tripeaksBank(gameId, moves, drain, true);
    return { me: r.me, reward: r.reward! };
  }
  async tripeaksBank(gameId: string, moves: string[], drain: number, finish = false) {
    const g = this.tp;
    if (!g || g.gameId !== gameId) throw new BackendError("That game isn't running any more");
    const t = tallyTriPeaks(g.seed, moves);
    if (finish && !t.won) throw new BackendError("That game isn't won yet");
    g.drain = Math.max(g.drain ?? 0, drain);
    const pay = tpPay(g.paid, g.paidXp, t, g.drain);
    g.paid = pay.paid;
    g.paidXp = pay.paidXp;
    const secondsTaken = g.startedAt ? Math.max(1, Math.round((Date.now() - g.startedAt) / 1000)) : undefined;
    if (t.won) this.tp = null;
    if (!pay.xp && !pay.gained.won) return { me: this.view(), reward: null };
    const r = settleTriPeaks(this.save.progress, Date.now(), pay.gained, pay.xp, g.isDaily, secondsTaken);
    this.save.progress = r.progress;
    this.write();
    return { me: this.view(), reward: r.reward };
  }

  private ersState: { gameId: string; seed: number; isDaily?: boolean; paid?: ErsTally; paidXp?: number; drain?: number; startedAt?: number } | null = null;
  async ersStart(seed?: number, isDaily = false) {
    const s = typeof seed === "number" && Number.isInteger(seed) && seed >= 0 && seed <= 2 ** 31 - 1 ? seed : Math.floor(Math.random() * 2 ** 31);
    this.ersState = { gameId: `l_${s}`, seed: s, isDaily, startedAt: Date.now() };
    return { gameId: this.ersState.gameId, seed: s };
  }
  async ersFinish(gameId: string, moves: string[], drain: number) {
    const r = await this.ersBank(gameId, moves, drain, true);
    return { me: r.me, reward: r.reward! };
  }
  async ersBank(gameId: string, moves: string[], drain: number, finish = false) {
    const g = this.ersState;
    if (!g || g.gameId !== gameId) throw new BackendError("That game isn't running any more");
    const t = tallyErs(g.seed, moves);
    if (finish && !t.won) throw new BackendError("That game isn't won yet");
    g.drain = Math.max(g.drain ?? 0, drain);
    const pay = ersPay(g.paid, g.paidXp, t, g.drain);
    g.paid = pay.paid;
    g.paidXp = pay.paidXp;
    const secondsTaken = g.startedAt ? Math.max(1, Math.round((Date.now() - g.startedAt) / 1000)) : undefined;
    if (t.won) this.ersState = null;
    if (!pay.xp && !pay.gained.won) return { me: this.view(), reward: null };
    const r = settleErs(this.save.progress, Date.now(), pay.gained, pay.xp, g.isDaily, secondsTaken);
    this.save.progress = r.progress;
    this.write();
    return { me: this.view(), reward: r.reward };
  }

  private spiderState: { gameId: string; seed: number; isDaily?: boolean; paid?: SpiderTally; paidXp?: number; drain?: number; startedAt?: number } | null = null;
  async spiderStart(seed?: number, isDaily = false) {
    const s = typeof seed === "number" && Number.isInteger(seed) && seed >= 0 && seed <= 2 ** 31 - 1 ? seed : Math.floor(Math.random() * 2 ** 31);
    this.spiderState = { gameId: `l_${s}`, seed: s, isDaily, startedAt: Date.now() };
    return { gameId: this.spiderState.gameId, seed: s };
  }
  async spiderFinish(gameId: string, moves: unknown[], drain: number) {
    const r = await this.spiderBank(gameId, moves, drain, true);
    return { me: r.me, reward: r.reward! };
  }
  async spiderBank(gameId: string, moves: unknown[], drain: number, finish = false) {
    const g = this.spiderState;
    if (!g || g.gameId !== gameId) throw new BackendError("That game isn't running any more");
    const t = tallySpider(g.seed, moves);
    if (finish && !t.won) throw new BackendError("That game isn't won yet");
    g.drain = Math.max(g.drain ?? 0, drain);
    const pay = spiderPay(g.paid, g.paidXp, t, g.drain);
    g.paid = pay.paid;
    g.paidXp = pay.paidXp;
    const secondsTaken = g.startedAt ? Math.max(1, Math.round((Date.now() - g.startedAt) / 1000)) : undefined;
    if (t.won) this.spiderState = null;
    if (!pay.xp && !pay.gained.won) return { me: this.view(), reward: null };
    const r = settleSpider(this.save.progress, Date.now(), pay.gained, pay.xp, g.isDaily, secondsTaken);
    this.save.progress = r.progress;
    this.write();
    return { me: this.view(), reward: r.reward };
  }

  private pyramidState: { gameId: string; seed: number; isDaily?: boolean; paid?: PyramidTally; paidXp?: number; drain?: number; startedAt?: number } | null = null;
  async pyramidStart(seed?: number, isDaily = false) {
    const s = typeof seed === "number" && Number.isInteger(seed) && seed >= 0 && seed <= 2 ** 31 - 1 ? seed : Math.floor(Math.random() * 2 ** 31);
    this.pyramidState = { gameId: `l_${s}`, seed: s, isDaily, startedAt: Date.now() };
    return { gameId: this.pyramidState.gameId, seed: s };
  }
  async pyramidFinish(gameId: string, moves: unknown[], drain: number) {
    const r = await this.pyramidBank(gameId, moves, drain, true);
    return { me: r.me, reward: r.reward! };
  }
  async pyramidBank(gameId: string, moves: unknown[], drain: number, finish = false) {
    const g = this.pyramidState;
    if (!g || g.gameId !== gameId) throw new BackendError("That game isn't running any more");
    const t = tallyPyramid(g.seed, moves as any);
    if (finish && !t.won) throw new BackendError("That game isn't won yet");
    g.drain = Math.max(g.drain ?? 0, drain);
    const pay = pyramidPay(g.paid, g.paidXp, t, g.drain);
    g.paid = pay.paid;
    g.paidXp = pay.paidXp;
    const secondsTaken = g.startedAt ? Math.max(1, Math.round((Date.now() - g.startedAt) / 1000)) : undefined;
    if (t.won) this.pyramidState = null;
    if (!pay.xp && !pay.gained.won) return { me: this.view(), reward: null };
    const r = settlePyramid(this.save.progress, Date.now(), pay.gained, pay.xp, g.isDaily, secondsTaken);
    this.save.progress = r.progress;
    this.write();
    return { me: this.view(), reward: r.reward };
  }

  private yukonState: { gameId: string; seed: number; isDaily?: boolean; paid?: YukonTally; paidXp?: number; drain?: number; startedAt?: number } | null = null;
  async yukonStart(seed?: number, isDaily = false) {
    const s = typeof seed === "number" && Number.isInteger(seed) && seed >= 0 && seed <= 2 ** 31 - 1 ? seed : Math.floor(Math.random() * 2 ** 31);
    this.yukonState = { gameId: `l_${s}`, seed: s, isDaily, startedAt: Date.now() };
    return { gameId: this.yukonState.gameId, seed: s };
  }
  async yukonFinish(gameId: string, moves: string[], drain: number) {
    const r = await this.yukonBank(gameId, moves, drain, true);
    return { me: r.me, reward: r.reward! };
  }
  async yukonBank(gameId: string, moves: string[], drain: number, finish = false) {
    const g = this.yukonState;
    if (!g || g.gameId !== gameId) throw new BackendError("That game isn't running any more");
    const t = tallyYukon(g.seed, moves);
    if (finish && !t.won) throw new BackendError("That game isn't won yet");
    g.drain = Math.max(g.drain ?? 0, drain);
    const pay = yukonPay(g.paid, g.paidXp, t, g.drain);
    g.paid = pay.paid;
    g.paidXp = pay.paidXp;
    const secondsTaken = g.startedAt ? Math.max(1, Math.round((Date.now() - g.startedAt) / 1000)) : undefined;
    if (t.won) this.yukonState = null;
    if (!pay.xp && !pay.gained.won) return { me: this.view(), reward: null };
    const r = settleYukon(this.save.progress, Date.now(), pay.gained, pay.xp, g.isDaily, secondsTaken);
    this.save.progress = r.progress;
    this.write();
    return { me: this.view(), reward: r.reward };
  }

  private scoundrelState: { gameId: string; seed: number; isDaily?: boolean; paid?: ScoundrelTally; paidXp?: number; drain?: number; startedAt?: number } | null = null;
  async scoundrelStart(seed?: number, isDaily = false) {
    const s = typeof seed === "number" && Number.isInteger(seed) && seed >= 0 && seed <= 2 ** 31 - 1 ? seed : Math.floor(Math.random() * 2 ** 31);
    this.scoundrelState = { gameId: `l_${s}`, seed: s, isDaily, startedAt: Date.now() };
    return { gameId: this.scoundrelState.gameId, seed: s };
  }
  async scoundrelFinish(gameId: string, moves: unknown[], drain: number) {
    const r = await this.scoundrelBank(gameId, moves, drain, true);
    return { me: r.me, reward: r.reward! };
  }
  async scoundrelBank(gameId: string, moves: unknown[], drain: number, finish = false) {
    const g = this.scoundrelState;
    if (!g || g.gameId !== gameId) throw new BackendError("That game isn't running any more");
    const t = tallyScoundrel(g.seed, moves as any);
    if (finish && !t.won) throw new BackendError("That game isn't won yet");
    g.drain = Math.max(g.drain ?? 0, drain);
    const pay = scoundrelPay(g.paid, g.paidXp, t, g.drain);
    g.paid = pay.paid;
    g.paidXp = pay.paidXp;
    const secondsTaken = g.startedAt ? Math.max(1, Math.round((Date.now() - g.startedAt) / 1000)) : undefined;
    if (t.won) this.scoundrelState = null;
    if (!pay.xp && !pay.gained.won) return { me: this.view(), reward: null };
    const r = settleScoundrel(this.save.progress, Date.now(), pay.gained, pay.xp, g.isDaily, secondsTaken);
    this.save.progress = r.progress;
    this.write();
    return { me: this.view(), reward: r.reward };
  }

  private minesweeperState: { gameId: string; seed: number; level: MinesLevel; isDaily?: boolean; paid?: MinesTally; paidXp?: number; drain?: number; startedAt?: number } | null = null;
  async minesweeperStart(seed?: number, isDaily = false, level?: MinesLevel) {
    const s = typeof seed === "number" && Number.isInteger(seed) && seed >= 0 && seed <= 2 ** 31 - 1 ? seed : Math.floor(Math.random() * 2 ** 31);
    const daily = isDaily && s === getDailySeed("minesweeper", todayUtc());
    const lv: MinesLevel = daily ? MINES_DAILY_LEVEL : isMinesLevel(level) ? level : "beginner";
    this.minesweeperState = { gameId: `l_${s}`, seed: s, level: lv, isDaily: daily, startedAt: Date.now() };
    return { gameId: this.minesweeperState.gameId, seed: s, level: lv };
  }
  async minesweeperFinish(gameId: string, moves: unknown[], drain: number) {
    const r = await this.minesweeperBank(gameId, moves, drain, true);
    return { me: r.me, reward: r.reward! };
  }
  async minesweeperBank(gameId: string, moves: unknown[], drain: number, finish = false) {
    const g = this.minesweeperState;
    if (!g || g.gameId !== gameId) throw new BackendError("That game isn't running any more");
    const t = tallyMines(g.seed, g.level, moves);
    if (finish && !t.won) throw new BackendError("That game isn't won yet");
    g.drain = Math.max(g.drain ?? 0, drain);
    const pay = minesPay(g.paid, g.paidXp, t, g.drain);
    g.paid = pay.paid;
    g.paidXp = pay.paidXp;
    const secondsTaken = g.startedAt ? Math.max(1, Math.round((Date.now() - g.startedAt) / 1000)) : undefined;
    if (t.won) this.minesweeperState = null;
    if (!pay.xp && !pay.gained.won) return { me: this.view(), reward: null };
    const r = settleMinesweeper(this.save.progress, Date.now(), pay.gained, pay.xp, g.isDaily, secondsTaken);
    this.save.progress = r.progress;
    this.write();
    return { me: this.view(), reward: r.reward };
  }

  private sudokuState: { gameId: string; seed: number; level: SudokuLevel; isDaily?: boolean; paid?: SudokuTally; paidXp?: number; drain?: number; startedAt?: number } | null = null;
  async sudokuStart(seed?: number, isDaily = false, level?: SudokuLevel) {
    const s = typeof seed === "number" && Number.isInteger(seed) && seed >= 0 && seed <= 2 ** 31 - 1 ? seed : Math.floor(Math.random() * 2 ** 31);
    const daily = isDaily && s === getDailySeed("sudoku", todayUtc());
    const lv: SudokuLevel = daily ? SUDOKU_DAILY_LEVEL : isSudokuLevel(level) ? level : "easy";
    this.sudokuState = { gameId: `l_${s}`, seed: s, level: lv, isDaily: daily, startedAt: Date.now() };
    return { gameId: this.sudokuState.gameId, seed: s, level: lv };
  }
  async sudokuFinish(gameId: string, moves: unknown[], drain: number) {
    const r = await this.sudokuBank(gameId, moves, drain, true);
    return { me: r.me, reward: r.reward! };
  }
  async sudokuBank(gameId: string, moves: unknown[], drain: number, finish = false) {
    const g = this.sudokuState;
    if (!g || g.gameId !== gameId) throw new BackendError("That game isn't running any more");
    const t = tallySudoku(g.seed, g.level, moves);
    if (finish && !t.won) throw new BackendError("That game isn't won yet");
    g.drain = Math.max(g.drain ?? 0, drain);
    const pay = sudokuPay(g.paid, g.paidXp, t, g.drain);
    g.paid = pay.paid;
    g.paidXp = pay.paidXp;
    const secondsTaken = g.startedAt ? Math.max(1, Math.round((Date.now() - g.startedAt) / 1000)) : undefined;
    if (t.won) this.sudokuState = null;
    if (!pay.xp && !pay.gained.won) return { me: this.view(), reward: null };
    const r = settleSudoku(this.save.progress, Date.now(), pay.gained, pay.xp, g.isDaily, secondsTaken);
    this.save.progress = r.progress;
    this.write();
    return { me: this.view(), reward: r.reward };
  }

  private checkersState: { gameId: string; seed: number; level: CheckersLevel; isDaily?: boolean; paid?: CheckersTally; paidXp?: number; drain?: number; plies?: number[][] } | null = null;
  async checkersStart(seed?: number, isDaily = false, level?: CheckersLevel) {
    const s = typeof seed === "number" && Number.isInteger(seed) && seed >= 0 && seed <= 2 ** 31 - 1 ? seed : Math.floor(Math.random() * 2 ** 31);
    const lv: CheckersLevel = isDaily ? "pro" : isCheckersLevel(level) ? level : "rookie";
    this.checkersState = { gameId: `l_${s}`, seed: s, level: lv, isDaily };
    return { gameId: this.checkersState.gameId, seed: s, level: lv };
  }
  async checkersFinish(gameId: string, moves: number[][], drain: number) {
    return this.checkersBank(gameId, moves, drain, true);
  }
  async checkersBank(gameId: string, moves: number[][], drain: number, finish = false) {
    const g = this.checkersState;
    if (!g || g.gameId !== gameId) throw new BackendError("That game isn't running any more");
    const rep = replayCheckers(g.seed, g.level, moves, g.plies);
    const over = rep.state.winner !== null;
    if (finish && !over) throw new BackendError("That game isn't over yet");
    g.plies = rep.plies;
    g.drain = Math.max(g.drain ?? 0, drain);
    const pay = checkersPay(g.paid, g.paidXp, checkersTallyOf(rep.state, g.level), g.drain);
    g.paid = pay.paid;
    g.paidXp = pay.paidXp;
    if (over) this.checkersState = null;
    if (!pay.xp && !pay.gained.won) return { me: this.view(), reward: null };
    const r = settleCheckers(this.save.progress, Date.now(), pay.gained, pay.xp, g.isDaily);
    this.save.progress = r.progress;
    this.write();
    return { me: this.view(), reward: r.reward };
  }

  private heartsState: { gameId: string; seed: number; level: HeartsLevel; isDaily?: boolean; paid?: HeartsTally; paidXp?: number; drain?: number } | null = null;
  async heartsStart(seed?: number, isDaily = false, level?: HeartsLevel) {
    const s = typeof seed === "number" && Number.isInteger(seed) && seed >= 0 && seed <= 2 ** 31 - 1 ? seed : Math.floor(Math.random() * 2 ** 31);
    const lv: HeartsLevel = isDaily ? "pro" : isHeartsLevel(level) ? level : "rookie";
    this.heartsState = { gameId: `ht_${s}`, seed: s, level: lv, isDaily };
    return { gameId: this.heartsState.gameId, seed: s, level: lv };
  }
  async heartsFinish(gameId: string, moves: number[][], drain: number) {
    return this.heartsBank(gameId, moves, drain, true);
  }
  async heartsBank(gameId: string, moves: number[][], drain: number, finish = false) {
    const g = this.heartsState;
    if (!g || g.gameId !== gameId) throw new BackendError("That game isn't running any more");
    const rep = replayHearts(g.seed, g.level, moves);
    const over = rep.state.phase === "done";
    if (finish && !over) throw new BackendError("That game isn't over yet");
    g.drain = Math.max(g.drain ?? 0, drain);
    const pay = heartsPay(g.paid, g.paidXp, heartsTallyOf(rep.state, g.level), g.drain);
    g.paid = pay.paid;
    g.paidXp = pay.paidXp;
    if (over) this.heartsState = null;
    if (!pay.xp && !pay.gained.won) return { me: this.view(), reward: null };
    const r = settleHearts(this.save.progress, Date.now(), pay.gained, pay.xp, g.isDaily);
    this.save.progress = r.progress;
    this.write();
    return { me: this.view(), reward: r.reward };
  }

  private spadesState: { gameId: string; seed: number; level: SpadesLevel; isDaily?: boolean; paid?: SpadesTally; paidXp?: number; drain?: number } | null = null;
  async spadesStart(seed?: number, isDaily = false, level?: SpadesLevel) {
    const s = typeof seed === "number" && Number.isInteger(seed) && seed >= 0 && seed <= 2 ** 31 - 1 ? seed : Math.floor(Math.random() * 2 ** 31);
    const lv: SpadesLevel = isDaily ? "pro" : isSpadesLevel(level) ? level : "rookie";
    this.spadesState = { gameId: `spd_${s}`, seed: s, level: lv, isDaily };
    return { gameId: this.spadesState.gameId, seed: s, level: lv };
  }
  async spadesFinish(gameId: string, moves: number[][], drain: number) {
    return this.spadesBank(gameId, moves, drain, true);
  }
  async spadesBank(gameId: string, moves: number[][], drain: number, finish = false) {
    const g = this.spadesState;
    if (!g || g.gameId !== gameId) throw new BackendError("That game isn't running any more");
    const rep = replaySpades(g.seed, g.level, moves);
    const over = rep.state.phase === "done";
    if (finish && !over) throw new BackendError("That game isn't over yet");
    g.drain = Math.max(g.drain ?? 0, drain);
    const pay = spadesPay(g.paid, g.paidXp, spadesTallyOf(rep.state, g.level), g.drain);
    g.paid = pay.paid;
    g.paidXp = pay.paidXp;
    if (over) this.spadesState = null;
    if (!pay.xp && !pay.gained.won) return { me: this.view(), reward: null };
    const r = settleSpades(this.save.progress, Date.now(), pay.gained, pay.xp, g.isDaily);
    this.save.progress = r.progress;
    this.write();
    return { me: this.view(), reward: r.reward };
  }

  async soloFinish(gameId: string, answers: unknown[]) {
    const g = this.save.solo;
    if (!g || g.gameId !== gameId) throw new BackendError("That game isn't running any more");
    const rep = replaySolo(g.seed, g.players, answers, undefined, g);
    this.save.solo = null;
    const won = rep.winners.includes(0);
    this.save.progress = addMistakes(this.save.progress, rep.mistakes);
    if (g.coached) {
      const c = settleCoached(this.save.progress, won, g.lesson === FIRST_HAND ? { at: Date.now() } : undefined);
      this.save.progress = c.progress;
      this.write();
      return { me: this.view(), reward: c.reward };
    }
    const r = settle(this.save.progress, {
      mode: "bots", players: g.players, stakes: g.stakes, won, payout: payout(g.stakes, g.players, rep.winners, 0), summary: summarize(rep.events, 0), at: Date.now(),
      rivals: soloRivals(g.players, g, rep.winners), campaign: g.stage,
    });
    this.save.progress = r.progress;
    this.write();
    return { me: this.view(), reward: r.reward };
  }

  async soloQuit() {
    this.quit();
    this.write();
    return this.view();
  }

  async buy(id: string) {
    return this.apply(buy(this.save.progress, id));
  }
  async equip(id: string) {
    return this.apply(equip(this.save.progress, id));
  }
  async openPack(paid: boolean): Promise<PackOpened> {
    const r = openPack(this.save.progress, Date.now(), (n) => Math.floor(Math.random() * n), paid);
    if (failed(r)) throw new BackendError(r.error);
    this.save.progress = r.progress;
    this.write();
    return { me: this.view(), items: r.items, dupeXp: r.dupeXp };
  }
  async prestige() {
    const r = prestige(this.save.progress);
    if (failed(r)) throw new BackendError(r.error);
    this.save.progress = r.progress;
    this.write();
    return { me: this.view(), coins: r.coins, unlocked: r.unlocked };
  }
  async refill() {
    return this.apply(refill(this.save.progress));
  }
  async daily() {
    const r = daily(this.save.progress, Date.now());
    if (failed(r)) throw new BackendError(r.error);
    this.save.progress = r.progress;
    this.write();
    return { me: this.view(), chips: r.chips };
  }
  async buyStreakFreeze(): Promise<Me> {
    const r = buyStreakFreeze(this.save.progress);
    if (!r.success) throw new BackendError(r.error || "Cannot buy streak freeze");
    this.save.progress = r.progress;
    this.write();
    return this.view();
  }
  async claimDailyVault(): Promise<{ me: Me; coins: number; xp: number }> {
    const r = claimDailyVault(this.save.progress);
    if (!r.success) throw new BackendError("Daily vault not ready or already claimed");
    this.save.progress = r.progress;
    this.write();
    return { me: this.view(), coins: r.coins, xp: r.xp };
  }
  async claimWelcomeGift(): Promise<{ me: Me; claimed: boolean; coins: number; freezes: number }> {
    const r = claimWelcomeGift(this.save.progress);
    this.save.progress = r.progress;
    this.write();
    return { me: this.view(), claimed: r.claimed, coins: r.coins, freezes: r.freezes };
  }
  async drink(id: string, count: number) {
    return this.apply(payForDrink(this.save.progress, id, count));
  }
  async rename(name: string) {
    const n = name.trim().slice(0, 20);
    if (!n) throw new BackendError("Pick a name");
    this.save.name = n;
    store.set("heist.name", n);
    this.write();
    return this.view();
  }
  async leaderboard(): Promise<LeaderRow[]> {
    return [];
  }
  async player(id: string): Promise<PublicProfile> {
    if (id !== this.save.id) throw new BackendError("Player cards need the game server");
    return this.view().profile;
  }
  async changePassword(): Promise<Me> {
    throw new BackendError("Passwords need the game server");
  }
  private offline(): never {
    throw new BackendError("Accounts turn on when the game server is live.");
  }
  async register(_email?: string, _password?: string, _name?: string, _consent?: boolean) {
    return this.offline();
  }
  async setPassword(_password?: string) {
    return this.offline();
  }
  async login() {
    return this.offline();
  }
  async oauth() {
    return this.offline();
  }
  async dev() {
    return this.offline();
  }
  async signOut() {
    return this.view();
  }
  async deleteAccount() {
    store.set(LOCAL_KEY, null);
    this.save = new BrowserBackend().save;
    return this.view();
  }
  token() {
    return null;
  }
}
