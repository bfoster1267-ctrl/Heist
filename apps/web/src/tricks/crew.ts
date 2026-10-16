// The crew at the card table: how each of them looks and what they say when something happens.
// Their names, roles and how boldly they play come from @heist/profile (CREW), so the server's bots match.

import { CREW } from "@heist/profile";

export interface CrewLook {
  /** the avatar's monogram and colours */
  mark: string;
  color: string;
  color2: string;
  lines: {
    /** took the Q♠ */
    queen: string[];
    /** dumped the Q♠ on someone else */
    dump: string[];
    /** shot the moon */
    moon: string[];
    /** won a big trick / made a bid */
    good: string[];
    /** got set, or took a pile of points */
    bad: string[];
    /** bid Nil */
    nil: string[];
  };
}

export const CREW_LOOK: Record<string, CrewLook> = {
  lou: {
    mark: "L",
    color: "#c8462e",
    color2: "#5e1a10",
    lines: {
      queen: ["Floor it... into a wall.", "Who parked her here?", "Ah, the lady rides with me."],
      dump: ["Shotgun's yours, pal.", "Hold on to that.", "Special delivery!"],
      moon: ["Pedal to the metal! 🌙", "Clean getaway!"],
      good: ["Smooth driving.", "Told you I'm fast.", "Easy money."],
      bad: ["Took a wrong turn.", "Engine's smoking.", "Bad road."],
      nil: ["Going Nil. Watch me.", "Nil. Zero. Ghost."],
    },
  },
  duchess: {
    mark: "D",
    color: "#8e5bd6",
    color2: "#2e1650",
    lines: {
      queen: ["How... common.", "A queen deserves better company.", "I'll remember this."],
      dump: ["Do keep her, darling.", "A gift. Don't mention it.", "Compliments of the house."],
      moon: ["All of it, naturally. 🌙", "Did you expect less?"],
      good: ["As planned.", "Mm. Delightful.", "Elementary, really."],
      bad: ["A minor setback.", "Unbecoming.", "We'll call that a feint."],
      nil: ["Nil, I think.", "I'll take nothing, thank you."],
    },
  },
  nails: {
    mark: "N",
    color: "#3e8fb0",
    color2: "#0f2f3d",
    lines: {
      queen: ["Tumblers jammed.", "Didn't hear that click coming.", "Noted."],
      dump: ["Drop. Clean.", "Out of my hands.", "Yours now."],
      moon: ["Whole vault. Every last one. 🌙", "Combination cracked."],
      good: ["Click.", "Like a lock with no pins.", "Precise."],
      bad: ["Wrong combination.", "Recalibrating.", "Hm."],
      nil: ["Nil. Silent entry.", "In and out. Nil."],
    },
  },
  ledger: {
    mark: "$",
    color: "#d9a930",
    color2: "#4a370a",
    lines: {
      queen: ["That's a write-off.", "Bad debt."],
      dump: ["Moved it off the books.", "Transferred."],
      moon: ["Every account balanced. 🌙"],
      good: ["Books are balanced, partner.", "Covered.", "In the black."],
      bad: ["We're in the red.", "That's a loss, partner.", "Audit that one."],
      nil: ["Nil. I'll keep it off the books.", "Nothing to declare. Nil."],
    },
  },
};

/** A line for a moment, picked from the moment's own count so it's steady on a re-render. */
export function crewLine(id: string, kind: keyof CrewLook["lines"], n: number): string {
  const ls = CREW_LOOK[id]?.lines[kind] ?? [];
  return ls.length ? ls[Math.abs(n) % ls.length] : "";
}

export const crewName = (id: string) => CREW[id]?.name ?? id;
