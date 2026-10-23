// What real money buys. The web shop shows these and links to their Stripe Payment Links; the server credits
// them only when Stripe's webhook says the payment went through, and only for the price listed here.

export interface Purchase {
  id: string;
  /** what Stripe must have charged, in US cents */
  cents: number;
  coins?: number;
  chips?: number;
  /** the VIP Founder Pass */
  vip?: boolean;
}

export const PURCHASES: Purchase[] = [
  { id: "vip", cents: 499, vip: true },
  { id: "starter", cents: 199, coins: 2500, chips: 5000 },
  { id: "highroller", cents: 499, coins: 7500, chips: 20000 },
  { id: "vault", cents: 999, coins: 20000, chips: 60000 },
  { id: "kingpin", cents: 1999, coins: 50000, chips: 160000 },
  { id: "syndicate", cents: 4999, coins: 140000, chips: 500000 },
  { id: "godfather", cents: 9999, coins: 350000, chips: 1500000 },
];

export const purchase = (id: string) => PURCHASES.find((p) => p.id === id);

/**
 * Stripe carries "which purchase, for whom" in the Payment Link's client_reference_id (letters, digits, - and _
 * only): "<purchase>-<account id>". Purchase ids have no dash, so the first one splits it.
 */
export const purchaseRef = (purchaseId: string, accountId: string) => `${purchaseId}-${accountId}`;
export function readPurchaseRef(ref: unknown): { purchase: Purchase; accountId: string } | null {
  if (typeof ref !== "string") return null;
  const i = ref.indexOf("-");
  const p = i > 0 ? purchase(ref.slice(0, i)) : undefined;
  const accountId = ref.slice(i + 1);
  return p && /^u_[\w-]{4,40}$/.test(accountId) ? { purchase: p, accountId } : null;
}
