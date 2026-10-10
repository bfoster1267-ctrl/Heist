// The table's sound kit, all synthesized (no audio files): paper cards, clay chips, wooden crew pieces, and
// short lounge-piano stings in D minor, the key of the table music. Everything runs through a small room
// reverb and a soft limiter, so a busy moment (a payout over a fanfare) never clips.
import type { GameEvent, GameState, Side } from "@heist/engine";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let dry: AudioNode | null = null;
let wet: AudioNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let muted = false;
let volume = 0.8;
try {
  muted = localStorage.getItem("heist.muted") === "1";
  const v = Number(localStorage.getItem("heist.volume"));
  if (localStorage.getItem("heist.volume") !== null && Number.isFinite(v)) volume = Math.min(1, Math.max(0, v));
} catch {
  /* storage blocked */
}

/** things that follow the sound settings (the table music) */
const watchers = new Set<() => void>();
export function onSoundChange(f: () => void) {
  watchers.add(f);
  return () => void watchers.delete(f);
}

/** the table music dips under a big sting, then comes back */
const duckers = new Set<(ms: number) => void>();
export function onDuck(f: (ms: number) => void) {
  duckers.add(f);
  return () => void duckers.delete(f);
}
const duck = (ms: number) => duckers.forEach((f) => f(ms));

export const getVolume = () => volume;
export function setVolume(v: number) {
  volume = v;
  if (master && ctx) master.gain.setTargetAtTime(v, ctx.currentTime, 0.02);
  watchers.forEach((f) => f());
  try {
    localStorage.setItem("heist.volume", String(v));
  } catch {
    /* storage blocked */
  }
}

// Phones only allow audio after a tap, so open the audio context on the first one. An iPhone also stops it
// when the screen locks or a call comes in, so every later tap wakes it again.
if (typeof window !== "undefined") {
  const wake = () => {
    if (!ctx) ac();
    else if (ctx.state !== "running" && !muted) void ctx.resume().catch(() => {});
  };
  window.addEventListener("pointerdown", wake);
  window.addEventListener("keydown", wake);
}

export const isMuted = () => muted;
export function setMuted(m: boolean) {
  muted = m;
  watchers.forEach((f) => f());
  try {
    localStorage.setItem("heist.muted", m ? "1" : "0");
  } catch {
    /* storage blocked */
  }
}

/** A small, dark room: a second and a half of decaying stereo noise that loses its top end as it fades. */
function room(a: BaseAudioContext) {
  const len = Math.ceil(a.sampleRate * 1.5);
  const buf = a.createBuffer(2, len, a.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const x = i / len;
      const k = 0.9 - 0.8 * x; // brighter early reflections, duller tail
      lp += k * (Math.random() * 2 - 1 - lp);
      d[i] = lp * (1 - x) ** 2.6 * (i < a.sampleRate * 0.008 ? i / (a.sampleRate * 0.008) : 1);
    }
  }
  return buf;
}

function ac(): AudioContext | null {
  if (muted) return null;
  try {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = volume;
      const limit = ctx.createDynamicsCompressor();
      limit.threshold.value = -12;
      limit.knee.value = 8;
      limit.ratio.value = 6;
      limit.attack.value = 0.002;
      limit.release.value = 0.2;
      master.connect(limit).connect(ctx.destination);
      dry = master;
      const verb = ctx.createConvolver();
      verb.buffer = room(ctx);
      const send = ctx.createGain();
      send.gain.value = 0.32;
      verb.connect(send).connect(master);
      wet = verb;
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state !== "running") void ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

// ---- building blocks ------------------------------------------------------------------------------------

const rnd = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);

/** An output for one voice: dry, plus `space` of it into the room, panned a little. */
function out(a: AudioContext, gain: number, space = 0.15, pan = 0) {
  const g = a.createGain();
  g.gain.value = gain;
  let head: AudioNode = g;
  if (pan && a.createStereoPanner) {
    const p = a.createStereoPanner();
    p.pan.value = pan;
    g.connect(p);
    head = p;
  }
  head.connect(dry!);
  if (space > 0) {
    const s = a.createGain();
    s.gain.value = space;
    head.connect(s).connect(wet!);
  }
  return g;
}

