// A tiny i18n layer: English is the source catalog (en.ts), every other language is a full copy of its keys
// (pt-BR.ts, type-checked to have every English key). See README.md for how to add a string.
//
//   t("lobby.play")                      -> "Play" / "Jogar"
//   t("lobby.chips", { count: 3 })       -> picks lobby.chips_one / lobby.chips_other by count
//   tSay(frame.say, frame.msg)           -> a line the engine or server sent as a key + values
//   tEn(reward.label)                    -> English text from a package, matched back to its template
//   num(1234), date(at, {...})           -> Intl formatting in the active language
import { Fragment, createElement, useSyncExternalStore, type ReactNode } from "react";
import { pick, fill, type Say, type SayVar } from "@heist/engine";
import { getPrefs, setPrefs, subscribePrefs, type Lang } from "../prefs";
import { en, packageKeys } from "./en";
import { ptBR } from "./pt-BR";

export type Locale = "en" | "pt-BR";
export type MsgKey = keyof typeof en;
type PluralBase = { [K in MsgKey]: K extends `${infer B}_other` ? B : never }[MsgKey];
/** A catalog key, or the base of a key with `_one` / `_other` forms. */
export type TKey = MsgKey | PluralBase;
export type Vars = Record<string, string | number | null | undefined>;

export const LOCALES: { id: Locale; name: string }[] = [
  { id: "en", name: "English" },
  { id: "pt-BR", name: "Português (Brasil)" },
];

const CATALOGS: Record<Locale, Record<string, string>> = { en, "pt-BR": ptBR };

/** The browser's language when the player hasn't picked one: any Portuguese gets pt-BR, else English. */
export function browserLocale(): Locale {
  try {
    const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
    for (const l of langs) {
      const x = (l || "").toLowerCase();
      if (x.startsWith("pt")) return "pt-BR";
      if (x.startsWith("en")) return "en";
    }
  } catch {
    /* no navigator */
  }
  return "en";
}

const resolve = (lang: Lang | undefined): Locale => (lang === "en" || lang === "pt-BR" ? lang : browserLocale());

/** The language the game is showing now. */
export const getLocale = (): Locale => resolve(getPrefs().lang);

/** Pick a language ("auto" follows the browser). */
export function setLocale(lang: Lang) {
  setPrefs({ lang });
}

/** Re-renders the caller when the language changes; returns it. */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribePrefs, getLocale, getLocale);
}

// keep <html lang> in step
function syncHtmlLang() {
  try {
    document.documentElement.lang = getLocale();
  } catch {
    /* no document */
  }
}
syncHtmlLang();
subscribePrefs(syncHtmlLang);

const ptRules = typeof Intl !== "undefined" ? new Intl.PluralRules("pt-BR") : null;
/** Plural category: English is "one" only for 1; Brazilian Portuguese also treats 0 as plural ("0 fichas"). */
function pluralOf(locale: Locale): (n: number) => string {
  if (locale === "en") return (n) => (n === 1 ? "one" : "other");
  return (n) => (n === 0 ? "other" : ptRules?.select(n) ?? (n === 1 ? "one" : "other"));
}

function lookup(key: string, vars: Record<string, unknown> | undefined, locale: Locale): string | undefined {
  const count = vars?.count;
  return pick(CATALOGS[locale], key, count, pluralOf(locale)) ?? (locale !== "en" ? pick(en, key, count, pluralOf("en")) : undefined);
}

function fmtVars(vars: Vars | undefined, locale: Locale): Record<string, string | number> | undefined {
  if (!vars) return undefined;
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(vars)) {
    if (v === null || v === undefined) out[k] = "";
    else out[k] = typeof v === "number" && k !== "year" && Math.abs(v) >= 1000 ? num(v, locale) : v;
  }
  return out;
}

/** The text for `key` in the active language, with `{name}` slots filled from `vars`. */
export function t(key: TKey, vars?: Vars): string {
  const locale = getLocale();
  const tpl = lookup(key, vars, locale);
  return tpl === undefined ? key : fill(tpl, fmtVars(vars, locale));
}

/**
 * `t` where some {slots} are React nodes (a bold number, a link): returns a list to render as children.
 *   tNodes("act.odds", { b: <b>{3}</b>, m: <b>{5}</b> })
 */
export function tNodes(key: TKey, nodes: Record<string, ReactNode>, vars?: Vars): ReactNode[] {
  const locale = getLocale();
  const tpl = lookup(key, vars, locale) ?? key;
  const text = fill(tpl, fmtVars(vars, locale));
  return text.split(/\{(\w+)\}/g).map((part, i) => (i % 2 ? createElement(Fragment, { key: i }, nodes[part] ?? `{${part}}`) : part));
}

/** `t` where the text marks bold parts with **double stars**: returns a list to render as children. */
export function tRich(key: TKey, vars?: Vars): ReactNode[] {
  return t(key, vars)
    .split("**")
    .map((part, i) => (i % 2 ? createElement("b", { key: i }, part) : part));
}

/** `t` for a key built at runtime (a stage number, an item id): falls back to `fallback` when it's unknown. */
export function tk(key: string, fallback: string, vars?: Vars): string {
  const locale = getLocale();
  const tpl = lookup(key, vars, locale);
  return tpl === undefined ? fill(fallback, fmtVars(vars, locale)) : fill(tpl, fmtVars(vars, locale));
}

