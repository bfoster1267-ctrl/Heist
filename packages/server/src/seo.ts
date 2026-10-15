// What search engines see. The app is one page drawn by the browser, so a crawler reading the raw HTML
// would find only "Heist" and an empty box. Each public page gets its own title, description and a short
// block of plain text inside #root (React replaces it as soon as the app starts).

import { BLOG_PATHS } from "./blog";

const SITE = "https://playheist.net";

interface Page {
  title: string;
  description: string;
  text: string;
}

const PAGES: Record<string, Page> = {
  "/": {
    title: "Heist: The Online Card Game of Crews, Jobs and Double-Crosses",
    description:
      "Heist is a free online card game for 3 to 6 players. Pull jobs with your crew, split the score, and double-cross at the right moment. Play friends or bots in your browser.",
    text: `<h1>Heist, the online card game of double-crosses</h1>
<p>Heist is a free card game for 3 to 6 players that you play in your browser on a phone or computer. Join crews, pull jobs, and decide when to betray the table. Play friends, quick-match strangers, or practice against bots.</p>
<p><a href="/solitaire">Play free solitaire</a> · <a href="/blog">Blog</a></p>`,
  },
  "/solitaire": {
    title: "Solitaire: Play Free Klondike Solitaire Online, No Download",
    description:
      "Play classic Klondike solitaire free in your browser. Draw one, unlimited undo, hints, and auto-finish. No download, no sign-up, works on phone and computer.",
    text: `<h1>Free Klondike Solitaire</h1>
<p>Play classic Klondike solitaire online for free. No download and no sign-up: the game opens straight away on your phone, tablet or computer.</p>
<h2>How to play solitaire</h2>
<p>Build four foundation piles, one per suit, from Ace up to King. On the seven tableau columns, stack cards downward in alternating colors (red on black, black on red). Only a King can fill an empty column. Turn cards from the stock one at a time when you run out of moves. You win when all 52 cards reach the foundations.</p>
<h2>Features</h2>
<ul><li>Draw one Klondike</li><li>Tap a card to move it, or drag it</li><li>Unlimited undo and hints</li><li>Auto-finish once the game is solved</li></ul>
<p>Liked it? Try <a href="/">Heist</a>, our multiplayer card game of crews and double-crosses.</p>`,
  },
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** The app page with this path's title, description and crawlable text, or unchanged for other paths. */
export function pageHtml(html: string, path: string): string {
  const page = PAGES[path];
  if (!page) return html;
  const url = SITE + path;
  const head = `<title>${esc(page.title)}</title>
    <meta name="description" content="${esc(page.description)}" />
    <link rel="canonical" href="${url}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Heist" />
    <meta property="og:title" content="${esc(page.title)}" />
    <meta property="og:description" content="${esc(page.description)}" />
    <meta property="og:url" content="${url}" />
    <meta property="og:image" content="${SITE}/icons/apple-touch-icon.png" />
    <script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "VideoGame",
      name: path === "/solitaire" ? "Klondike Solitaire" : "Heist",
      url,
      description: page.description,
      genre: "Card game",
      gamePlatform: "Web browser",
      applicationCategory: "Game",
      operatingSystem: "Any",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    }).replace(/</g, "\\u003c")}</script>`;
  return html
    .replace(/<title>[^<]*<\/title>/, head)
    .replace('<div id="root"></div>', `<div id="root">${page.text}</div>`);
}

export const ROBOTS = `User-agent: *
Disallow: /admin
Disallow: /api/
Sitemap: ${SITE}/sitemap.xml
`;

export const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[...Object.keys(PAGES), ...BLOG_PATHS]
  .map((p) => `  <url><loc>${SITE}${p}</loc></url>`)
  .join("\n")}
</urlset>
`;
