// The table is drawn on a fixed canvas that scales to the window, like a poker client.
// Two canvases: "desk" (16:10, laptops and tablets) and "wide" (phones held sideways and very wide
// windows), which is shorter so everything draws about a third bigger on a phone.
import { useLayoutEffect, useState } from "react";
import { safeInsets } from "../appShell";
import { turnInsets, viewport } from "../turn";

export type LayoutName = "desk" | "wide";

export interface Layout {
  name: LayoutName;
  W: number;
  H: number;
  /** Opponent seat centers, going left around the table from you, by opponent count. */
  opp: Record<number, [number, number][]>;
  human: [number, number];
}

export const LAYOUTS: Record<LayoutName, Layout> = {
  desk: {
    name: "desk",
    W: 1280,
    H: 800,
    opp: {
      2: [[245, 200], [1035, 200]],
      3: [[185, 330], [640, 112], [1095, 330]],
      4: [[180, 395], [385, 125], [895, 125], [1100, 395]],
      5: [[165, 410], [235, 175], [640, 100], [1045, 175], [1115, 410]],
    },
    human: [640, 548],
  },
  wide: {
    name: "wide",
    W: 1280,
    H: 600,
    opp: {
      // low enough that their face-down cards clear the top bar and its buttons
      2: [[300, 172], [980, 172]],
      3: [[200, 225], [640, 82], [1080, 225]],
      // 5 and 6 players: the top seats sit between the two halves of the top bar, the right-hand
      // seat tucks under the buttons, and everything below it is left for the decision panel
      4: [[140, 230], [420, 95], [760, 95], [1150, 155]],
      5: [[130, 332], [130, 150], [420, 95], [760, 95], [1150, 155]],
    },
    human: [175, 515],
  },
};

export function seatPos(L: Layout, seat: number, n: number, human: number): [number, number] {
  if (seat === human) return L.human;
  const i = (seat - human + n) % n; // 1..n-1
  return L.opp[n - 1][i - 1];
}

/** How a seat grows when the text size makes it bigger: away from the nearest canvas edge, and less
 *  for a seat in the middle, which has the top bar, the job or your hand right next to it. */
export function seatGrow(L: Layout, [x, y]: [number, number], n: number): React.CSSProperties {
  const h = x < L.W * 0.25 ? "left" : x > L.W * 0.75 ? "right" : "center";
  const v = y < L.H * 0.3 ? "top" : y > L.H * 0.7 ? "bottom" : "center";
  // at 5 and 6 players the seats sit shoulder to shoulder, so none of them can grow much
  const max = n >= 5 ? (L.name === "wide" ? 1 : 1.08) : h === "center" ? 1.1 : undefined;
  return { transformOrigin: `${h} ${v}`, ...(max ? { "--seat-max": max } : {}) } as React.CSSProperties;
}

/** Pick the canvas for the window shape and the scale that fits it. */
export function useLayout() {
  // Fit inside the safe area so nothing sits under the notch or the home bar.
  const pick = () => {
    const ins = turnInsets(safeInsets()), vp = viewport();
    const w = vp.w - ins.left - ins.right, h = vp.h - ins.top - ins.bottom;
    const L = w / h >= 1.85 ? LAYOUTS.wide : LAYOUTS.desk;
    return { L, scale: Math.min(w / L.W, h / L.H), dx: (ins.left - ins.right) / 2, dy: (ins.top - ins.bottom) / 2 };
  };
  const [v, setV] = useState(pick);
  useLayoutEffect(() => {
    const f = () => setV(pick());
    f();
    window.addEventListener("resize", f);
    window.addEventListener("orientationchange", f);
    // iOS reports the new insets a moment after rotating.
    const late = () => window.setTimeout(f, 300);
    window.addEventListener("orientationchange", late);
    return () => {
      window.removeEventListener("resize", f);
      window.removeEventListener("orientationchange", f);
      window.removeEventListener("orientationchange", late);
    };
  }, []);
  return v;
}

type Box = { x: number; y: number; w: number; h: number };

/** An element's box in canvas units: its layout box run through its own transforms (seats are
 *  centered with translate and grow with scale), measured from the canvas. Works the same when the
 *  whole canvas is scaled or turned for an upright phone, since nothing here reads the screen. */
