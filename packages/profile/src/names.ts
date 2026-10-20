// Cringe names ("SirSneezesALot", "MoistNugget", "xXSoggyWaffleXx"): new players who didn't pick a name get
// one (the server makes sure it's unique), and so does every bot at the table.

const TITLES = ["Sir", "Lord", "Lady", "Duke", "Baron", "Count", "King", "Queen", "Captain", "Dr", "Prince", "Mister", "Madam", "Uncle", "Auntie", "Big", "Lil", "Chef", "Coach", "Saint"];
const VERBS = [
  "Sneezes", "Burps", "Toots", "Sniffs", "Licks", "Drools", "Yeets", "Sweats", "Naps", "Cries", "Snorts", "Hiccups", "Slurps", "Simps",
  "Waddles", "Wiggles", "Giggles", "Mumbles", "Squeaks", "Fumbles", "Bluffs", "Folds", "Ragequits", "Snoozes", "Whines", "Pouts", "Twerks",
  "Moonwalks", "Overthinks", "Monologues", "Tattles", "Snacks", "Sulks", "Flexes", "Dabs", "Vibes", "Panics", "Gossips", "Blushes", "Trips",
];
const ADJECTIVES = [
  "Moist", "Crusty", "Soggy", "Thicc", "Smol", "Sweaty", "Spicy", "Greasy", "Chonky", "Feral", "Unhinged", "Damp", "Sus", "Salty", "Crispy",
  "Cheesy", "Stinky", "Sticky", "Wobbly", "Floppy", "Sassy", "Boujee", "Toasty", "Lumpy", "Gooey", "Fuzzy", "Clammy", "Musty", "Cursed",
  "Rizzless", "Sleepy", "Dramatic", "Extra", "Sneaky", "Bald", "Hairy", "Jiggly", "Grumpy", "Itchy", "Snacky", "Squishy", "Crunchy",
  "Flaky", "Dusty", "Wonky", "Goofy", "Derpy", "Sparkly", "Emo", "Lowkey", "Highkey", "Tiny", "Mega", "Turbo", "Budget", "Discount", "Expired",
];
const NOUNS = [
  "Nugget", "Noodle", "Muffin", "Burrito", "Pickle", "Tater", "Waffle", "Biscuit", "Goblin", "Gremlin", "Potato", "Meatball", "Turnip",
  "Crouton", "Hotdog", "Pudding", "Dumpling", "Pancake", "Weasel", "Possum", "Raccoon", "Walrus", "Llama", "Shrimp", "Toad", "Gecko",
  "Duckling", "Hamster", "Ferret", "Chungus", "Bean", "Sock", "Toenail", "Elbow", "Belly", "Kneecap", "Mullet", "Unibrow", "Burger",
  "Taco", "Corndog", "Bagel", "Pretzel", "Tofu", "Spud", "Sardine", "Moth", "Pigeon", "Goose", "Platypus", "Armpit", "Nostril",
  "Cabbage", "Cupcake", "Sprinkle", "Jellybean", "Gnome", "Troll", "Wizard", "Peasant", "Intern", "Karen", "Chad", "Kevin", "Brenda",
];
const SUFFIXES = ["UwU", "OwO", "Lord", "Slayer", "Enjoyer", "Gamer", "Lover", "Bandit", "Supreme", "Senpai", "Bestie", "Kween", "Wrangler", "Yeeter", "Snacc"];
/** keeps names short enough for a seat plate (the server cuts names at 20 characters) */
const MAX = 20;

const uniq = (xs: string[]) => [...new Set(xs)];
const titles = uniq(TITLES);
const verbs = uniq(VERBS);
const adjectives = uniq(ADJECTIVES);
const nouns = uniq(NOUNS);
const suffixes = uniq(SUFFIXES);

/** The ways a name is built, each picking its parts with pick(). */
const SHAPES: ((pick: <T>(xs: T[]) => T) => string)[] = [
  (p) => `${p(titles)}${p(verbs)}ALot`, // SirSneezesALot
  (p) => `${p(adjectives)}${p(nouns)}`, // MoistNugget
  (p) => `xX${p(adjectives)}${p(nouns)}Xx`, // xXSoggyWaffleXx
  (p) => `${p(nouns)}${p(suffixes)}`, // NoodleEnjoyer
  (p) => `${p(adjectives)}${p(nouns)}${p(suffixes)}`, // DampGoblinUwU
];

/** How many different names there are (only the ones that fit). */
export function cringeNameCount(): number {
  const fit = (xs: string[]) => xs.filter((s) => s.length <= MAX).length;
  const an = adjectives.flatMap((a) => nouns.map((n) => a + n));
  return (
    fit(titles.flatMap((t) => verbs.map((v) => `${t}${v}ALot`))) +
    fit(an) +
    fit(an.map((s) => `xX${s}Xx`)) +
    fit(nouns.flatMap((n) => suffixes.map((s) => n + s))) +
    fit(an.flatMap((s) => suffixes.map((x) => s + x)))
  );
}

/**
 * A fresh cringe name nobody has yet (taken holds names in lower case). After many misses it falls back to a
 * name with a number on the end, which is still unique.
 */
export function cringeName(taken: Set<string> = new Set(), rand: (n: number) => number = (n) => Math.floor(Math.random() * n)): string {
  const pick = <T>(xs: T[]) => xs[rand(xs.length)];
  for (let i = 0; i < 60; i++) {
    const n = SHAPES[rand(SHAPES.length)](pick);
    if (n.length <= MAX && !taken.has(n.toLowerCase())) return n;
  }
  for (;;) {
    const n = `${pick(adjectives)}${pick(nouns)}`.slice(0, MAX - 4) + (1000 + rand(9000));
    if (!taken.has(n.toLowerCase())) return n;
  }
}

/** Bot names for one table, all different and none in taken (lower case); the same rand gives the same names. */
export function cringeBotNames(count: number, rand?: (n: number) => number, taken: Set<string> = new Set()): string[] {
  const seen = new Set(taken);
  return Array.from({ length: count }, () => {
    const n = cringeName(seen, rand);
    seen.add(n.toLowerCase());
    return n;
  });
}
