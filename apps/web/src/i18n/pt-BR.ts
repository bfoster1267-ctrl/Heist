// Brazilian Portuguese: every key in en.ts (TypeScript fails the build if one is missing).
// Tone: warm, casual Brazilian gamer/casino talk ("você", "pra", "bora"), not a literal translation.
import type { en } from "./en";
import { AREAS } from "./areas";
import { enginePt, profilePt } from "./packages.pt";

type Merge<U> = (U extends unknown ? (x: U) => void : never) extends (x: infer I) => void ? I : never;
type AreaPt = Merge<(typeof AREAS)[number]["pt"]>;

const merged = Object.assign({}, enginePt, profilePt, ...AREAS.map((a) => a.pt)) as typeof enginePt & typeof profilePt & AreaPt;

export const ptBR: Record<keyof typeof en, string> = merged;
