import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class MockStorage implements Storage {
  private data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  clear() {
    this.data.clear();
  }
  getItem(key: string) {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, String(value));
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  key(index: number) {
    return Array.from(this.data.keys())[index] ?? null;
  }
}

// Polyfill window and localStorage for the test runner environment
const mockStorage = new MockStorage();
if (typeof globalThis.window === "undefined") {
  (globalThis as unknown as { window: unknown }).window = {
    location: new URL("https://playheist.net/"),
    history: { replaceState: () => {} },
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}
if (typeof globalThis.localStorage === "undefined") {
  (globalThis as unknown as { localStorage: unknown }).localStorage = mockStorage;
}

import { checkStripeProReturn, getHeistProSession, isHeistPro, onProChange, setHeistPro } from "./pro";

describe("pro.ts (VIP Founder Pass state and Stripe return)", () => {
  beforeEach(() => {
    mockStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    mockStorage.clear();
  });

  it("defaults to false when no pass is stored", () => {
    expect(isHeistPro()).toBe(false);
    expect(getHeistProSession()).toBeNull();
  });

  it("activates VIP status and stores session ID when setHeistPro(true, session) is called", () => {
    const changed = vi.fn();
    const unsub = onProChange(changed);

    const saved = setHeistPro(true, "cs_test_1234567890abcdef1234");
    expect(saved).toBe(true);
    expect(isHeistPro()).toBe(true);
    expect(getHeistProSession()).toBe("cs_test_1234567890abcdef1234");
    expect(changed).toHaveBeenCalledTimes(1);

    unsub();
  });

  it("clears VIP status and session ID when setHeistPro(false) is called", () => {
    setHeistPro(true, "cs_test_1234567890abcdef1234");
    expect(isHeistPro()).toBe(true);

    const changed = vi.fn();
    const unsub = onProChange(changed);

    setHeistPro(false);
    expect(isHeistPro()).toBe(false);
    expect(getHeistProSession()).toBeNull();
    expect(changed).toHaveBeenCalledTimes(1);

    unsub();
  });

  it("handles storage write errors gracefully in setHeistPro", () => {
    const setItemSpy = vi.spyOn(mockStorage, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceeded / Private browsing restriction");
    });

    const result = setHeistPro(true, "cs_test_1234567890abcdef1234");
    expect(result).toBe(false);
    expect(isHeistPro()).toBe(false);

    setItemSpy.mockRestore();
  });

  it("checkStripeProReturn activates and cleans URL on valid Stripe session_id", () => {
    const sessionId = "cs_live_abcdef1234567890abcdef";
    const replaceStateSpy = vi.fn();
    window.history.replaceState = replaceStateSpy;

    (window as unknown as { location: unknown }).location = new URL(`https://playheist.net/?session_id=${sessionId}&pro=success#rewards`);

    const activated = checkStripeProReturn();
    expect(activated).toBe(true);
    expect(isHeistPro()).toBe(true);
    expect(getHeistProSession()).toBe(sessionId);
    expect(replaceStateSpy).toHaveBeenCalledWith({}, "", "/#rewards");
  });

  it("checkStripeProReturn ignores arbitrary strings and unverified query flags without session_id", () => {
    (window as unknown as { location: unknown }).location = new URL("https://playheist.net/?pro=success&vip=success");

    const activated = checkStripeProReturn();
    expect(activated).toBe(false);
    expect(isHeistPro()).toBe(false);
  });

  it("checkStripeProReturn rejects invalid session_id formats", () => {
    (window as unknown as { location: unknown }).location = new URL("https://playheist.net/?session_id=bad_session_token_123");

    const activated = checkStripeProReturn();
    expect(activated).toBe(false);
    expect(isHeistPro()).toBe(false);
  });
});
