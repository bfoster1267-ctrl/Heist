// Tiny synthesized sound kit (no audio files): card flicks, chip clacks, stings.
import type { GameEvent } from "@heist/engine";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;
let volume = 0.8;
try {
  muted = localStorage.getItem("heist.muted") === "1";
  const v = Number(localStorage.getItem("heist.volume"));
  if (localStorage.getItem("heist.volume") !== null && Number.isFinite(v)) volume = Math.min(1, Math.max(0, v));
} catch {
  /* storage blocked */
}

export const getVolume = () => volume;
export function setVolume(v: number) {
  volume = v;
  if (master) master.gain.value = v;
  try {
    localStorage.setItem("heist.volume", String(v));
  } catch {
    /* storage blocked */
  }
}

// Phones only allow audio after a tap, so open the audio context on the first one.
if (typeof window !== "undefined") {
  const unlock = () => {
    ac();
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
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
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = volume;
      master.connect(ctx.destination);
    }
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
  src.connect(f).connect(g).connect(master!);
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
  o.connect(g).connect(master!);
  o.start(t);
  o.stop(t + dur + 0.05);
}

export const card = () => noise(0.08, 2400, 0.35);
export const chip = () => {
  noise(0.04, 5200, 0.3);
  noise(0.04, 4600, 0.25, 0.06);
};
export const click = () => noise(0.03, 3000, 0.15);
/** A soft pop for a chat bubble. */
export const pop = () => {
  tone(520, 0.08, 0, "sine", 0.08);
  tone(780, 0.1, 0.05, "sine", 0.06);
};
/** A riffle: a run of quick card flicks. */
export const shuffle = () => {
  for (let i = 0; i < 14; i++) noise(0.05, 2000 + (i % 3) * 500, 0.18, i * 0.035);
};
/** A stack of chips sliding across felt. */
export const chipRun = (n = 6) => {
  for (let i = 0; i < n; i++) noise(0.035, 4800 + (i % 2) * 700, 0.22, i * 0.055);
};
/** Two soft notes: it's your move. */
export const yourTurn = () => {
  tone(784, 0.16, 0, "sine", 0.1);
  tone(1175, 0.26, 0.11, "sine", 0.09);
};
/** A low hit for a dramatic moment (reveal, double-cross). */
const thump = (delay = 0) => tone(70, 0.35, delay, "sine", 0.35);
export const win = () => {
  [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.45, i * 0.1, "triangle", 0.11));
  chipRun(12);
};
export const lose = () => {
  [392, 330, 262].forEach((f, i) => tone(f, 0.45, i * 0.2, "triangle", 0.1));
};

export function sfx(ev: GameEvent, human = 0) {
  switch (ev.t) {
    case "setup":
    case "reshuffle":
      return shuffle();
    case "draw":
    case "bank":
    case "discard":
    case "facedown":
    case "cut":
    case "fence":
      return card();
    case "hire":
    case "loot":
    case "bet":
    case "betPaid":
      return chipRun(ev.t === "loot" ? 5 : 3);
    case "send":
    case "penReturn":
    case "toPen":
      return click();
    case "turn":
      return ev.seat === human ? undefined : tone(660, 0.14, 0, "sine", 0.05);
    case "flip":
      card();
      return tone(392, 0.25, 0.05);
    case "mark":
      return tone(330, 0.3, 0, "sawtooth", 0.04);
    case "reveal":
      card();
      thump(0.02);
      return noise(0.18, 700, 0.35, 0.04);
    case "doubleCross":
    case "hacked":
      thump();
      tone(311, 0.25);
      return tone(233, 0.4, 0.18);
    case "result":
    case "bustResult":
      tone(523, 0.18);
      tone(659, 0.18, 0.1);
      return tone(784, 0.35, 0.2);
    case "foothold":
      tone(98, 0.2, 0, "sine", 0.3);
      tone(880, 0.25, 0.05, "sine", 0.1);
      return tone(1320, 0.3, 0.12, "sine", 0.06);
    case "lastCall":
      tone(440, 0.3);
      return tone(440, 0.5, 0.35);
    case "gameOver":
      return ev.winners.includes(human) ? win() : lose();
  }
}
