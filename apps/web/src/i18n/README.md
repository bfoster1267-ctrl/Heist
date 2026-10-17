# i18n: English and Português (Brasil)

A small translation layer with no dependencies. English is the source; every key also has Brazilian
Portuguese, and TypeScript fails the build if one is missing.

## Where text lives

- `areas/*.ts`: the web app's strings, one file per area (lobby, table, daily, solo, ers...). Each entry
  holds both languages side by side:
  ```ts
  export default strings({
    "lobby.play": ["Play", "Jogar"],
    "lobby.seats": ["{n} seats", "{n} lugares"],
  });
  ```
  `areas/index.ts` lists every area in `AREAS`.
- `packages/engine/src/text.ts` (`ENGINE_TEXT`) and `packages/profile/src/text.ts` (`PROFILE_TEXT`): the
  English the packages make (game log, card and Role names, coach tips, lessons, reward lines, daily
  challenges, errors). Their Portuguese is in `packages.pt.ts`, typed against those catalogs.
- `en.ts` merges everything into the English catalog, `pt-BR.ts` into the Portuguese one
  (`Record<keyof typeof en, string>`, so a missing key is a type error).

## Adding a string

1. Add the key to the area file it belongs to (or a new area file, then add it to `AREAS`):
   `"mygame.newGame": ["New game", "Novo jogo"]`.
2. Use it: `import { t } from "../i18n";` then `{t("mygame.newGame")}`.

A new game can bring its own area file (`areas/minesweeper.ts` with `ms.*` keys). Pick a prefix no other
area uses. Shared solo-game words (Undo, Hint, New deal, "No moves left", the HUD pills) are already in
`areas/solo.ts` as `solo.*`; reuse them.

## The helpers (all from `i18n/index.ts`)

| Helper | Use |
| --- | --- |
| `t(key, vars)` | The text, `{slots}` filled. Numbers of 1000 or more get the locale's separators. |
| `tNodes(key, nodes, vars)` | When a slot is a React node: `tNodes("solo.movesL", { b: <b>{n}</b> })`. |
| `tRich(key)` | When the text marks bold with `**stars**`: `"**Doubles:** two cards..."`. |
| `tk(key, fallback, vars)` | For a key built at runtime (`` `arc.${id}.title` ``); falls back to the English given. |
| `localize(obj, prefix, fields)` | Makes fields of a data table (a list of games) read from the catalog. |
| `tSay(say)` | Says an engine or server `Say` (`{ k, v }`) in the active language. |
| `tEn(text)` | English that arrives as plain text (server errors, reward lines, duel events): matched back to its template, else shown as it came. |
| `num`, `date`, `time`, `list`, `ordinal` | Intl formatting in the active locale. |
| `useLocale()` | Re-renders a component when the language changes (the app root already calls it). |

**Plurals:** add `key_one` and `key_other`, and pass `count`:
`"x.moves_one": ["{count} move", "{count} jogada"]`, `"x.moves_other": [...]`, then `t("x.moves", { count })`.
Portuguese treats 0 as plural ("0 jogadas").

**Module-level data.** Text in a constant made when the module loads is read once, in whatever language was
active then. Use a getter (`get label() { return t("...") }`) or `localize()`. Don't spread an object with
getters (`{ ...x }`), because the spread reads them once.

**Shadowed `t`.** Code like `const t = setTimeout(...)` hides the import. Rename the local (`tm`).

## Text from the server or the packages

- The engine log, and frames that carry a `say`, are rendered with `tSay`.
- Plain-text English from the server (errors, Lounge refusals, ERS duel events, group-chat system lines) is
  passed through `tEn()`. To translate a new server line, add a key that starts with `server.` with the
  exact English as a template, e.g. `"server.ers.rematch": ["{name} wants a rematch!", "{name} quer revanche!"]`.
  A template needs at least 4 literal characters. Slots named `why`, `game`, `title`, `label`, `msg` and a few
  others (see `TRANSLATED`) are matched recursively.
- Quick-chat lines travel in English and are shown with `chatLine()` (keys `chat.<English>`).

## Choosing the language

`prefs.lang` is `"auto"` (the default: any `pt*` browser language gives pt-BR, else English), `"en"` or
`"pt-BR"`. The picker is `LanguageRow` in `table/Settings.tsx` (lobby and table settings). `<html lang>`
follows the choice. `i18n.css` gives longer Portuguese labels room only under `:lang(pt)`.

## Not translated (on purpose)

The admin panel (`src/admin`), SEO pages and server logs, analytics screen names (`trackScreen`),
player-written text (chat, posts, names), and brand/game names that stay as they are (Heist, FreeCell,
TriPeaks, Yukon, Scoundrel).

## Glossary (pt-BR)

Boss = Chefe · Mark = Alvo · crew = capangas · hideout = esconderijo · Foothold = Base · Pen = Xadrez ·
Job = Golpe · Score = Força · Fixer = Blefe · Backup = Reforço · Double-Cross = Traição · Showdown = Revelação ·
Cash = Grana · Lounge = Lounge · Ranked = Ranqueada · Wardrobe = Guarda-roupa · coins = moedas ·
chips = fichas · lobby = saguão · Arcade = Fliperama · streak = sequência · deal (a hand) = mão.
Games: Klondike = Paciência · Spider = Paciência Spider · Pyramid = Pirâmide ·
Egyptian Rat Screw = Tapa (slap = tapa/bater) · FreeCell, TriPeaks, Yukon, Scoundrel keep their names.

Tone: warm, casual Brazilian Portuguese ("você", "pra", "bora"), the way people talk at a card table,
not a literal translation.
