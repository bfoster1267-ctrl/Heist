// Heist next to industry numbers: the Drop-off tab's headline rates, each with the range it could really be
// at this many people, against published benchmarks where one exists. Ad numbers live in Meta and Google,
// so they're listed as targets to compare by hand.

import type { FunnelRate } from "./api";
import { num } from "./bits";

interface Bench {
  label: string;
  /** what the rate measures, in plain words */
  note: string;
  /** below this is the bottom quarter, above `good` the top quarter; median between (all as fractions) */
  low?: number;
  median?: number;
  good?: number;
  /** lower is better (people quitting) */
  lowerBetter?: boolean;
  source?: string;
}

const BENCH: Record<FunnelRate["key"], Bench> = {
  started: { label: "Started a game", note: "of new people" },
  turn1quit: {
    label: "Quit on turn 1",
    note: "of people who started Heist, before turn 2 or the end",
    lowerBetter: true,
  },
  finished: { label: "Finished their first game", note: "of new people" },
  again: { label: "Played a second game", note: "of new people" },
  back: {
    label: "Came back later",
    note: "12+ hours after their first visit; only people who first came a day or more ago",
    low: 0.11,
    median: 0.22,
    good: 0.28,
    source:
      "Day-1 return of mobile games, GameAnalytics 2025-26: bottom quarter ~10-11%, median ~22%, top quarter ~27-30%",
  },
  signup: { label: "Signed up", note: "of new people" },
};

const ADS: [string, string, string][] = [
  ["Meta click rate (CTR, traffic ads)", "1.7% average", "WordStream 2025"],
  ["Meta cost per click", "$0.70 average", "WordStream 2025"],
  [
    "Google search click rate, entertainment",
    "13.1% average",
    "LocaliQ / WordStream 2025",
  ],
  [
    "Google cost per click, entertainment",
    "$1.60 average",
    "LocaliQ / WordStream 2025",
  ],
  ["Meta link clicks that load the page", "70-90%", "ad agency rule of thumb"],
];

/** the range the true rate could be in at this many people (95% Wilson interval), as fractions */
export function wilson(n: number, of: number): [number, number] {
  if (!of) return [0, 0];
  const z = 1.96;
  const p = n / of;
  const d = 1 + (z * z) / of;
  const c = p + (z * z) / (2 * of);
  const m = z * Math.sqrt((p * (1 - p)) / of + (z * z) / (4 * of * of));
  return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)];
}

const pc = (x: number) => `${Math.round(x * 100)}%`;

/** Where Heist stands against the benchmark: only called when the whole likely range agrees. */
function verdict(
  b: Bench,
  lo: number,
  hi: number,
): { text: string; tone: "up" | "down" | "dim" } {
  if (b.median === undefined || b.low === undefined || b.good === undefined)
    return { text: "no published benchmark", tone: "dim" };
  if (hi < b.low) return { text: "bottom quarter", tone: "down" };
  if (hi < b.median) return { text: "below median", tone: "down" };
  if (lo > b.good) return { text: "top quarter", tone: "up" };
  if (lo > b.median) return { text: "above median", tone: "up" };
  return { text: "too few people to tell", tone: "dim" };
}

export function Benchmarks({ rates }: { rates: FunnelRate[] }) {
  return (
    <div className="card">
      <div className="card-head">
        <h3>Heist vs industry</h3>
        <span className="dim small">
          the likely range is where the real rate probably is with this few
          people (95%)
        </span>
      </div>
      <div className="scroll-x">
        <table className="grid-table bench">
          <thead>
            <tr>
              <th>What</th>
              <th>Heist</th>
              <th>Likely range</th>
              <th>Industry</th>
              <th>Verdict</th>
            </tr>
          </thead>
          <tbody>
            {rates.map((r) => {
              const b = BENCH[r.key];
              const [lo, hi] = wilson(r.n, r.of);
              const v = verdict(b, lo, hi);
              return (
                <tr key={r.key}>
                  <td>
                    <b>{b.label}</b>
                    <div className="dim small">{b.note}</div>
                  </td>
                  <td>
                    {r.of ? pc(r.n / r.of) : "–"}{" "}
                    <span className="dim small">
                      {num(r.n)} of {num(r.of)}
                    </span>
                  </td>
                  <td className="dim">{r.of ? `${pc(lo)}–${pc(hi)}` : "–"}</td>
                  <td>
                    {b.median !== undefined ? (
                      <span title={b.source}>{pc(b.median)} median</span>
                    ) : (
                      <span className="dim">–</span>
                    )}
                  </td>
                  <td className={v.tone}>{v.text}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rates.some((r) => BENCH[r.key].source) && (
        <p className="dim small">
          {rates
            .map((r) => BENCH[r.key].source)
            .filter(Boolean)
            .join(" · ")}
          . App-store players installed the game, so they stick more than people
          clicking a web ad.
        </p>
      )}
      <h4>Ad numbers to compare by hand</h4>
      <p className="dim small">
        These live in Meta Ads Manager and Google Ads, not here.
      </p>
      <div className="scroll-x">
        <table className="grid-table bench">
          <tbody>
            {ADS.map(([what, avg, src]) => (
              <tr key={what}>
                <td>{what}</td>
                <td>{avg}</td>
                <td className="dim small">{src}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
