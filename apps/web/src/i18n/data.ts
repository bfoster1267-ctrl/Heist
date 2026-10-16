// Names and text of things the packages define (Roles, cards, lessons, stages, items...), in the active
// language. Each falls back to the package's English when a key is missing.
import { CREWS, ROLES, cardSay, type Card, type RoleId } from "@heist/engine";
import { LESSONS, STAGES, TIERS, cosmetic, drink, getDailyChallenge, rankLevel, rankName, type Cosmetic, type DailyChallenge, type Idea, type MistakeId, MISTAKES } from "@heist/profile";
import { t, tEn, tk, tSay } from ".";

export const crewName = (i: number) => (CREWS[i] ? tk(`crew.${CREWS[i].id}`, CREWS[i].name) : "");
export const roleName = (r: RoleId | null | undefined) => (r ? tk(`role.${r}.name`, ROLES.find((x) => x.id === r)?.name ?? r) : t("role.none"));
/** A Role's name without "The"/"O" ("Muscle", "Brutamontes"). */
export const roleShort = (r: RoleId | null | undefined) => roleName(r).replace(/^(The|O|A) /, "");
export const roleText = (r: RoleId) => tk(`role.${r}.text`, ROLES.find((x) => x.id === r)?.text ?? "");
export const cardName = (c: Card) => tSay(cardSay(c));

export const lessonName = (n: number | undefined) => (n ? tk(`lesson.${n}.name`, LESSONS.find((l) => l.n === n)?.name ?? "") : "");
export const lessonBlurb = (n: number | undefined) => (n ? tk(`lesson.${n}.blurb`, LESSONS.find((l) => l.n === n)?.blurb ?? "") : "");
export const ideaTitle = (i: Idea) => (i.id ? tk(`idea.${i.id}.title`, i.title) : i.title);
export const ideaText = (i: Idea) => (i.id ? tk(`idea.${i.id}.text`, i.text) : i.text);
export const mistakeTitle = (id: MistakeId) => tk(`mistake.${id}.title`, MISTAKES[id]?.title ?? "");
export const mistakeWhy = (id: MistakeId) => tk(`mistake.${id}.why`, MISTAKES[id]?.why ?? "");

export const stageName = (n: number) => tk(`stage.${n}.name`, STAGES[n - 1]?.name ?? "");
export const stageBlurb = (n: number) => tk(`stage.${n}.blurb`, STAGES[n - 1]?.blurb ?? "");
export const stageTwist = (n: number) => tk(`stage.${n}.twist`, STAGES[n - 1]?.twist ?? "");

/** The rank name under a player's level ("Wheelman"). */
export const rankTitle = (level: number) => tk(`rank.${rankLevel(level)}`, rankName(level));
/** A Ranked tier's name ("Gold"). */
export const tierName = (tier: number | string) => {
  const n = typeof tier === "number" ? TIERS[tier] : tier;
  return n ? tk(`tier.${n}`, n) : "";
};
/** A Ranked label the server sent ("Gold II", "Opening Night: Gold II", "Unranked this season"). */
export function rankLabel(label: string | null | undefined): string {
  if (!label) return "";
  const m = /^(.*): (.*)$/.exec(label);
  if (m) return `${tEn(m[1])}: ${rankLabel(m[2])}`;
  const r = /^(\w+)( [IVX]+)?$/.exec(label);
  if (r && (TIERS as readonly string[]).includes(r[1])) return tierName(r[1]) + (r[2] ?? "");
  return tEn(label);
}

/** An item's name: shop items by id, season items from their parts. */
export function cosName(c: Cosmetic | string | undefined | null): string {
  const x = typeof c === "string" ? cosmetic(c) : c;
  if (!x) return typeof c === "string" ? c : "";
  if (!x.id.startsWith("s1.")) return tk(`cos.${x.id}`, x.name);
  const [, slot, key] = x.id.split(".");
  const color = tk(`s1.color.${key}`, key);
  switch (slot) {
    case "felt":
      return t("s1.felt", { color });
    case "chat":
      return t("s1.bubble", { color });
    case "cardBack":
    case "banner": {
      // the style is the English name's last word ("Crimson Stripes")
      const style = x.name.split(" ").pop()!.toLowerCase();
      return t("s1.styled", { color, style: tk(`s1.style.${style}`, style) });
    }
    case "frame":
      return color;
    case "title":
      return tk(`s1.title.${key}`, x.name);
    case "emote":
      return tk(`s1.emote.${key}`, x.name);
    case "drink":
      return tk(`s1.drink.${key}`, x.name);
    default:
      return x.name; // cigars keep their names (Corona, Robusto...)
  }
}

/** A title worn under a name: the title item's text, translated when it's one we know. */
export function titleText(text: string | null | undefined): string {
  if (!text) return "";
  return tEn(text);
}

/** A drink's name (shop or season). */
export function drinkName(id: string): string {
  const d = drink(id);
  if (!d) return id;
  return id.startsWith("s1.") ? cosName(id) : tk(`drink.${id}`, d.name);
}

/** Today's daily challenge for a game, with its title, description and goal in the active language. */
export function dailyText(c: DailyChallenge): { title: string; description: string; goal: string } {
  return {
    title: tk(`daily.${c.game}.title`, c.title),
    description: tk(`daily.${c.game}.description`, c.description),
    goal: tEn(c.goal.description),
  };
}

export const dailyFor = (game: string, date?: string) => dailyText(getDailyChallenge(game, date));