/** A slice of the shared noise, with its own envelope gain. */
function hiss(a: AudioContext, t: number, dur: number) {
  const src = a.createBufferSource();
  src.buffer = noiseBuf;
  src.start(t, Math.random() * 1.5, dur + 0.02);
  return src;
}

function env(g: AudioParam, t: number, peak: number, attack: number, decay: number) {
  g.setValueAtTime(0.0001, t);
  g.exponentialRampToValueAtTime(peak, t + attack);
  g.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

/** A playing card snapping down: a crisp transient, then a breath of air that falls in pitch. */
function snap(delay = 0, level = 1) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime + delay;
  const o = out(a, level * rnd(1.05, 1.35), 0.12, rnd(-0.2, 0.2));
  const crack = hiss(a, t, 0.02);
  const hp = a.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = rnd(3800, 5200);
  const g1 = a.createGain();
  env(g1.gain, t, 0.5, 0.001, 0.018);
  crack.connect(hp).connect(g1).connect(o);
  const air = hiss(a, t, 0.1);
  const bp = a.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = 1.2;
  const f0 = rnd(2600, 3400);
  bp.frequency.setValueAtTime(f0, t);
  bp.frequency.exponentialRampToValueAtTime(f0 * 0.35, t + 0.08);
  const g2 = a.createGain();
  env(g2.gain, t, 0.35, 0.004, 0.075);
  air.connect(bp).connect(g2).connect(o);
}

/** One clay chip landing on another: a click and a short ring of inharmonic partials. */
function clack(delay = 0, level = 1, pitch = 1) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime + delay;
  const o = out(a, level * rnd(0.8, 1.05), 0.18, rnd(-0.25, 0.25));
  const base = rnd(2500, 3100) * pitch;
  for (const [r, g, d] of [
    [1, 0.16, 0.035],
    [1.53, 0.1, 0.028],
    [2.41, 0.06, 0.02],
  ] as const) {
    const s = a.createOscillator();
    s.type = "sine";
    s.frequency.value = base * r * rnd(0.98, 1.02);
    const e = a.createGain();
    env(e.gain, t, g, 0.001, d * rnd(0.8, 1.3));
    s.connect(e).connect(o);
    s.start(t);
    s.stop(t + d * 1.4 + 0.05);
  }
  const click = hiss(a, t, 0.012);
  const bp = a.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = base * 1.8;
  bp.Q.value = 2;
  const e = a.createGain();
  env(e.gain, t, 0.45, 0.0008, 0.01);
  click.connect(bp).connect(e).connect(o);
}

/** A wooden crew piece set down on felt. */
function tock(delay = 0, level = 1) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime + delay;
  const o = out(a, level * rnd(0.85, 1.05), 0.12, rnd(-0.15, 0.15));
  const f = rnd(620, 760);
  const s = a.createOscillator();
  s.type = "sine";
  s.frequency.setValueAtTime(f * 1.25, t);
  s.frequency.exponentialRampToValueAtTime(f, t + 0.012);
  const e = a.createGain();
  env(e.gain, t, 0.22, 0.001, 0.06);
  s.connect(e).connect(o);
  s.start(t);
  s.stop(t + 0.1);
  const n = hiss(a, t, 0.03);
  const bp = a.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = f * 2.1;
  bp.Q.value = 4;
  const e2 = a.createGain();
  env(e2.gain, t, 0.4, 0.0008, 0.025);
  n.connect(bp).connect(e2).connect(o);
}

/** An electric piano note (two-operator FM): a bell-like attack that mellows as it rings. */
function keys(note: number, delay = 0, dur = 0.9, level = 0.1, space = 0.35) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime + delay;
  const f = midi(note);
  const o = out(a, level, space, Math.max(-0.3, Math.min(0.3, (note - 64) / 60)));
  const car = a.createOscillator();
  car.type = "sine";
  car.frequency.value = f;
  const mod = a.createOscillator();
  mod.type = "sine";
  mod.frequency.value = f;
  const idx = a.createGain();
  idx.gain.setValueAtTime(f * 1.6, t);
  idx.gain.exponentialRampToValueAtTime(f * 0.15, t + Math.min(0.5, dur));
  mod.connect(idx).connect(car.frequency);
  // the tine: a brief high partial on the attack
  const tine = a.createOscillator();
  tine.type = "sine";
  tine.frequency.value = f * 7.02;
  const tg = a.createGain();
  env(tg.gain, t, 0.12, 0.001, 0.09);
  const amp = a.createGain();
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(1, t + 0.004);
  amp.gain.exponentialRampToValueAtTime(0.35, t + 0.25);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  car.connect(amp).connect(o);
  tine.connect(tg).connect(o);
  for (const x of [car, mod, tine]) {
    x.start(t);
    x.stop(t + dur + 0.05);
  }
}

