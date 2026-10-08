// One tooltip for the whole table. Anything with data-tip (text) or data-tip-role (a Role id) gets
// one on hover, keyboard focus, or a long press on touch. Lines split on "\n"; the first is the title.
import type { RoleId } from "@heist/engine";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { RoleCard } from "./pieces";

interface Tip {
  text?: string;
  role?: RoleId;
  x: number;
  y: number;
  below: boolean;
}

export function TooltipLayer({ canvas, scale, H }: { canvas: React.RefObject<HTMLDivElement | null>; scale: number; H: number }) {
  const [tip, setTip] = useState<Tip | null>(null);

  useEffect(() => {
    const root = canvas.current;
    if (!root) return;
    let press = 0;
    const find = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLElement>("[data-tip],[data-tip-role]") : null);
    const show = (el: HTMLElement | null) => {
      if (!el) return setTip(null);
      const r = el.getBoundingClientRect();
      const c = root.getBoundingClientRect();
      const x = (r.left + r.width / 2 - c.left) / scale;
      const top = (r.top - c.top) / scale;
      const bottom = (r.bottom - c.top) / scale;
      const below = top < H * 0.4;
      setTip({ text: el.dataset.tip, role: el.dataset.tipRole as RoleId | undefined, x, y: below ? bottom + 8 : top - 8, below });
    };
    const over = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      show(find(e.target));
    };
    const focus = (e: FocusEvent) => {
      const el = find(e.target);
      if (el && (e.target as HTMLElement).matches(":focus-visible")) show(el);
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      const el = find(e.target);
      clearTimeout(press);
      setTip(null);
      if (el) press = window.setTimeout(() => show(el), 450);
    };
    const up = () => clearTimeout(press);
    const leave = () => setTip(null);
    root.addEventListener("pointerover", over);
    root.addEventListener("pointerleave", leave);
    root.addEventListener("focusin", focus);
    root.addEventListener("focusout", leave);
    root.addEventListener("pointerdown", down);
    root.addEventListener("pointerup", up);
    root.addEventListener("pointercancel", up);
    return () => {
      root.removeEventListener("pointerover", over);
      root.removeEventListener("pointerleave", leave);
      root.removeEventListener("focusin", focus);
      root.removeEventListener("focusout", leave);
      root.removeEventListener("pointerdown", down);
      root.removeEventListener("pointerup", up);
      root.removeEventListener("pointercancel", up);
      clearTimeout(press);
    };
  }, [canvas, scale, H]);

  const lines = tip?.text?.split("\n") ?? [];
  return (
    <AnimatePresence>
      {tip && (tip.text || tip.role) && (
        <motion.div
          key={`${tip.x}-${tip.y}`}
          className={"tooltip" + (tip.below ? " below" : "")}
          role="tooltip"
          style={{ left: tip.x, top: tip.y }}
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
        >
          {tip.role ? (
            <RoleCard role={tip.role} size="sm" />
          ) : (
            <>
              {lines.length > 1 && <div className="tooltip-title">{lines[0]}</div>}
              {(lines.length > 1 ? lines.slice(1) : lines).map((l, i) => (
                <div key={i}>{l}</div>
              ))}
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