/**
 * Make some string fields of a data object read their text from the catalog, so a table of games or items
 * written in English shows in the active language wherever it's read. `prefix.field` is the key; the
 * English value stays as the fallback.
 *   localize(game, "arc.solitaire", ["title", "subtitle"])   // game.title -> t("arc.solitaire.title")
 */
export function localize<T extends object>(obj: T, prefix: string, fields: (keyof T & string)[]): T {
  for (const f of fields) {
    const fallback = obj[f];
    if (typeof fallback !== "string") continue;
    Object.defineProperty(obj, f, { get: () => tk(`${prefix}.${f}`, fallback), enumerable: true, configurable: true });
  }
  return obj;
}

/** Say a `Say` (a key and values from the engine or server) in the active language; `fallback` if unknown. */
export function tSay(s: Say | undefined | null, fallback = ""): string {
  if (!s) return fallback;
  const locale = getLocale();
  const one = (x: SayVar): string | number => (Array.isArray(x) ? list(x.map((y) => String(one(y)))) : typeof x === "object" ? tSay(x) : x);
  const vars: Record<string, string | number> = {};
  for (const [k, x] of Object.entries(s.v ?? {})) vars[k] = one(x);
  const tpl = lookup(s.k, vars, locale);
  if (tpl === undefined) return fallback || s.k;
  return fill(tpl, fmtVars(vars, locale));
}

// ------------------------------------------------------------------ English back to its template
// Text a package made in English and sent as plain text (reward lines, errors, rank labels) is matched
// back to its template in the package catalogs, then said in the active language. Unknown text is shown
// as it came. Values whose name is in TRANSLATED are themselves matched (a stage name in "Cleared {stage}").

const TRANSLATED = new Set(["stage", "rank", "title", "goal", "game", "card", "cards", "role", "why", "tier", "season", "style", "color", "msg", "deal", "label"]);

interface Template {
  key: string;
  re: RegExp;
  names: string[];
  literal: number;
}
let exact: Map<string, string> | null = null;
let templates: Template[] = [];

function build() {
  exact = new Map();
  templates = [];
  for (const key of packageKeys) {
    const tpl = (en as Record<string, string>)[key];
    const names: string[] = [];
    const src = tpl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\{(\w+)\\\}/g, (_m, n: string) => {
      names.push(n);
      return "(.+?)";
    });
    if (!names.length) {
      if (!exact.has(tpl)) exact.set(tpl, key);
      continue;
    }
    const literal = tpl.replace(/\{\w+\}/g, "").length;
    if (literal < 4) continue; // too loose to match back safely ("{tier} {roman}")
    templates.push({ key, re: new RegExp(`^${src}$`), names, literal });
  }
  templates.sort((a, b) => b.literal - a.literal);
}

const enCache = new Map<string, string>();

/** One piece of package English in `locale`, or undefined when it matches no template. */
function matchEn(text: string, locale: Locale): string | undefined {
  if (!exact) build();
  const k = exact!.get(text);
  if (k) return lookup(k, undefined, locale);
  for (const tp of templates) {
    const m = tp.re.exec(text);
    if (!m) continue;
    const vars: Record<string, string> = {};
    tp.names.forEach((n, i) => (vars[n] = TRANSLATED.has(n) ? tEn(m[i + 1]) : m[i + 1]));
    return fill(CATALOGS[locale][tp.key] ?? (en as Record<string, string>)[tp.key], vars);
  }
  return undefined;
}

/** English from a package, in the active language (as it came when it can't be matched). */
export function tEn(text: string | null | undefined): string {
  if (!text) return text ?? "";
  const locale = getLocale();
  if (locale === "en") return text;
  const ck = locale + "\u0000" + text;
  const hit = enCache.get(ck);
  if (hit !== undefined) return hit;
  // a list of things ("Score 4, Fixer") when every item is one we know
  let out: string | undefined;
  if (text.includes(", ")) {
    const parts = text.split(", ").map((p) => matchEn(p, locale));
    if (parts.every((p) => p !== undefined)) out = parts.join(", ");
  }
  out ??= matchEn(text, locale) ?? text;
  if (enCache.size > 2000) enCache.clear();
  enCache.set(ck, out);
  return out;
}

// ------------------------------------------------------------------ formatting

const nfCache = new Map<string, Intl.NumberFormat>();
/** A number in the active language (1,234 / 1.234). */
export function num(n: number, locale: Locale = getLocale(), opts?: Intl.NumberFormatOptions): string {
  const k = locale + JSON.stringify(opts ?? {});
  let f = nfCache.get(k);
  if (!f) nfCache.set(k, (f = new Intl.NumberFormat(locale, opts)));
  return f.format(n);
}

/** A date in the active language. */
export function date(at: number | Date, opts?: Intl.DateTimeFormatOptions): string {
  return new Date(at).toLocaleDateString(getLocale(), opts);
}

/** A time of day in the active language. */
export function time(at: number | Date, opts: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" }): string {
  return new Date(at).toLocaleTimeString(getLocale(), opts);
}

/** A place in a finish: "1st", "2nd" / "1º", "2º". */
export function ordinal(n: number): string {
  if (getLocale() === "pt-BR") return `${n}º`;
  const ten = n % 100;
  const s = ten >= 11 && ten <= 13 ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
  return `${n}${s}`;
}

/** "a, b and c" / "a, b e c". */
export function list(items: string[]): string {
  try {
    return new Intl.ListFormat(getLocale(), { style: "long", type: "conjunction" }).format(items);
  } catch {
    return items.join(", ");
  }
}