function canvasBox(el: HTMLElement, canvas: HTMLElement): Box | null {
  let x = 0, y = 0;
  let n: HTMLElement | null = el;
  while (n && n !== canvas) {
    x += n.offsetLeft;
    y += n.offsetTop;
    n = n.offsetParent as HTMLElement | null;
  }
  if (!n) return null;
  const w = el.offsetWidth, h = el.offsetHeight;
  if (!w || !h) return null;
  const cs = getComputedStyle(el);
  const [sx, sy] = cs.scale && cs.scale !== "none" ? cs.scale.split(" ").map(Number) : [1, 1];
  const m = new DOMMatrix().scale(sx, sy ?? sx).multiply(new DOMMatrix(cs.transform === "none" ? undefined : cs.transform));
  const [ox, oy] = cs.transformOrigin.split(" ").map(parseFloat);
  const pts = [[0, 0], [w, 0], [0, h], [w, h]].map(([px, py]) => [x + ox + m.a * (px - ox) + m.c * (py - oy) + m.e, y + oy + m.b * (px - ox) + m.d * (py - oy) + m.f]);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

/** How tall the decision panel can be on a phone held sideways without covering a player's seat. The
 *  panel is pinned to the bottom right corner and grows upward, so it stops just under the lowest
 *  seat above it. null when there's no seat in the way (or the panel isn't pinned to the bottom). */
export function panelRoom(panel: HTMLElement, canvas: HTMLElement): number | null {
  if (!canvas.classList.contains("l-wide") || panel.classList.contains("wide")) return null;
  // its box without the slide-in transform, which would move the bottom while it settles
  let x0 = 0, top = 0;
  for (let n: HTMLElement | null = panel; n && n !== canvas; n = n.offsetParent as HTMLElement | null) {
    if (!n.offsetParent) return null;
    x0 += n.offsetLeft;
    top += n.offsetTop;
  }
  const x1 = x0 + panel.offsetWidth, bottom = top + panel.offsetHeight;
  let under = -1;
  canvas.querySelectorAll<HTMLElement>(".seat").forEach((s) => {
    const b = canvasBox(s, canvas);
    if (!b || b.x + b.w <= x0 || b.x >= x1 || b.y + b.h >= bottom) return;
    under = Math.max(under, b.y + b.h);
  });
  // never squeeze it below a usable size: a short scroll beats buttons nobody can reach
  return under < 0 ? null : Math.max(150, bottom - under - 10);
}

const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/** What the flipped Job card must not cover, and how much each one matters. Seats come first:
 *  you read them to pick the Mark. */
const KEEP_CLEAR: [string, number][] = [
  [".seat", 20],
  [".action-panel:not([data-leaving])", 4],
  ['[data-anchor="my-hand"]', 3],
  [".topbar", 3],
  [".ticker", 1],
  [".pen", 0.5],
  [".deck", 0.3],
  [".discard", 0.3],
  [".pot", 0.2],
];

export interface Spot {
  left: number;
  top: number;
  scale: number;
}

/** Where the flipped Job card goes: as near the middle of the felt as it can be without covering a
 *  player's seat (or, failing that, as little of one as possible), shrinking a little if it must.
 *  `el` is the card's wrapper; its size is read without any transform. */
export function clearSpot(el: HTMLElement, canvas: HTMLElement, L: Layout): Spot {
  const w = el.offsetWidth, h = el.offsetHeight;
  // the old fixed spot: the card's top a little above the middle of the felt
  const home = { cx: L.W / 2, top: L.name === "wide" ? 120 : 190 };
  const keep: [Box, number][] = [];
  for (const [sel, weight] of KEEP_CLEAR)
    canvas.querySelectorAll<HTMLElement>(sel).forEach((o) => {
      if (o === el || el.contains(o)) return;
      const b = canvasBox(o, canvas);
      if (b) keep.push([b, weight]);
    });
  let best: Spot & { cost: number } = { left: home.cx - w / 2, top: home.top, scale: 1, cost: Infinity };
  for (const scale of [1, 0.88, 0.76, 0.64])
    for (let dy = -80; dy <= 240; dy += 10)
      for (const dx of [0, -40, 40, -80, 80, -130, 130, -180, 180, -240, 240]) {
        const sw = w * scale, sh = h * scale;
        const box = { x: home.cx + dx - sw / 2, y: home.top + dy + (h - sh) / 2, w: sw, h: sh };
        if (box.x < 4 || box.y < 4 || box.x + box.w > L.W - 4 || box.y + box.h > L.H - 4) continue;
        let cost = 0;
        for (const [b, weight] of keep) cost += overlap(box, b) * weight;
        // a gentle pull toward the middle and toward full size breaks ties
        cost += Math.abs(dx) * 2 + Math.abs(dy) * 3 + (1 - scale) * 4000;
        if (cost < best.cost) best = { left: box.x - (w - sw) / 2, top: home.top + dy, scale, cost };
      }
  return { left: best.left, top: best.top, scale: best.scale };
}
