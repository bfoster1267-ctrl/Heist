// Visits that were obviously not a person: link-preview fetchers, search engines and other crawlers that
// load the page (and, since a first visit drops straight into the first lesson, "sit down" at it). The
// admin panel leaves them out of every player count and lists them on their own page with where they
// came from. Signed-up accounts are never called bots.

import type { ActivityEvent } from "./activity";

/** user agents that announce a robot */
export const CRAWLER_UA =
  /(?<!cu)bot\b|(?<!cu)bot\/|crawl|spider|slurp|preview|facebookexternalhit|embedly|headless|phantomjs|puppeteer|playwright|selenium|lighthouse|pagespeed|python-requests|python-urllib|aiohttp|curl\/|wget|go-http-client|okhttp|java\/|axios|node-fetch|undici|scrapy|httpclient|feedfetcher|mediapartners|bingpreview|ahrefs|semrush|mj12|dotbot|petalbot|yandex|baiduspider|duckduckbot|applebot|discordbot|twitterbot|slackbot|telegrambot|whatsapp|skypeuripreview|redditbot|iframely|vkshare|quora link preview|linkedinbot|google-inspectiontool|chrome-lighthouse|gtmetrix|statuscake|pingdom|censys|zgrab|masscan|nmap/i;

/** host names (reverse DNS) of the big crawlers' addresses */
export const CRAWLER_HOST = /\.(googlebot\.com|google\.com|googleusercontent\.com|search\.msn\.com|crawl\.yahoo\.net|crawl\.baidu\.com|yandex\.(ru|net|com)|applebot\.apple\.com|amazonaws\.com|compute\.internal|petalsearch\.com|ahrefs\.com|semrush\.com)$/i;

/** Which app or site sent a visitor, from the page's referrer and the browser's user agent. */
export function sourceOf(ref: string | undefined, ua: string | undefined): string | null {
  // the in-app browsers of the big apps name themselves (a robot's link back to its site doesn't count)
  const app = ua?.match(/\b(Reddit)\/|\b(Instagram) |\b(FBAN|FBAV)\/|\b(TikTok|musical_ly|Snapchat|LinkedInApp)\b/)?.slice(1).find(Boolean);
  if (app) return /^FBA/.test(app) ? "Facebook app" : app === "musical_ly" ? "TikTok app" : `${app} app`;
  if (!ref) return null;
  try {
    const host = new URL(ref).hostname.replace(/^www\.|^old\.|^new\.|^m\./, "");
    if (host === "playheist.net" || host.endsWith(".playheist.net")) return null;
    return host === "out.reddit.com" || host === "redd.it" ? "reddit.com" : host;
  } catch {
    return null;
  }
}

/** taps, moves and anything else only a person at the screen does */
const HUMAN = new Set([
  "ui.tap", "game.solo", "game.online", "solo.finish",
  "solitaire.start", "solitaire.finish", "solitaire.bank",
  "freecell.start", "freecell.finish", "freecell.bank",
  "tripeaks.start", "tripeaks.finish", "tripeaks.bank",
  "spider.start", "spider.finish", "spider.bank",
  "pyramid.start", "pyramid.finish", "pyramid.bank",
  "ers.start", "ers.finish", "ers.bank",
  "yukon.start", "yukon.finish", "yukon.bank",
  "scoundrel.start", "scoundrel.finish", "scoundrel.bank",
  "checkers.start", "checkers.finish", "checkers.bank",
  "table.chat", "lounge.say", "feedback", "board.post",
  "auth.login", "auth.register", "auth.google", "auth.apple", "me.name", "me.password",
]);
export const byHand = (e: ActivityEvent) =>
  HUMAN.has(e.kind) ||
  e.kind.startsWith("shop.") ||
  e.kind.startsWith("season.");

export interface BotVisit {
  /** why it's called a bot, in plain words */
  reason: string;
  kind: "crawler" | "untouched";
}

/** how long a new visit gets before "never tapped anything" can be decided (taps reach the server in batches) */
export const SETTLE_MS = 10 * 60_000;

/**
 * Decide which people were bots. `events` are one person's (all their accounts), oldest first; `signedUp`
 * means one of their accounts has a sign-in, which always makes them a person. `host` is the reverse-DNS
 * name of an address, when it's been looked up.
 */
export function judge(events: readonly ActivityEvent[], signedUp: boolean, now: number, host: (ip: string) => string | undefined): BotVisit | null {
  // anyone who did something with their own hands is a person, whatever their browser says
  if (signedUp || !events.length || events.some(byHand)) return null;
  const ua = events.find((e) => e.ua && CRAWLER_UA.test(e.ua))?.ua;
  if (ua) return { kind: "crawler", reason: `Robot browser: ${short(ua)}` };
  for (const e of events) {
    const h = e.ip ? host(e.ip) : undefined;
    if (h && CRAWLER_HOST.test(h)) return { kind: "crawler", reason: `Crawler address: ${h}` };
  }
  if (now - events[0].at < SETTLE_MS) return null;
  const turn = events.some((e) => e.kind === "ui.turn" || e.kind === "solo.start");
  return { kind: "untouched", reason: turn ? "Never tapped anything: the first lesson started on its own and it left" : "Never tapped anything" };
}

const short = (ua: string) => {
  const m = ua.match(CRAWLER_UA);
  // the robot's own name and a little around it
  if (!m || m.index === undefined) return ua.slice(0, 80);
  const start = Math.max(0, ua.lastIndexOf(" ", Math.max(0, m.index - 20)) + 1);
  return ua.slice(start, start + 80).trim();
};
