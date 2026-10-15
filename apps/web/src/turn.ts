// A table on a phone held upright is drawn sideways: the page turns itself 90° so the player just turns
// the phone. This is how Heist plays inside Reddit's built-in browser, which never rotates, and on an
// iPhone with rotation lock on. A browser that does rotate simply switches back to the plain landscape
// page once the phone is on its side.
//
// While turned, every CSS @media rule that asks about the window's width, height or orientation is
// re-decided for the sideways window (the browser would still answer for the upright one).

const PORTRAIT_PHONE = "(orientation: portrait) and (max-width: 760px) and (pointer: coarse)";
const SIZED = /width|height|orientation/;

const original = new WeakMap<CSSMediaRule, string>();
let on = false;

/** True while the page is drawn sideways on an upright phone. */
export function turned() {
  return on;
}

// the real window (html is pinned to it: position fixed, inset 0)
const realW = () => document.documentElement.clientWidth || window.innerWidth;
const realH = () => document.documentElement.clientHeight || window.innerHeight;

/** The window the page lays out in: the sideways one while turned. */
export function viewport() {
  return on ? { w: realH(), h: realW() } : { w: window.innerWidth, h: window.innerHeight };
}

/** Safe-area insets in the page's own directions (they come from the browser in the phone's). */
export function turnInsets(ins: { top: number; right: number; bottom: number; left: number }) {
  return on ? { top: ins.right, right: ins.bottom, bottom: ins.left, left: ins.top } : ins;
}

/** Where el sits inside root, in root's own (unturned) pixels, like a getBoundingClientRect pair would give. */
export function boxIn(el: Element, root: Element) {
  const r = el.getBoundingClientRect(), c = root.getBoundingClientRect();
  // turned 90° clockwise: the page's x runs down the screen and its y runs right to left
  if (on) return { left: r.top - c.top, top: c.right - r.right, width: r.height, height: r.width };
  return { left: r.left - c.left, top: r.top - c.top, width: r.width, height: r.height };
}

function feature(part: string, w: number, h: number): boolean {
  const m = part.trim().match(/^\(\s*(min-|max-)?(width|height|orientation)\s*:\s*([\w.]+?)(px)?\s*\)$/);
  if (!m) {
    try {
      return matchMedia(part).matches;
    } catch {
      return false;
    }
  }
  const [, mm, f, v] = m;
  if (f === "orientation") return v === (w > h ? "landscape" : "portrait");
  const size = f === "width" ? w : h, n = parseFloat(v);
  return mm === "min-" ? size >= n : mm === "max-" ? size <= n : size === n;
}

function matches(text: string, w: number, h: number) {
  return text.split(",").some((q) => q.split(/\s+and\s+/i).every((p) => feature(p, w, h)));
}

function eachMedia(f: (r: CSSMediaRule) => void) {
  const walk = (rules: CSSRuleList) => {
    for (const r of Array.from(rules)) {
      if (r instanceof CSSMediaRule) f(r);
      if ("cssRules" in r) walk((r as CSSGroupingRule).cssRules);
    }
  };
  for (const s of Array.from(document.styleSheets)) {
    try {
      walk(s.cssRules);
    } catch {
      /* another site's stylesheet: nothing of ours in it */
    }
  }
}

function applyMedia() {
  const { w, h } = viewport();
  eachMedia((r) => {
    const text = original.get(r) ?? r.media.mediaText;
    if (!SIZED.test(text)) return;
    if (!original.has(r)) original.set(r, text);
    const want = on ? (matches(text, w, h) ? "all" : "not all") : text;
    if (r.media.mediaText !== want) r.media.mediaText = want;
  });
}

function update() {
  const html = document.documentElement;
  const want = html.classList.contains("in-game") && matchMedia(PORTRAIT_PHONE).matches;
  // while turned, the PORTRAIT_PHONE rule itself is rewritten, but matchMedia still asks the real window
  if (want !== on) {
    on = want;
    html.classList.toggle("turned", on);
    window.dispatchEvent(new Event("resize"));
  }
  if (on) {
    html.style.setProperty("--turn-w", `${realH()}px`);
    html.style.setProperty("--turn-h", `${realW()}px`);
  }
  applyMedia();
}

export function installTurn() {
  update();
  matchMedia(PORTRAIT_PHONE).addEventListener("change", update);
  window.addEventListener("resize", () => on && update());
  new MutationObserver(update).observe(document.documentElement, { attributeFilter: ["class"] });
  // stylesheets that load later (a lazily loaded screen) get the same treatment
  new MutationObserver(() => on && applyMedia()).observe(document.head, { childList: true });
}
