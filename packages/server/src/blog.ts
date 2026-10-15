// The blog: plain pages written on the server (no app needed), so search engines read every word. Each post
// answers what someone searched for, then sends them to playheist.net, where a first visit starts the coached
// first hand.

const SITE = "https://playheist.net";

export interface Post {
  slug: string;
  title: string;
  description: string;
  date: string; // YYYY-MM-DD
  body: string; // HTML
}

const PLAY = `<p class="cta"><a href="/">Play Heist free</a><span>No download. Your first hand is coached.</span></p>`;

const HEIST_PICK = `<p><strong>Full disclosure:</strong> Heist is our game, so take this pick with that in mind.</p>
<p>Heist is a card game for 3 to 6 players that runs in your browser on a phone or computer. Everyone joins crews to pull jobs and split the score, and anyone can double-cross the table when the moment is right. You can play friends with a table code, quick-match strangers, or practice against bots. It's free, and your first hand is coached, so nobody has to read a rulebook first.</p>`;

export const POSTS: Post[] = [
  {
    slug: "best-free-online-card-games",
    title: "10 Best Free Online Card Games to Play in Your Browser (2026, No Ads)",
    description:
      "Looking for the best free online card games to play in your browser with no download and no ads? Here are 10 top single-player and multiplayer card games.",
    date: "2026-10-15",
    body: `<p>Most modern online card games have become bloated with 30-second unskippable video ads, predatory microtransactions, or require massive app store downloads. But a classic deck of 52 cards was meant to be fast, elegant, and instantly accessible.</p>
<p>Whether you have five minutes to unwind between meetings, want to challenge friends across group chat, or want to tackle daily seeded brainteasers, here are the <strong>10 best free online card games you can play right in your browser</strong> in 2026—100% free, zero downloads, and completely ad-free.</p>

<div class="game-card">
  <span class="badge">Multiplayer · 3–6 Players</span>
  <h2>1. Heist</h2>
  <p><strong>What it is:</strong> A fast-paced multiplayer poker-bluffing and social deduction card game for 3 to 6 players.</p>
  <p><strong>Why it's on this list:</strong> ${HEIST_PICK}</p>
  <p>You form temporary crews with other players to hit heist targets, but every player holds hidden cards and secret agendas. When the payout lands on the table, you can honor your handshake or trigger a ruthless double-cross to walk away with the entire pot. If your friends aren't online, adaptive AI bots fill empty seats instantly.</p>
  <p><a class="play-btn" href="/">Play Heist Online Free →</a></p>
</div>

<div class="game-card">
  <span class="badge">Solo · Casual</span>
  <h2>2. Klondike Solitaire</h2>
  <p><strong>What it is:</strong> The undisputed king of single-player card games. Build 4 foundation piles from Ace to King while ordering 7 tableau columns in alternating colors.</p>
  <p><strong>Why it's on this list:</strong> Most Solitaire websites flash banner ads across your screen or force 15-second popups after every deal. On <a href="/solitaire">Heist Solitaire</a>, you get a clean casino-felt tabletop with Draw 1 and Draw 3 modes, unlimited undo, smart hints, auto-finish, and a daily global challenge seed with streak multipliers.</p>
  <p><a class="play-btn" href="/solitaire">Play Klondike Solitaire Free →</a></p>
</div>

<div class="game-card">
  <span class="badge">Solo · Pure Strategy</span>
  <h2>3. FreeCell Solitaire</h2>
  <p><strong>What it is:</strong> A masterclass in open-information puzzle solving where all 52 cards are dealt face-up across 8 cascades.</p>
  <p><strong>Why it's on this list:</strong> Unlike Klondike where hidden cards can make a deal impossible, virtually every FreeCell deal (99.99%) is mathematically winnable. With 4 open reserve cells to stage maneuvers and strategic cascade manipulation, FreeCell rewards foresight and deep calculation rather than luck of the draw.</p>
  <p><a class="play-btn" href="/freecell">Play FreeCell Free →</a></p>
</div>

<div class="game-card">
  <span class="badge">Solo · High Depth</span>
  <h2>4. Spider Solitaire</h2>
  <p><strong>What it is:</strong> A challenging 10-column tableau puzzle where your objective is to assemble complete descending sequences from King down to Ace.</p>
  <p><strong>Why it's on this list:</strong> Spider is the marathon of solitaire games. Managing empty columns and untangling overlapping suit cascades requires patience and disciplined planning. When you assemble a full 13-card suit run and watch it sweep off the table, few feelings in digital card gaming match it.</p>
  <p><a class="play-btn" href="/spider">Play Spider Solitaire Free →</a></p>
</div>

<div class="game-card">
  <span class="badge">Solo · Fast Arcade</span>
  <h2>5. TriPeaks Solitaire</h2>
  <p><strong>What it is:</strong> A high-tempo arcade solitaire where cards are dealt in three ascending mountain peaks over a face-up waste pile.</p>
  <p><strong>Why it's on this list:</strong> If traditional Klondike feels slow, TriPeaks is pure adrenaline. You clear cards that are one rank higher or lower than the waste pile (e.g. 5 on 6 or 4). Chaining 8, 9, or 10-card streaks triggers combo multipliers, making it the perfect 2-minute quick break game.</p>
  <p><a class="play-btn" href="/tripeaks">Play TriPeaks Free →</a></p>
</div>

<div class="game-card">
  <span class="badge">Solo · Math & Logic</span>
  <h2>6. Pyramid Solitaire</h2>
  <p><strong>What it is:</strong> An ancient pairing puzzle where 28 cards form a pyramid. You dismantle the pyramid by removing exposed pairs whose values sum to 13.</p>
  <p><strong>Why it's on this list:</strong> Kings clear by themselves (value 13), Queens pair with Aces (12 + 1), Jacks pair with Twos (11 + 2), and Tens pair with Threes (10 + 3). It tests your mental math and spatial foresight: do you take the easy pair now or hold out to unlock an obstructed card underneath?</p>
  <p><a class="play-btn" href="/pyramid">Play Pyramid Solitaire Free →</a></p>
</div>

<div class="game-card">
  <span class="badge">Solo · Expert Tableau</span>
  <h2>7. Yukon Solitaire</h2>
  <p><strong>What it is:</strong> A dynamic Klondike variant where there is no draw stock—all cards are dealt directly into the 7 tableau columns from the start.</p>
  <p><strong>Why it's on this list:</strong> In Yukon, you can move any group of face-up cards regardless of how deep they are or whether the cards resting on top are in sequence. This complete freedom of movement creates astonishing tactical recovery opportunities when a column appears hopelessly jammed.</p>
  <p><a class="play-btn" href="/yukon">Play Yukon Solitaire Free →</a></p>
</div>

<div class="game-card">
  <span class="badge">1–2 Players · Reaction & PvP</span>
  <h2>8. Egyptian Rat Screw (ERS)</h2>
  <p><strong>What it is:</strong> The classic high-energy slap card game. Face-card penalty battles, double pairs, and sandwich slaps.</p>
  <p><strong>Why it's on this list:</strong> ERS is legendary in dorm rooms and summer camps, but rare online. On Heist, you can duel responsive AI bots or create a private 1v1 PvP room link to challenge a friend across the internet in real-time reaction slap-offs.</p>
  <p><a class="play-btn" href="/ers">Play ERS Free →</a></p>
</div>

<div class="game-card">
  <span class="badge">Solo · Dungeon Roguelike</span>
  <h2>9. Scoundrel</h2>
  <p><strong>What it is:</strong> Zach Gage and Kurt Bieg's brilliant roguelike dungeon crawler played entirely with a standard 52-card deck.</p>
  <p><strong>Why it's on this list:</strong> Clubs and Spades are monsters (2 to 10 and face cards), Diamonds are weapons, and Hearts are health potions. You enter rooms of 4 cards, choose 3 to resolve, and try to escape alive with 20 HP. It feels like Slay the Spire condensed into 5 minutes with a real physical deck.</p>
  <p><a class="play-btn" href="/scoundrel">Play Scoundrel Free →</a></p>
</div>

<div class="game-card">
  <span class="badge">Party · 4–10 Players</span>
  <h2>10. Liar's Dice & Cheat (BS)</h2>
  <p><strong>What it is:</strong> The timeless party games of deception, bidding, and bluff-catching.</p>
  <p><strong>Why it's on this list:</strong> When you have a big party and want simple verbal interaction, games like Cheat (or browser dice implementations like LiarsBar.io) bring loud laughs and table accusations without needing game installs.</p>
</div>

<h2>Quick Comparison: Find Your Next Card Game</h2>
<div class="table-wrap">
  <table>
    <thead>
      <tr>
        <th>Game</th>
        <th>Players</th>
        <th>Difficulty</th>
        <th>Pace</th>
        <th>Play Free</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>Heist</strong></td>
        <td>3–6 Players</td>
        <td>Medium</td>
        <td>Social / Real-Time</td>
        <td><a href="/">Play Online</a></td>
      </tr>
      <tr>
        <td><strong>Klondike Solitaire</strong></td>
        <td>1 Player</td>
        <td>Casual</td>
        <td>Relaxing</td>
        <td><a href="/solitaire">Play Online</a></td>
      </tr>
      <tr>
        <td><strong>FreeCell</strong></td>
        <td>1 Player</td>
        <td>Expert</td>
        <td>Strategic</td>
        <td><a href="/freecell">Play Online</a></td>
      </tr>
      <tr>
        <td><strong>Spider Solitaire</strong></td>
        <td>1 Player</td>
        <td>Expert</td>
        <td>Deep / Deliberate</td>
        <td><a href="/spider">Play Online</a></td>
      </tr>
      <tr>
        <td><strong>TriPeaks</strong></td>
        <td>1 Player</td>
        <td>Casual</td>
        <td>Fast / Arcade</td>
        <td><a href="/tripeaks">Play Online</a></td>
      </tr>
      <tr>
        <td><strong>Pyramid</strong></td>
        <td>1 Player</td>
        <td>Medium</td>
        <td>Puzzle / Math</td>
        <td><a href="/pyramid">Play Online</a></td>
      </tr>
      <tr>
        <td><strong>Yukon</strong></td>
        <td>1 Player</td>
        <td>Medium</td>
        <td>Tactical</td>
        <td><a href="/yukon">Play Online</a></td>
      </tr>
      <tr>
        <td><strong>Egyptian Rat Screw (ERS)</strong></td>
        <td>1–2 Players</td>
        <td>Medium</td>
        <td>Lightning Fast</td>
        <td><a href="/ers">Play Online</a></td>
      </tr>
      <tr>
        <td><strong>Scoundrel</strong></td>
        <td>1 Player</td>
        <td>Hard</td>
        <td>Roguelike Crawl</td>
        <td><a href="/scoundrel">Play Online</a></td>
      </tr>
    </tbody>
  </table>
</div>

<h2>Frequently Asked Questions</h2>
<h3>What is the best free online card game to play in a browser?</h3>
<p>For solo players who want a relaxing classic, <strong>Klondike Solitaire</strong> is the #1 choice. For puzzle enthusiasts who dislike random luck, <strong>FreeCell</strong> is unmatched. For groups of friends looking to bluff and betray each other, <strong>Heist</strong> provides the best browser multiplayer card game experience with zero downloads or accounts required.</p>

<h3>Are these online card games completely free with no ads?</h3>
<p>Yes. All games listed on <a href="/">playheist.net</a> are 100% free with no video ads, no paywalls, and no popups interrupting your gameplay.</p>

<h3>Can I play these card games on my phone without downloading an app?</h3>
<p>Yes! Every game listed runs directly inside mobile Safari, Chrome, and Firefox. You can also tap "Add to Home Screen" on iOS or Android to launch them full-screen like native apps with offline caching support.</p>`,
  },
  {
    slug: "games-like-liars-bar",
    title: "Games Like Liar's Bar You Can Play Free in Your Browser",
    description:
      "Loved the bluffing in Liar's Bar? Here are free games with the same lie-to-your-friends energy, most of which run in a browser with no download.",
    date: "2026-10-11",
    body: `<p>Liar's Bar took off because it's simple: four players at a table, a hand of cards or dice, and the constant question of whether the person across from you is lying. It's a paid PC game on Steam, though, so it's not something you can send to a friend on their phone.</p>
<p>If you want that same feeling of reading people and getting away with a lie, here are games worth trying. Most are free, and most run in a browser.</p>
<h2>1. Liar's Dice (LiarsBar.io)</h2>
<p>The dice half of Liar's Bar is an old game, also called Perudo or Dudo. Everyone rolls in secret and bids on how many of a face are on the whole table, and you either raise the bid or call the last bidder a liar. LiarsBar.io is a free browser version with private rooms for friends. It's the closest match if you liked the dice mode.</p>
<h2>2. Cheat (also called BS or I Doubt It)</h2>
<p>Liar's Deck is basically Cheat with higher stakes. Players lay cards face down and announce what they are, and anyone can call "cheat." The loser of the challenge picks up the pile. All you need is one deck of cards, so it's free and easy to teach on game night.</p>
<h2>3. Heist</h2>
${HEIST_PICK}
<p>Where Liar's Bar is about catching a single lie, Heist is about timing a betrayal. You'll spend most of a game cooperating, which makes the double-cross hurt more.</p>
${PLAY}
<h2>4. Secret Hitler</h2>
<p>A hidden-role game for 5 to 10 players. Liberals try to pass liberal policies and find the hidden fascists, who try to lie their way into power. Every round turns into an argument about who's telling the truth. The rules are released under a Creative Commons license, and free fan-made browser versions such as secrethitler.io exist.</p>
<h2>5. Among Us</h2>
<p>The social deduction game most people already know. Crewmates do tasks while impostors sabotage and pick them off, then everyone argues in meetings. It's free on phones and cheap on PC, and it works best with a big group of friends on voice chat.</p>
<h2>6. Codenames</h2>
<p>Not a lying game, but it scratches the same "can I read my friends" itch. Two teams race to guess their secret words from one-word clues. The publisher runs a free browser version at codenames.game.</p>
<h2>Which one should you try?</h2>
<ul>
<li><strong>Closest to Liar's Bar:</strong> Liar's Dice or Cheat.</li>
<li><strong>Want betrayal, not just bluffing:</strong> Heist.</li>
<li><strong>Big group (7 or more):</strong> Secret Hitler or Among Us.</li>
</ul>`,
  },
  {
    slug: "online-betrayal-card-games",
    title: "Best Online Betrayal Card Games to Play With Friends",
    description:
      "Card and board games where backstabbing your friends is the point, and where to play them online, from Coup and Skull to Heist.",
    date: "2026-10-11",
    body: `<p>Some games are about winning together. These are about being trusted right up until the moment you aren't. If your group's favorite part of game night is the betrayal, start here.</p>
<h2>What makes a good betrayal game?</h2>
<p>The best ones make you need other players before they let you turn on them. If you can betray someone at any moment, nobody trusts anyone and it falls flat. The fun comes from building a deal, keeping it for a while, and then breaking it at exactly the right time.</p>
<h2>1. Heist</h2>
${HEIST_PICK}
<p>Betrayal is built into how Heist scores. Crews only pay off if they hold together long enough to pull the job, so every double-cross is a gamble on timing. Turn too early and you walk away with nothing.</p>
${PLAY}
<h2>2. Coup</h2>
<p>A quick bluffing card game for 2 to 6 players. Each player secretly holds two role cards and can claim to be any role to use its power. If nobody challenges you, the lie works. If someone does, the loser of the challenge loses a card. A game takes about 15 minutes, and there are free fan-made versions online.</p>
<h2>3. Skull</h2>
<p>Each player has four discs, three flowers and one skull. Players place discs face down, then bid on how many they can flip without hitting a skull. It's tiny, easy to teach, and full of bluffs, and it's best with 4 to 6 players.</p>
<h2>4. Secret Hitler</h2>
<p>A hidden-role game for 5 to 10 players in which the fascist team has to win the liberals' trust and then use it. Free fan-made browser versions such as secrethitler.io let you play online with friends.</p>
<h2>5. Diplomacy</h2>
<p>The classic betrayal game: seven players, pre-World War I Europe, no dice, only deals and broken promises. It's long (hours, or weeks when played online by mail), but nothing else feels quite like it. Several sites host free online games.</p>
<h2>Quick picks</h2>
<ul>
<li><strong>Short and on a phone:</strong> Heist or Coup.</li>
<li><strong>Party with a big group:</strong> Secret Hitler.</li>
<li><strong>A week-long grudge:</strong> Diplomacy.</li>
</ul>`,
  },
  {
    slug: "free-card-games-with-friends-online",
    title: "Free Card Games to Play With Friends Online (No Download)",
    description:
      "Card games you can play with friends online for free, straight in a browser. Classics, party games and a few you may not know yet.",
    date: "2026-10-11",
    body: `<p>Getting everyone to install the same app is the hardest part of playing cards with friends online. Every game here runs in a browser, so you can send a link and be playing in a minute.</p>
<h2>1. Heist</h2>
${HEIST_PICK}
<p>Heist is a good fit when you have 3 to 6 people and want something with more talking than a classic trick-taking game. If your friends aren't online yet, bots fill the empty seats.</p>
${PLAY}
<h2>2. Board Game Arena</h2>
<p>Not one game but hundreds. Board Game Arena hosts licensed versions of many card and board games, and you can play a large part of the catalog free in a browser. It's the best place to look if your group already has a favorite tabletop game.</p>
<h2>3. Codenames</h2>
<p>A team word game for 4 or more players. A spymaster gives one-word clues to get their team to guess the right words. The publisher's free browser version at codenames.game gives everyone a link to the same board.</p>
<h2>4. Classic card games</h2>
<p>Hearts, Spades, Euchre, Rummy and Crazy Eights all have free browser versions on many card game sites. Pick a site with private rooms so you can play with your own friends instead of strangers.</p>
<h2>5. Solitaire, between games</h2>
<p>Waiting for friends to show up? We also run a <a href="/solitaire">free Klondike solitaire</a> with undo and hints. No sign-up needed.</p>
<h2>Tips for a smooth game night</h2>
<ul>
<li>Get everyone on a voice call. Half the fun of a card game is the table talk.</li>
<li>Pick a game that's easy to teach the first time, then try something deeper next week.</li>
<li>Choose games that work on phones if anyone is joining from the couch.</li>
</ul>`,
  },
];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

