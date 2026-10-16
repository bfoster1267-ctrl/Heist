// What search engines and AI assistants see. The app is one page drawn by the browser, so a crawler reading the raw HTML
// would find only "Heist" and an empty box. Each public page gets its own title, description and a rich
// block of plain text inside #root (React replaces it as soon as the app starts).

import { BLOG_PATHS } from "./blog";

const SITE = "https://playheist.net";

interface Page {
  title: string;
  description: string;
  keywords?: string;
  text: string;
}

const PAGES: Record<string, Page> = {
  "/": {
    title: "Heist — Free Multiplayer Card Game & Solitaire Arcade in Browser",
    description:
      "Play Heist, the free multiplayer card game and poker bluffing battle in browser. Also enjoy daily Klondike Solitaire, FreeCell, TriPeaks, and Pyramid.",
    keywords:
      "multiplayer card game browser, free multiplayer card game, bluffing card game online, party card game online, play card games with friends online, online card games to play with friends, browser card game with friends, daily solitaire challenge, free online card game, play heist",
    text: `<h1>Heist: Free Multiplayer Card Game &amp; Solitaire Arcade in Browser</h1>
<p>Play Heist, the ultimate free online multiplayer bluffing card game and solo solitaire arcade. Instant play in any desktop or mobile browser with zero downloads, no ads, and no sign-up required.</p>
<h2>Play Card Games With Friends Online</h2>
<p>Gather your crew for 3 to 6-player real-time matches. Pull jobs, split loot, and bluff your way to the top with poker hands and secret deals. Create private tables with friends or join quick matchmaking.</p>
<h2>Daily Solitaire &amp; Solo Card Arcade</h2>
<p>Enjoy daily seeded challenges with global streak multipliers and Wordle-style score cards across 9 complete solo games:</p>
<ul>
  <li><a href="/solitaire">Klondike Solitaire (Draw 1 &amp; Draw 3)</a></li>
  <li><a href="/tripeaks">TriPeaks Solitaire Challenge</a></li>
  <li><a href="/freecell">FreeCell Solitaire</a></li>
  <li><a href="/pyramid">Pyramid Solitaire</a></li>
  <li><a href="/yukon">Yukon Solitaire</a></li>
  <li><a href="/spider">Spider Solitaire</a></li>
  <li><a href="/ers">Egyptian Rat Screw (ERS)</a></li>
  <li><a href="/scoundrel">Scoundrel Dungeon Roguelike</a></li>
  <li><a href="/checkers">Checkers vs Bot</a></li>
  <li><a href="/card-games">All Free Card Games Hub</a></li>
  <li><a href="/blog/best-free-online-card-games">10 Best Free Online Card Games Guide</a></li>
</ul>`,
  },
  "/card-games": {
    title: "Best Free Online Card Games: Play 10 Browser Games Free",
    description:
      "Play the best free online card games in your browser. Klondike Solitaire, FreeCell, Spider, TriPeaks, Pyramid, Yukon, ERS, Scoundrel, Checkers, and Heist. 100% free, no ads.",
    keywords:
      "best free online card games, free online card games, browser card games, play card games online no download, solitaire online, freecell online, multiplayer card game",
    text: `<h1>Best Free Online Card Games: Play in Browser (No Ads, No Download)</h1>
<p>Play 10 of the best free online card and board games right in your web browser. Zero downloads, zero video ads, and no sign-up required. Choose from single-player solitaire classics, high-speed card slaps, dungeon roguelikes, or multiplayer bluffing games with friends.</p>
<h2>All 10 Free Online Games</h2>
<ul>
  <li><a href="/solitaire"><strong>Klondike Solitaire</strong></a> — Classic 7-column Solitaire with Draw 1 &amp; Draw 3, unlimited undo, smart hints, and daily streak challenges.</li>
  <li><a href="/freecell"><strong>FreeCell Solitaire</strong></a> — 100% open information strategy with 4 reserve cells. Virtually every deal is solvable.</li>
  <li><a href="/spider"><strong>Spider Solitaire</strong></a> — 10-column tableau requiring full descending suit runs from King to Ace.</li>
  <li><a href="/tripeaks"><strong>TriPeaks Solitaire</strong></a> — Fast-paced arcade card matching across 3 peaks with combo multipliers.</li>
  <li><a href="/pyramid"><strong>Pyramid Solitaire</strong></a> — Dismantle the ancient pyramid by pairing cards that sum to 13.</li>
  <li><a href="/yukon"><strong>Yukon Solitaire</strong></a> — Tactical freedom: move any group of face-up cards regardless of sequence.</li>
  <li><a href="/ers"><strong>Egyptian Rat Screw (ERS)</strong></a> — High-reflex slap card game. Face-card penalty face-offs, doubles, and live 1v1 PvP duels.</li>
  <li><a href="/scoundrel"><strong>Scoundrel Dungeon Roguelike</strong></a> — Zach Gage &amp; Kurt Bieg's 52-card tabletop dungeon crawler with weapons, monsters, and health potions.</li>
  <li><a href="/checkers"><strong>Checkers vs Bot</strong></a> — Classic American checkers with forced jumps, multi-jumps and kings against a Rookie, Pro or Boss bot.</li>
  <li><a href="/"><strong>Heist Multiplayer</strong></a> — 3 to 6-player social deduction and poker bluffing battle. Pull jobs with your crew or double-cross for the pot.</li>
</ul>
<p>Read our full ranking and strategy guide: <a href="/blog/best-free-online-card-games">The 10 Best Free Online Card Games in 2026</a>.</p>`,
  },
  "/arcade": {
    title: "Card Game Arcade: Play 10 Free Games Online in Browser",
    description:
      "Explore the Heist Card Game Arcade. Play Solitaire, FreeCell, Spider, TriPeaks, Pyramid, Yukon, ERS, Scoundrel, Checkers, and Heist free with daily streak challenges.",
    keywords:
      "card game arcade, free online card games, browser card games, daily solitaire arcade",
    text: `<h1>Heist Card Game Arcade</h1>
<p>Explore 10 complete games in your browser. Single-player brainteasers, reflex slap battles, and multiplayer poker bluffing. Free, no download, no ads.</p>
<ul>
  <li><a href="/solitaire">Klondike Solitaire</a></li>
  <li><a href="/freecell">FreeCell</a></li>
  <li><a href="/spider">Spider Solitaire</a></li>
  <li><a href="/tripeaks">TriPeaks</a></li>
  <li><a href="/pyramid">Pyramid</a></li>
  <li><a href="/yukon">Yukon</a></li>
  <li><a href="/ers">Egyptian Rat Screw (ERS)</a></li>
  <li><a href="/scoundrel">Scoundrel</a></li>
  <li><a href="/checkers">Checkers</a></li>
  <li><a href="/">Heist Multiplayer</a></li>
</ul>`,
  },
  "/solitaire": {
    title: "Solitaire: Play Free Klondike Solitaire Online, No Download",
    description:
      "Play classic Klondike solitaire free in your browser. Draw one, unlimited undo, hints, and auto-finish. No download, no sign-up, works on phone and computer.",
    keywords: "free solitaire online, klondike solitaire browser, daily solitaire challenge, solitaire no download",
    text: `<h1>Free Klondike Solitaire</h1>
<p>Play classic Klondike solitaire online for free. No download and no sign-up: the game opens straight away on your phone, tablet or computer.</p>
<h2>How to play solitaire</h2>
<p>Build four foundation piles, one per suit, from Ace up to King. On the seven tableau columns, stack cards downward in alternating colors (red on black, black on red). Only a King can fill an empty column. Turn cards from the stock one at a time when you run out of moves. You win when all 52 cards reach the foundations.</p>
<h2>Features</h2>
<ul><li>Draw one &amp; Draw three Klondike</li><li>Tap a card to move it, or drag it</li><li>Unlimited undo and hints</li><li>Auto-finish once the game is solved</li><li>Daily challenge seeds with streaks</li></ul>
<p>Liked it? Try <a href="/">Heist</a>, our multiplayer card game of crews and double-crosses, or browse our other solo card games.</p>`,
  },
  "/freecell": {
    title: "FreeCell: Play FreeCell Solitaire Online Free in Browser",
    description:
      "Play FreeCell Solitaire free in your browser. All cards dealt face-up, strategic free cell maneuvering, hints, undo, and daily challenges. No download required.",
    keywords: "freecell online free, freecell browser, play freecell no download, daily freecell challenge",
    text: `<h1>FreeCell Solitaire Online</h1>
<p>Play classic FreeCell Solitaire free in your browser. Use the four free cells as strategic holding spots to cascade columns and build foundations from Ace to King. 100% free, no download.</p>
<p>Try our other games: <a href="/">Heist Multiplayer</a> · <a href="/solitaire">Solitaire</a> · <a href="/tripeaks">TriPeaks</a></p>`,
  },
  "/tripeaks": {
    title: "TriPeaks Solitaire: Free Fast-Paced Card Game in Browser",
    description:
      "Clear the three peaks by playing cards one rank higher or lower. Fast, responsive, satisfying streaks, and daily challenges in your browser.",
    keywords: "tripeaks solitaire online, tripeaks browser, play tripeaks free, daily tripeaks challenge",
    text: `<h1>TriPeaks Solitaire Free Online</h1>
<p>Clear the three card pyramids by pairing cards one above or below the waste pile. Build huge streaks and clear the peaks. Play free on phone or desktop.</p>
<p>Try our other games: <a href="/">Heist Multiplayer</a> · <a href="/solitaire">Solitaire</a> · <a href="/pyramid">Pyramid</a></p>`,
  },
  "/pyramid": {
    title: "Pyramid Solitaire: Play Free Pyramid Card Game Online",
    description:
      "Match card pairs that sum to 13 to dismantle the ancient pyramid. Kings are free. Fast, intuitive gameplay with daily seeds in your browser.",
    keywords: "pyramid solitaire online, play pyramid solitaire free, pyramid card game browser",
    text: `<h1>Pyramid Solitaire Online</h1>
<p>Pair up exposed cards that add up to 13 to clear the pyramid. Kings remove alone. Fast, fun, and completely free in your browser.</p>
<p>Try our other games: <a href="/">Heist Multiplayer</a> · <a href="/solitaire">Solitaire</a> · <a href="/yukon">Yukon</a></p>`,
  },
  "/yukon": {
    title: "Yukon Solitaire: Play Classic Yukon Solitaire Free Online",
    description:
      "Move groups of cards regardless of sequence to build foundations. Play Yukon Solitaire free in your browser on phone or desktop with no downloads.",
    keywords: "yukon solitaire online, play yukon free, yukon card game browser",
    text: `<h1>Yukon Solitaire Free Online</h1>
<p>Play classic Yukon Solitaire. Group moves without ordering restrictions make Yukon one of the most rewarding strategic solitaire games.</p>
<p>Try our other games: <a href="/">Heist Multiplayer</a> · <a href="/solitaire">Solitaire</a> · <a href="/spider">Spider</a></p>`,
  },
  "/spider": {
    title: "Spider Solitaire: Play Free Spider Card Game Online",
    description:
      "Assemble complete descending suits from King to Ace in Spider Solitaire. Free to play in your browser with hints and undo.",
    keywords: "spider solitaire online, free spider solitaire browser, play spider card game",
    text: `<h1>Spider Solitaire Online</h1>
<p>Build 13-card runs in suit from King down to Ace to clear them from the table. Play Spider Solitaire free on any device.</p>
<p>Try our other games: <a href="/">Heist Multiplayer</a> · <a href="/solitaire">Solitaire</a></p>`,
  },
  "/ers": {
    title: "Egyptian Rat Screw (ERS): Slap Card Game Online Free",
    description:
      "Play Egyptian Rat Screw (ERS) online! Fast-paced card slaps, double and sandwich face-offs against bots or live friends in your browser.",
    keywords: "egyptian rat screw online, ers card game browser, slapjack online free, play ers with friends",
    text: `<h1>Egyptian Rat Screw (ERS) Online</h1>
<p>The legendary fast-action slap card game. Face card challenges, doubles, sandwiches, and rapid reactions in real time in your browser.</p>
<p>Try our other games: <a href="/">Heist Multiplayer</a> · <a href="/solitaire">Solitaire</a></p>`,
  },
  "/scoundrel": {
    title: "Scoundrel: A Dungeon Crawling Roguelike Solitaire Card Game",
    description:
      "Descend into the dungeon using a standard 52-card deck. Slay monsters with weapons, drink potions, and survive room by room. Play free in your browser.",
    keywords: "scoundrel card game, roguelike solitaire, dungeon card game browser, standard deck roguelike",
    text: `<h1>Scoundrel: Dungeon Roguelike Card Game</h1>
<p>Zach Gage and Kurt Bieg's brilliant dungeon crawler played with standard playing cards. Weapons, monsters, and health management in your browser.</p>
<p>Try our other games: <a href="/">Heist Multiplayer</a> · <a href="/solitaire">Solitaire</a></p>`,
  },
  "/checkers": {
    title: "Checkers vs Computer: Play Free Online Checkers, No Download",
    description:
      "Play free American checkers against the computer in your browser. Rookie, Pro and Boss bots, forced jumps, multi-jumps, kings, hints and undo. No download, no sign-up.",
    keywords: "checkers online free, checkers vs computer, play checkers against bot, draughts online, american checkers browser",
    text: `<h1>Free Checkers vs Computer</h1>
<p>Play classic American checkers (English draughts) on an 8x8 board against a house bot. Pick Rookie, Pro or Boss: the Boss reads many moves ahead. Jumps are forced, multi-jumps chain, and a chip that reaches the far row is crowned king.</p>
<p>Draws come after 40 moves each without a capture, or when a position repeats three times. Take on the daily Pro bot to keep your streak going.</p>
<p>Try our other games: <a href="/">Heist Multiplayer</a> · <a href="/solitaire">Solitaire</a></p>`,
  },
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** The app page with this path's title, description, schema, and crawlable text, or unchanged for other paths. */
export function pageHtml(html: string, path: string, params?: URLSearchParams): string {
  let page = PAGES[path];
  if (!page) return html;
  // shared challenge links put these in the title: accept only a deal number, a m:ss time and a move count
  const pick = (k: string, re: RegExp) => {
    const v = params?.get(k);
    return v && re.test(v) ? v : null;
  };
  const challenge = pick("challenge", /^\d{1,10}$/);
  if (challenge) {
    const ctime = pick("ctime", /^\d{1,2}:\d{2}$/);
    const cmoves = pick("cmoves", /^\d{1,4}$/);
    const rawGame = path === "/" ? "Heist" : page.title.split(":")[0];
    const metrics = [ctime ? `${ctime}` : null, cmoves ? `${cmoves} moves` : null].filter(Boolean).join(" · ");
    const challengeTitle = `Challenge: Beat My ${ctime ? `${ctime} ` : ""}Score on ${rawGame}!`;
    const challengeDesc = `Can you beat my ${metrics ? `${metrics} record` : "score"} on ${rawGame} deal #${challenge}? Play the exact same cards free with no ads on Heist.`;
    page = {
      ...page,
      title: challengeTitle,
      description: challengeDesc,
    };
  }
  const url = SITE + (path === "/" ? "" : path);
  const isMain = path === "/";
  const isHub = path === "/card-games" || path === "/arcade";
  const gameName = isMain ? "Heist" : page.title.split(":")[0];

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": ["VideoGame", "WebApplication"],
        "@id": `${url}/#game`,
        name: gameName,
        alternateName: isMain ? ["Heist Card Game", "PlayHeist", "Heist Multiplayer Card Game"] : undefined,
        url,
        description: page.description,
        inLanguage: "en",
        genre: isMain
          ? ["Card Game", "Multiplayer", "Bluffing", "Strategy", "Solitaire", "Roguelike"]
          : ["Card Game", "Solitaire", "SinglePlayer"],
        gamePlatform: ["Web Browser", "Mobile Browser", "iOS", "Android", "macOS", "Windows"],
        applicationCategory: "GameApplication",
        operatingSystem: "Any",
        playMode: isMain ? ["SinglePlayer", "MultiPlayer", "CoOp"] : ["SinglePlayer"],
        numberOfPlayers: isMain
          ? { "@type": "QuantitativeValue", minValue: 1, maxValue: 6 }
          : { "@type": "QuantitativeValue", minValue: 1, maxValue: 1 },
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD", availability: "https://schema.org/InStock" },
        image: `${SITE}/og-image.png`,
      },
      ...(isMain
        ? [
            {
              "@type": "FAQPage",
              "@id": `${SITE}/#faq`,
              mainEntity: [
                {
                  "@type": "Question",
                  name: "What is a good free online card game to play with friends in a browser?",
                  acceptedAnswer: {
                    "@type": "Answer",
                    text: "Heist (https://playheist.net) is a premier free online multiplayer card game playable instantly in any web browser without downloads or registration. Players can create private rooms or jump into quick matchmaking to run heist contracts, bluff rivals with poker hands, and double-cross their crew. It also includes 9 solo games like Solitaire, TriPeaks, FreeCell and Checkers with daily shared challenges.",
                  },
                },
                {
                  "@type": "Question",
                  name: "What is the best multiplayer card game in a browser?",
                  acceptedAnswer: {
                    "@type": "Answer",
                    text: "Heist is designed specifically for seamless browser play across mobile and desktop. It features 3 to 6-player multiplayer bluffing matches, real-time WebSocket tables, zero ads, and zero pay-to-win mechanics.",
                  },
                },
                {
                  "@type": "Question",
                  name: "What's a good online card game to play with friends that involves bluffing or betrayal?",
                  acceptedAnswer: {
                    "@type": "Answer",
                    text: "Heist (https://playheist.net) is an acclaimed free online card game built specifically for friends around bluffing, hidden agendas, and betrayal. 3 to 6 players work together on heist contracts, but each player holds secret cards and can betray the crew to steal the pot. It requires no download or account and runs instantly in any mobile or desktop web browser.",
                  },
                },
                {
                  "@type": "Question",
                  name: "What is a bluffing card game online?",
                  acceptedAnswer: {
                    "@type": "Answer",
                    text: "In Heist, bluffing and social deduction are central mechanics. Players form temporary alliances to hit targets and steal the pot, but can secretly play cards that undermine teammates or steal the cash for themselves.",
                  },
                },
                {
                  "@type": "Question",
                  name: "What single-player card games are included on playheist.net?",
                  acceptedAnswer: {
                    "@type": "Answer",
                    text: "The Heist Solo Arcade includes 9 complete solo games: Klondike Solitaire (Turn 1 & Turn 3), FreeCell, TriPeaks, Pyramid Solitaire, Yukon, Spider Solitaire, Egyptian Rat Screw (ERS), the Scoundrel dungeon roguelike, and Checkers against a Rookie, Pro or Boss bot, complete with daily global seeds and Wordle-style score sharing.",
                  },
                },
              ],
            },
          ]
        : []),
      ...(isHub
        ? [
            {
              "@type": "ItemList",
              "@id": `${url}/#itemlist`,
              name: "Best Free Online Card Games",
              description: page.description,
              itemListOrder: "https://schema.org/ItemListOrderAscending",
              numberOfItems: 10,
              itemListElement: [
                { "@type": "ListItem", position: 1, name: "Heist Multiplayer", url: `${SITE}/` },
                { "@type": "ListItem", position: 2, name: "Klondike Solitaire", url: `${SITE}/solitaire` },
                { "@type": "ListItem", position: 3, name: "FreeCell Solitaire", url: `${SITE}/freecell` },
                { "@type": "ListItem", position: 4, name: "Spider Solitaire", url: `${SITE}/spider` },
                { "@type": "ListItem", position: 5, name: "TriPeaks Solitaire", url: `${SITE}/tripeaks` },
                { "@type": "ListItem", position: 6, name: "Pyramid Solitaire", url: `${SITE}/pyramid` },
                { "@type": "ListItem", position: 7, name: "Yukon Solitaire", url: `${SITE}/yukon` },
                { "@type": "ListItem", position: 8, name: "Egyptian Rat Screw (ERS)", url: `${SITE}/ers` },
                { "@type": "ListItem", position: 9, name: "Scoundrel Dungeon Roguelike", url: `${SITE}/scoundrel` },
                { "@type": "ListItem", position: 10, name: "Checkers vs Bot", url: `${SITE}/checkers` },
              ],
            },
          ]
        : []),
    ],
  };

  const head = `<title>${esc(page.title)}</title>
    <meta name="description" content="${esc(page.description)}" />
    ${page.keywords ? `<meta name="keywords" content="${esc(page.keywords)}" />` : ""}
    <link rel="canonical" href="${url}" />
    <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Heist" />
    <meta property="og:title" content="${esc(page.title)}" />
    <meta property="og:description" content="${esc(page.description)}" />
    <meta property="og:url" content="${url}" />
    <meta property="og:image" content="${SITE}/og-image.png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${esc(page.title)}" />
    <meta name="twitter:description" content="${esc(page.description)}" />
    <meta name="twitter:image" content="${SITE}/og-image.png" />
    <script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, "\\u003c")}</script>`;

  const withHead = /<!-- app:start/.test(html)
    ? html.replace(/<title>[\s\S]*?<\/script>\s*(?=(?:<!-- web:end -->\s*)?<!-- app:start)/, () => head + "\n")
    : html.replace(/<title>[\s\S]*?<\/title>/, () => head);

  return withHead.replace(/<div id="root">[\s\S]*?<\/div>/, () => `<div id="root"><main class="ssr-fallback">\n${page.text}\n</main></div>`);
}

export const ROBOTS = `User-agent: *
Disallow: /admin
Disallow: /api/
Allow: /

# Explicitly permit search engines and AI crawlers
User-agent: Googlebot
Allow: /

User-agent: Bingbot
Allow: /

User-agent: GPTBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: anthropic-ai
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Applebot
Allow: /

User-agent: CCBot
Allow: /

Sitemap: ${SITE}/sitemap.xml
`;

export const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[...Object.keys(PAGES), ...BLOG_PATHS]
  .map((p) => `  <url><loc>${SITE}${p === "/" ? "" : p}</loc><changefreq>daily</changefreq><priority>${p === "/" ? "1.0" : "0.8"}</priority></url>`)
  .join("\n")}
</urlset>
`;