const chord = (notes: number[], delay = 0, dur = 1.2, level = 0.07, roll = 0.025) =>
  notes.forEach((n, i) => keys(n, delay + i * roll, dur, level));

/** A plucked upright bass note, with enough overtones to be heard on a phone speaker. */
function bass(note: number, delay = 0, dur = 0.7, level = 0.22) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime + delay;
  const f = midi(note);
  const o = out(a, level, 0.08);
  const s = a.createOscillator();
  s.type = "triangle";
  s.frequency.value = f;
  const s2 = a.createOscillator();
  s2.type = "sine";
  s2.frequency.value = f * 2;
  const s3 = a.createOscillator();
  s3.type = "sine";
  s3.frequency.value = f * 3;
  const g3 = a.createGain();
  g3.gain.value = 0.3;
  const lp = a.createBiquadFilter();
  lp.type = "lowpass";
  lp.Q.value = 1.5;
  lp.frequency.setValueAtTime(f * 10, t);
  lp.frequency.exponentialRampToValueAtTime(f * 3.5, t + 0.3);
  const g2 = a.createGain();
  g2.gain.value = 0.6;
  const e = a.createGain();
  env(e.gain, t, 1, 0.006, dur);
  s.connect(lp);
  s2.connect(g2).connect(lp);
  s3.connect(g3).connect(lp);
  lp.connect(e).connect(o);
  for (const x of [s, s2, s3]) {
    x.start(t);
    x.stop(t + dur + 0.1);
  }
}

/** A deep, soft hit for the big moments: a falling sine and a muffled thud. */
function boom(delay = 0, level = 0.5) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime + delay;
  const o = out(a, level, 0.25);
  const s = a.createOscillator();
  s.type = "sine";
  s.frequency.setValueAtTime(120, t);
  s.frequency.exponentialRampToValueAtTime(42, t + 0.3);
  const e = a.createGain();
  env(e.gain, t, 0.6, 0.004, 0.7);
  s.connect(e).connect(o);
  s.start(t);
  s.stop(t + 0.8);
  // the body: what a phone speaker (which drops everything under ~200 Hz) actually plays
  const k = a.createOscillator();
  k.type = "triangle";
  k.frequency.setValueAtTime(240, t);
  k.frequency.exponentialRampToValueAtTime(150, t + 0.15);
  const ke = a.createGain();
  env(ke.gain, t, 0.5, 0.003, 0.22);
  k.connect(ke).connect(o);
  k.start(t);
  k.stop(t + 0.3);
  const n = hiss(a, t, 0.12);
  const lp = a.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 900;
  const e2 = a.createGain();
  env(e2.gain, t, 0.8, 0.002, 0.1);
  n.connect(lp).connect(e2).connect(o);
}

/** A rising rush of air that cuts off: the breath before a reveal. */
function swell(delay = 0, dur = 0.6, level = 0.18) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime + delay;
  const o = out(a, level, 0.3);
  const n = hiss(a, t, dur);
  const bp = a.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = 0.9;
  bp.frequency.setValueAtTime(500, t);
  bp.frequency.exponentialRampToValueAtTime(5000, t + dur);
  const e = a.createGain();
  e.gain.setValueAtTime(0.0001, t);
  e.gain.exponentialRampToValueAtTime(1, t + dur);
  e.gain.linearRampToValueAtTime(0, t + dur + 0.015);
  n.connect(bp).connect(e).connect(o);
}

/** A jazz brush across a snare. */
function brush(delay = 0, dur = 0.3, level = 0.08) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime + delay;
  const o = out(a, level, 0.2);
  const n = hiss(a, t, dur);
  const hp = a.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 3500;
  const e = a.createGain();
  e.gain.setValueAtTime(0.0001, t);
  e.gain.exponentialRampToValueAtTime(1, t + dur * 0.4);
  e.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  n.connect(hp).connect(e).connect(o);
}

