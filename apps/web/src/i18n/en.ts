// The English source catalog: the engine's and profile's English, plus every area of the web app
// (i18n/areas/*). pt-BR.ts must have every key here; TypeScript checks it.
import { ENGINE_TEXT } from "@heist/engine";
import { PROFILE_TEXT } from "@heist/profile";
import { AREAS } from "./areas";

type Merge<U> = (U extends unknown ? (x: U) => void : never) extends (x: infer I) => void ? I : never;
type AreaEn = Merge<(typeof AREAS)[number]["en"]>;

export const en = Object.assign({}, ENGINE_TEXT, PROFILE_TEXT, ...AREAS.map((a) => a.en)) as typeof ENGINE_TEXT & typeof PROFILE_TEXT & AreaEn;

/** Keys whose English a package makes; tEn() matches English text back to these. */
export const packageKeys: string[] = [...Object.keys(ENGINE_TEXT), ...Object.keys(PROFILE_TEXT), ...AREAS.flatMap((a) => Object.keys(a.en).filter((k) => k.startsWith("server.")))];
