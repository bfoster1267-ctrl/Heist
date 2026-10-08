// The table is drawn on a fixed canvas that scales to the window, like a poker client.
// Two canvases: "desk" (16:10, laptops and tablets) and "wide" (phones held sideways and very wide
// windows), which is shorter so everything draws about a third bigger on a phone.
import { useLayoutEffect, useState } from "react";
import { safeInsets } from "../appShell";

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
      2: [[300, 150], [980, 150]],
      3: [[200, 225], [640, 82], [1080, 225]],
      4: [[175, 250], [415, 80], [865, 80], [1105, 250]],
      5: [[150, 300], [300, 92], [640, 82], [980, 92], [1130, 300]],
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
export function seatGrow(L: Layout, [x, y]: [number, number]): React.CSSProperties {
  const h = x < L.W * 0.25 ? "left" : x > L.W * 0.75 ? "right" : "center";
  const v = y < L.H * 0.3 ? "top" : y > L.H * 0.7 ? "bottom" : "center";
  return { transformOrigin: `${h} ${v}`, ...(h === "center" ? { "--seat-max": 1.1 } : {}) } as React.CSSProperties;
}

/** Pick the canvas for the window shape and the scale that fits it. */
export function useLayout() {
  // Fit inside the safe area so nothing sits under the notch or the home bar.
  const pick = () => {
    const ins = safeInsets();
    const w = window.innerWidth - ins.left - ins.right, h = window.innerHeight - ins.top - ins.bottom;
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