/** A struck bell, inharmonic like a real one: the bar's last-call bell. */
function bell(note: number, delay = 0, dur = 1.8, level = 0.08) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime + delay;
  const f = midi(note);
  const o = out(a, level, 0.45);
  for (const [r, g, d] of [
    [1, 1, 1],
    [2.76, 0.5, 0.6],
    [5.4, 0.25, 0.35],
    [8.93, 0.12, 0.2],
  ] as const) {
    const s = a.createOscillator();
    s.type = "sine";
    s.frequency.value = f * r;
    const e = a.createGain();
    env(e.gain, t, g, 0.002, dur * d);
    s.connect(e).connect(o);
    s.start(t);
    s.stop(t + dur * d + 0.05);
  }
}

/** A few quick computer chirps (the Hacker). */
function beeps(n: number, delay = 0, level = 0.05) {
  const a = ac();
  if (!a) return;
  for (let i = 0; i < n; i++) {
    const t = a.currentTime + delay + i * 0.07;
    const o = out(a, level, 0.1);
    const s = a.createOscillator();
    s.type = "square";
    s.frequency.value = [1760, 2349, 1976, 2637][Math.floor(Math.random() * 4)];
    const lp = a.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 4000;
    const e = a.createGain();
    e.gain.setValueAtTime(0.0001, t);
    e.gain.exponentialRampToValueAtTime(0.6, t + 0.003);
    e.gain.setValueAtTime(0.6, t + 0.04);
    e.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    s.connect(lp).connect(e).connect(o);
    s.start(t);
    s.stop(t + 0.06);
  }
}

/** A pen scratching a signature (the Forger). */
function scribble(delay = 0) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime + delay;
  const o = out(a, 0.25, 0.1);
  const n = hiss(a, t, 0.45);
  const bp = a.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 3200;
  bp.Q.value = 3;
  const e = a.createGain();
  e.gain.setValueAtTime(0.0001, t);
  for (let i = 0; i < 6; i++) {
    const s = t + i * 0.07 + rnd(0, 0.02);
    e.gain.linearRampToValueAtTime(rnd(0.4, 1), s + 0.025);
    e.gain.linearRampToValueAtTime(0.05, s + 0.06);
  }
  e.gain.linearRampToValueAtTime(0, t + 0.45);
  n.connect(bp).connect(e).connect(o);
}

// the same sound twice inside a few frames (a skip, a fast table) plays once
const last = new Map<string, number>();
function once(name: string, ms = 45) {
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  if (now - (last.get(name) ?? -1e9) < ms) return false;
  last.set(name, now);
  return true;
}

// ---- the sounds the app plays ---------------------------------------------------------------------------

