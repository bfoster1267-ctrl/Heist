// Tiny synthesized sound kit (no audio files): card flicks, chip clacks, stings.
import type { GameEvent } from "@heist/engine";

let ctx: AudioContext | null = null;
let muted = false;
try {
  muted = localStorage.getItem("heist.muted") === "1";
} catch {
  /* storage blocked */
}

export const isMuted = () => muted;
export function setMuted(m: boolean) {
  muted = m;
  try {
    localStorage.setItem("heist.muted", m ? "1" : "0");
  } catch {
    /* storage blocked */
  }
}

function ac(): AudioContext | null {
  if (muted) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function noise(dur: number, freq: number, gain = 0.25, delay = 0) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime + delay;
  const buf = a.createBuffer(1, Math.ceil(a.sampleRate * dur), a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 3;
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.value = freq;
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(a.destination);
  src.start(t);
}

function tone(freq: number, dur: number, delay = 0, type: OscillatorType = "triangle", gain = 0.12) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime + delay;
  const o = a.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  const g = a.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
}

export const card = () => noise(0.08, 2400, 0.35);
export const chip = () => {
  noise(0.04, 5200, 0.3);
  noise(0.04, 4600, 0.25, 0.06);
};
export const click = () => noise(0.03, 3000, 0.15);

export function sfx(ev: GameEvent) {
  switch (ev.t) {
    case "draw":
    case "bank":
    case "discard":
    case "facedown":
    case "cut":
      return card();
    case "hire":
    case "loot":
    case "bet":
    case "betPaid":
      return chip();
    case "send":
    case "penReturn":
      return click();
    case "turn":
      return tone(660, 0.18, 0, "sine", 0.08);
    case "flip":
      card();
      return tone(392, 0.25, 0.05);
    case "reveal":
      card();
      return noise(0.12, 900, 0.3, 0.05);
    case "doubleCross":
    case "hacked":
      tone(311, 0.25);
      return tone(233, 0.4, 0.18);
    case "result":
    case "bustResult":
      tone(523, 0.18);
      tone(659, 0.18, 0.1);
      return tone(784, 0.35, 0.2);
    case "foothold":
      return tone(880, 0.25, 0, "sine", 0.1);
    case "lastCall":
      tone(440, 0.3);
      return tone(440, 0.5, 0.35);
    case "gameOver":
      [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.4, i * 0.12));
      return;
  }
}
