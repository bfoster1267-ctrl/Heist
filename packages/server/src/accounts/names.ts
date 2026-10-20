// New players who didn't pick a name get a cringe one (built in @heist/profile, shared with the bots).

import { randomInt } from "node:crypto";
import { cringeName as make } from "@heist/profile";

export { cringeNameCount } from "@heist/profile";

/** A fresh cringe name nobody has yet (taken holds names in lower case). */
export const cringeName = (taken?: Set<string>, rand: (n: number) => number = randomInt) => make(taken, rand);

/** Names a player gets without choosing one: they get a cringe name instead. */
export const STOCK_NAME = /^(ace|player|guest\b.*)?$/i;
