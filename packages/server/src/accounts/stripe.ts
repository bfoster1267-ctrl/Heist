// Stripe webhooks: check that a call really came from Stripe (the Stripe-Signature header), the same way
// Stripe's own libraries do, without pulling in the whole Stripe SDK.

import { createHmac, timingSafeEqual } from "node:crypto";

/** how old a signed call may be before it's refused as a replay */
const TOLERANCE_S = 300;

/** True when `header` is Stripe's signature of `raw` with `secret` (whsec_...), made within the last 5 minutes. */
export function stripeSigned(raw: Buffer, header: string | undefined, secret: string, nowMs: number): boolean {
  if (!header) return false;
  const parts = header.split(",").map((p) => p.split("=", 2) as [string, string]);
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  if (!Number.isFinite(t) || Math.abs(nowMs / 1000 - t) > TOLERANCE_S) return false;
  const want = createHmac("sha256", secret).update(`${t}.`).update(raw).digest();
  return parts.some(([k, v]) => {
    if (k !== "v1" || !/^[0-9a-f]{64}$/.test(v)) return false;
    return timingSafeEqual(want, Buffer.from(v, "hex"));
  });
}

/** The parts of a Checkout Session the server reads. */
export interface StripeSession {
  id: string;
  client_reference_id?: string | null;
  payment_status?: string;
  amount_total?: number | null;
  currency?: string | null;
}

/** Fetch a Checkout Session with the server's key (STRIPE_SECRET_KEY). */
export async function fetchSession(id: string, key: string): Promise<StripeSession> {
  const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`Stripe ${res.status}`);
  return (await res.json()) as StripeSession;
}