export const card = (n = 1) => {
  if (!once("card")) return;
  for (let i = 0; i < Math.min(n, 3); i++) snap(i * 0.075, 1 - i * 0.15);
};
export const chip = () => {
  clack(0);
  clack(rnd(0.05, 0.07), 0.7, 0.97);
};
/** A soft tap for a button. */
export const click = () => {
  if (!once("click", 30)) return;
  tock(0, 0.55);
};
/** A soft pop for a chat bubble. */
export const pop = () => {
  const a = ac();
  if (!a || !once("pop", 80)) return;
  const t = a.currentTime;
  const o = out(a, 0.35, 0.15);
  const s = a.createOscillator();
  s.type = "sine";
  s.frequency.setValueAtTime(420, t);
  s.frequency.exponentialRampToValueAtTime(980, t + 0.06);
  const e = a.createGain();
  env(e.gain, t, 1, 0.005, 0.09);
  s.connect(e).connect(o);
  s.start(t);
  s.stop(t + 0.12);
};
/** Two glasses touching: a drink lands. */
export const clink = () => {
  bell(91, 0, 0.9, 0.05);
  bell(94, 0.07, 0.8, 0.04);
};
/** A riffle shuffle, then the deck squared on the table. */
export const shuffle = () => {
  if (!once("shuffle", 400)) return;
  for (let i = 0; i < 18; i++) snap(i * 0.028 + (i > 9 ? 0.06 : 0), 0.3 + 0.2 * Math.sin((i / 17) * Math.PI));
  tock(0.62, 0.5);
  snap(0.66, 0.6);
};
/** A stack of chips sliding across felt and settling. */
export const chipRun = (n = 6, delay = 0) => {
  if (!once("chips", 60)) return;
  let t = delay;
  for (let i = 0; i < n; i++) {
    clack(t, 0.9 - (i / n) * 0.3, 1 - i * 0.008);
    t += rnd(0.035, 0.065);
  }
  clack(t + 0.03, 0.4, 0.95);
};
/** Two soft piano notes and a bell: it's your move. */
export const yourTurn = () => {
  keys(81, 0, 0.7, 0.07);
  keys(86, 0.12, 1.2, 0.08);
  bell(98, 0.12, 0.8, 0.012);
};
export const win = () => {
  duck(2500);
  brush(0, 0.35, 0.1);
  bass(50, 0.05, 1.2, 0.2);
  [62, 66, 69, 73, 76, 78].forEach((n, i) => keys(n, 0.05 + i * 0.075, 1.8 - i * 0.1, 0.075));
  chord([62, 66, 69, 73, 76], 0.62, 2.2, 0.05, 0.012);
  bass(38, 0.62, 1.8, 0.22);
  bell(93, 0.62, 1.6, 0.03);
  chipRun(10, 0.7);
};
export const lose = () => {
  duck(2000);
  [69, 65, 62].forEach((n, i) => keys(n, i * 0.22, 0.9, 0.07));
  bass(46, 0.66, 1.4, 0.15);
  chord([58, 62, 65, 69], 0.66, 1.8, 0.035, 0.03);
};
/** The XP bar bursts into a new level. */
export const levelUp = () => {
  duck(1500);
  [69, 74, 78, 81, 86].forEach((n, i) => keys(n, i * 0.06, 1 - i * 0.08, 0.06));
  bell(93, 0.3, 1.4, 0.035);
  brush(0, 0.25, 0.06);
};

// ---- game events ----------------------------------------------------------------------------------------

/** Which side `seat` is on in the current job, if any. */
function sideOf(st: GameState | undefined, seat: number): Side | null {
  const j = st?.job;
  if (!j) return null;
  if (j.boss === seat) return "B";
  if (j.mark === seat) return "M";
  const b = j.side.B[seat] ?? 0;
  const m = j.side.M[seat] ?? 0;
  if (b && !m) return "B";
  if (m && !b) return "M";
  return null;
}

/** The end of a job: a lift if it went your way, a sag if not, a quiet close if you sat it out. */
function outcome(you: "won" | "lost" | null) {
  if (you === "won") {
    duck(1600);
    [62, 66, 69, 74].forEach((n, i) => keys(n, i * 0.07, 1.3, 0.085));
    bell(90, 0.28, 1.2, 0.025);
    brush(0, 0.25, 0.06);
  } else if (you === "lost") {
    duck(1400);
    keys(65, 0, 0.6, 0.07);
    keys(61, 0.18, 1.1, 0.07);
    bass(46, 0.18, 1, 0.13);
  } else {
    keys(69, 0, 0.5, 0.05);
    keys(74, 0.12, 0.9, 0.05);
  }
}