const STYLE = `:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#0b0d10;color:#e8e6e1;font:17px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
header,main,footer{max-width:760px;margin:0 auto;padding:0 16px}header{display:flex;justify-content:space-between;align-items:center;padding-top:18px;padding-bottom:18px}
header a{color:#e8e6e1;text-decoration:none;font-weight:800;letter-spacing:.08em}header nav a{font-weight:600;letter-spacing:0;margin-left:16px;color:#c9a54a}
h1{font-size:2.1rem;line-height:1.2;margin:.6em 0 .3em}h2{font-size:1.35rem;margin:1.8em 0 .4em}h3{font-size:1.1rem;margin:1.2em 0 .3em;color:#e2bf5e}a{color:#e2bf5e}time{color:#8b8f96;font-size:.9rem}
.cta{background:#171b21;border:1px solid #2a3038;border-radius:14px;padding:18px;text-align:center;margin:24px 0}
.cta a{display:inline-block;background:#e2bf5e;color:#0b0d10;font-weight:800;text-decoration:none;padding:12px 26px;border-radius:999px}
.cta span{display:block;margin-top:8px;color:#8b8f96;font-size:.9rem}.list a{text-decoration:none}.list li{margin:1em 0}footer{color:#8b8f96;font-size:.85rem;padding-top:40px;padding-bottom:40px}
.game-card{background:#14181f;border:1px solid #232933;border-radius:12px;padding:18px;margin:20px 0}
.game-card h2{margin-top:0}
.badge{display:inline-block;background:#232933;color:#e2bf5e;font-size:0.8rem;font-weight:700;padding:3px 10px;border-radius:999px;margin-bottom:10px}
.play-btn{display:inline-block;background:#c9a54a;color:#0b0d10;font-weight:700;text-decoration:none;padding:8px 18px;border-radius:8px;margin-top:8px}
.table-wrap{overflow-x:auto;margin:24px 0}
table{width:100%;border-collapse:collapse;text-align:left;font-size:0.92rem}
th,td{padding:10px 12px;border-bottom:1px solid #232933}
th{color:#c9a54a;border-bottom:2px solid #333c4a;font-weight:700}`;

