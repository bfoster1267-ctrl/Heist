// Play-money chips. No real money goes in or comes out; chips only buy into tables.
// Local for now; moves to the player's account when accounts land.
const KEY = "heist.chips";
export const START_CHIPS = 10000;
export const REFILL_TO = 2500;

export function loadChips(): number {
  try {
    const v = Number(localStorage.getItem(KEY));
    return Number.isFinite(v) && v > 0 ? v : START_CHIPS;
  } catch {
    return START_CHIPS;
  }
}

export function saveChips(v: number) {
  try {
    localStorage.setItem(KEY, String(v));
  } catch {
    /* storage blocked: chips last for this visit only */
  }
}

export const STAKES = [
  { buyIn: 250, name: "Back Alley" },
  { buyIn: 1000, name: "Speakeasy" },
  { buyIn: 5000, name: "High Roller" },
  { buyIn: 25000, name: "The Vault" },
];
