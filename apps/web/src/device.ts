// A random id for this app install, so the owner's stats can count people instead of accounts (a new
// browser or a cleared one makes a new guest). It identifies the install, not the person, and is
// never shown to other players.

const KEY = "heist.device";
let id: string | null = null;

export function deviceId(): string {
  if (id) return id;
  try {
    id = localStorage.getItem(KEY);
    if (!id || !/^[\w-]{8,40}$/.test(id)) {
      id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
      localStorage.setItem(KEY, id);
    }
  } catch {
    id ??= Math.random().toString(36).slice(2, 14).padEnd(8, "0");
  }
  return id;
}