function page(o: { title: string; description: string; path: string; body: string; ld?: object }): string {
  const url = SITE + o.path;
  return `<!doctype html>
<html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.description)}" />
<link rel="canonical" href="${url}" />
<meta property="og:type" content="article" /><meta property="og:site_name" content="Heist" />
<meta property="og:title" content="${esc(o.title)}" /><meta property="og:description" content="${esc(o.description)}" />
<meta property="og:url" content="${url}" /><meta property="og:image" content="${SITE}/icons/apple-touch-icon.png" />
<link rel="icon" type="image/png" href="/icons/favicon-64.png" />
${o.ld ? `<script type="application/ld+json">${JSON.stringify(o.ld).replace(/</g, "\\u003c")}</script>` : ""}
<style>${STYLE}</style></head>
<body><header><a href="/">HEIST</a><nav><a href="/blog">Blog</a><a href="/">Play free</a></nav></header>
<main>${o.body}</main>
<footer>Heist is a free online card game of crews, jobs and double-crosses. <a href="/privacy.html">Privacy</a></footer>
</body></html>`;
}

/** The blog page for this path (/blog or /blog/<slug>), or null when there is none. */
export function blogPage(path: string): string | null {
  const p = path.replace(/\/+$/, "");
  if (p === "/blog") {
    const items = POSTS.map(
      (post) => `<li><a href="/blog/${post.slug}"><strong>${esc(post.title)}</strong></a><br />${esc(post.description)}</li>`,
    ).join("");
    return page({
      title: "Heist Blog: Card Games, Bluffing and Betrayal",
      description: "Guides to bluffing, betrayal and card games you can play with friends online, from the makers of Heist.",
      path: "/blog",
      body: `<h1>The Heist Blog</h1><p>Guides to card games, bluffing and betrayal you can play with friends online.</p><ul class="list">${items}</ul>${PLAY}`,
    });
  }
  const post = POSTS.find((x) => "/blog/" + x.slug === p);
  if (!post) return null;
  return page({
    title: post.title,
    description: post.description,
    path: "/blog/" + post.slug,
    body: `<article><h1>${esc(post.title)}</h1><time datetime="${post.date}">${post.date}</time>${post.body}</article>${PLAY}`,
    ld:
      post.slug === "best-free-online-card-games"
        ? {
            "@context": "https://schema.org",
            "@graph": [
              {
                "@type": "BlogPosting",
                headline: post.title,
                description: post.description,
                datePublished: post.date,
                url: SITE + "/blog/" + post.slug,
                publisher: { "@type": "Organization", name: "Heist", url: SITE },
              },
              {
                "@type": "ItemList",
                name: "10 Best Free Online Card Games to Play in Your Browser (2026, No Ads)",
                description: "The top 10 free online card games playable in any desktop or mobile browser with no download and zero ads.",
                itemListOrder: "https://schema.org/ItemListOrderAscending",
                numberOfItems: 10,
                itemListElement: [
                  { "@type": "ListItem", position: 1, name: "Heist (Multiplayer Poker Bluffing)", url: `${SITE}/` },
                  { "@type": "ListItem", position: 2, name: "Klondike Solitaire", url: `${SITE}/solitaire` },
                  { "@type": "ListItem", position: 3, name: "FreeCell Solitaire", url: `${SITE}/freecell` },
                  { "@type": "ListItem", position: 4, name: "Spider Solitaire", url: `${SITE}/spider` },
                  { "@type": "ListItem", position: 5, name: "TriPeaks Solitaire", url: `${SITE}/tripeaks` },
                  { "@type": "ListItem", position: 6, name: "Pyramid Solitaire", url: `${SITE}/pyramid` },
                  { "@type": "ListItem", position: 7, name: "Yukon Solitaire", url: `${SITE}/yukon` },
                  { "@type": "ListItem", position: 8, name: "Egyptian Rat Screw (ERS)", url: `${SITE}/ers` },
                  { "@type": "ListItem", position: 9, name: "Scoundrel Dungeon Roguelike", url: `${SITE}/scoundrel` },
                  { "@type": "ListItem", position: 10, name: "Liar's Dice & Cheat (BS)", url: `${SITE}/blog/best-free-online-card-games#cheat` },
                ],
              },
              {
                "@type": "FAQPage",
                mainEntity: [
                  {
                    "@type": "Question",
                    name: "What is the best free online card game to play in a browser?",
                    acceptedAnswer: {
                      "@type": "Answer",
                      text: "For solo puzzle games, Klondike Solitaire and FreeCell are the top picks. For multiplayer groups who want bluffing and social betrayal, Heist (https://playheist.net) is the leading free browser card game.",
                    },
                  },
                  {
                    "@type": "Question",
                    name: "Are there online card games with no ads?",
                    acceptedAnswer: {
                      "@type": "Answer",
                      text: "Yes, all card games on playheist.net are 100% free with zero video ads, popups, or subscriptions.",
                    },
                  },
                  {
                    "@type": "Question",
                    name: "Can I play online card games on mobile without downloading?",
                    acceptedAnswer: {
                      "@type": "Answer",
                      text: "Yes, every game runs directly in mobile Safari, Chrome, and Firefox browsers with full touch controls and offline caching.",
                    },
                  },
                ],
              },
            ],
          }
        : {
            "@context": "https://schema.org",
            "@type": "BlogPosting",
            headline: post.title,
            description: post.description,
            datePublished: post.date,
            url: SITE + "/blog/" + post.slug,
            publisher: { "@type": "Organization", name: "Heist", url: SITE },
          },
  });
}

export const BLOG_PATHS = ["/blog", ...POSTS.map((p) => "/blog/" + p.slug)];