/** Every game event's sound. `state` is the table just after the event (it decides whose good news it is). */
export function sfx(ev: GameEvent, human = 0, state?: GameState) {
  // a tab out of sight saves its sounds (the "your move" chime still plays: see yourTurn)
  if (typeof document !== "undefined" && document.hidden) return;
  switch (ev.t) {
    case "setup":
    case "reshuffle":
      return shuffle();
    case "draw":
      return card(ev.count);
    case "bank":
      return card(ev.cardIds.length);
    case "discard":
      return card(ev.count);
    case "facedown":
    case "cut":
    case "fence":
    case "dealOffer":
    case "giveCards":
      return card();
    case "stuck":
      card(3);
      return keys(57, 0.25, 0.6, 0.04);
    case "hire":
      return chipRun(Math.min(8, 2 + ev.count));
    case "bet":
    case "bribe":
      return chipRun(3);
    case "betPaid":
      if (ev.seat === human) {
        if (ev.won) {
          chipRun(5);
          return keys(81, 0.15, 0.8, 0.05);
        }
        return keys(57, 0, 0.6, 0.05);
      }
      return ev.won ? chipRun(3) : undefined;
    case "loot":
      if (!ev.amount) return keys(57, 0, 0.5, 0.04);
      chipRun(Math.min(9, 3 + Math.round(ev.amount / 2)));
      if (ev.to === human) return keys(81, 0.25, 0.9, 0.05);
      if (ev.from === human) return bass(45, 0.05, 0.8, 0.18);
      return;
    case "send":
    case "toPen":
    case "penReturn":
      for (let i = 0; i < Math.min(3, ev.count); i++) tock(i * 0.06, 0.8 - i * 0.15);
      return;
    case "placeCrew":
      return tock(0, 0.7);
    case "turn":
      // someone else's turn: a quiet low note so you hear the table move on
      return ev.seat === human ? undefined : keys(62, 0, 0.6, 0.035, 0.25);
    case "again":
      keys(69, 0, 0.4, 0.05);
      return keys(74, 0.1, 0.7, 0.05);
    case "flip":
      snap();
      return keys(65, 0.06, 1, 0.06);
    case "mark":
      if (ev.mark === human) {
        boom(0, 0.35);
        bass(38, 0, 1.1, 0.22);
        return chord([62, 63], 0.04, 1.1, 0.05, 0);
      }
      bass(38, 0, 0.8, 0.18);
      return keys(63, 0.05, 0.9, 0.04);
    case "target":
      tock(0, 0.8);
      return bass(45, 0.02, 0.5, 0.18);
    case "wildcard":
      snap(0);
      swell(0, 0.25, 0.1);
      snap(0.25);
      return chord([66, 70, 73], 0.3, 1, 0.04);
    case "hackerCall":
      return beeps(3);
    case "hacked":
      duck(1500);
      beeps(6);
      boom(0.42, 0.4);
      return chord([62, 63, 68], 0.42, 1.2, 0.05, 0);
    case "doubleCross":
      // the betrayal sting: a hit and a sour stab, harder when it's you being flipped
      duck(1500);
      boom(0, ev.target === human ? 0.55 : 0.38);
      bass(38, 0, 1.2, 0.2);
      return chord([62, 68, 73], 0.01, 1.3, ev.target === human ? 0.07 : 0.05, 0.008);
    case "reveal":
      // timed to the showdown: the air rises, the Boss's card turns, then the Mark's, then the totals land
      duck(2400);
      swell(0, 0.68, 0.16);
      snap(0.72);
      snap(1.27);
      boom(1.3, 0.3);
      return keys(57, 1.3, 1.2, 0.05);
    case "forged":
      return scribble();
    case "backup":
      snap();
      return keys(74, 0.08, 0.7, 0.05);
    case "fixerFixer":
      chord([62, 65, 69], 0, 1.2, 0.045);
      return chord([64, 67, 71], 0.45, 1.2, 0.045);
    case "deal":
      if (ev.accepted) {
        chip();
        return chord([62, 66, 69], 0.1, 1.2, 0.045);
      }
      return bass(46, 0, 0.8, 0.2);
    case "bust":
      boom(0, 0.3);
      return tock(0.08, 0.8);
    case "result": {
      const mine = sideOf(state, human);
      return outcome(mine ? (mine === ev.winner ? "won" : "lost") : null);
    }
    case "bustResult":
      return outcome(ev.winner === human ? "won" : ev.loser === human ? "lost" : null);
    case "foothold":
      tock(0, 0.9);
      if (ev.seat === human) {
        keys(74, 0.05, 0.9, 0.06);
        return keys(81, 0.15, 1.2, 0.06);
      }
      if (ev.owner === human) {
        bass(45, 0.05, 1, 0.2);
        return keys(63, 0.08, 1, 0.05);
      }
      return keys(69, 0.05, 0.8, 0.04);
    case "lastCall":
      duck(2200);
      bell(81, 0, 1.6, 0.07);
      return bell(81, 0.45, 2, 0.07);
    case "gameOver":
      return ev.winners.includes(human) ? win() : lose();
    case "role":
    case "pass":
      return;
  }
}
