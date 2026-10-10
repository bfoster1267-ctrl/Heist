# Run: python3 make_table_music.py && ffmpeg -i table-music.wav -c:a aac -b:a 48k ../public/table-music.m4a
# Quiet lounge loop for the Heist table (the Dynamic Island "now playing" track). Seamless 51 s loop.
import numpy as np, wave
SR = 32000
BEAT = 60 / 75          # 75 bpm
BAR = 4 * BEAT          # 3.2 s
CH = 2 * BAR            # one chord per 2 bars
prog = [  # midi notes: pad voicing, bass root
    ([50, 53, 57, 60, 64], 38),  # Dm9
    ([55, 59, 64, 65, 69], 43),  # G13
    ([48, 52, 55, 59, 62], 36),  # Cmaj9
    ([57, 61, 64, 67, 70], 45),  # A7b9
    ([50, 53, 57, 60, 64], 38),
    ([46, 50, 53, 57, 60], 34),  # Bbmaj7
    ([52, 55, 58, 62, 65], 40),  # Em7b5
    ([57, 61, 64, 67, 70], 45),
]

total = CH * len(prog)
N = int(SR * total)
out = np.zeros(N + SR * 8)
t_all = np.arange(len(out)) / SR
f = lambda m: 440 * 2 ** ((m - 69) / 12)
rng = np.random.default_rng(7)

def add(start, sig):
    i = int(start * SR)
    out[i:i + len(sig)] += sig

# pad: soft detuned sines/triangles, slow swell
for k, (notes, root) in enumerate(prog):
    dur = CH + 1.5
    t = np.arange(int(dur * SR)) / SR
    env = np.minimum(1, t / 1.2) * np.clip((dur - t) / 1.6, 0, 1)
    sig = np.zeros_like(t)
    for n in notes:
        for d in (-0.08, 0.08):
            fr = f(n) * 2 ** (d / 12)
            sig += np.sin(2 * np.pi * fr * t + rng.uniform(0, 6.28)) + 0.18 * np.sin(4 * np.pi * fr * t)
    sig *= env * (1 + 0.15 * np.sin(2 * np.pi * 0.2 * t)) / (len(notes) * 2)
    add(k * CH - 0.4 if k else 0, sig * 0.32)
    # bass: walking-ish upright, beats 1 and 3, a fifth on the second bar
    for b in range(4):
        nb = root if b % 2 == 0 else root + 7
        tb = np.arange(int(1.4 * SR)) / SR
        fb = f(nb)
        e = np.exp(-tb * 3.2) * np.minimum(1, tb / 0.008)
        s = (np.sin(2 * np.pi * fb * tb) + 0.35 * np.sin(4 * np.pi * fb * tb) + 0.1 * np.sin(6 * np.pi * fb * tb)) * e
        add(k * CH + b * 2 * BEAT, s * 0.32)
    # soft keys: a rolled chord on the "and" of 2 in each bar
    for bar in range(2):
        for j, n in enumerate(notes[1:]):
            tk = np.arange(int(2.0 * SR)) / SR
            fk = f(n + 12)
            e = np.exp(-tk * 2.4) * np.minimum(1, tk / 0.004)
            s = (np.sin(2 * np.pi * fk * tk) + 0.25 * np.sin(4 * np.pi * fk * tk)) * e
            add(k * CH + bar * BAR + 1.5 * BEAT + j * 0.03, s * 0.05)

# brushes: filtered noise swish on 2 and 4
def lp(x, a):
    y = np.zeros_like(x); acc = 0.0
    for i in range(len(x)):
        acc += a * (x[i] - acc); y[i] = acc
    return y
swish_t = np.arange(int(0.35 * SR)) / SR
swish = rng.normal(0, 1, len(swish_t))
swish = swish - lp(swish, 0.08)  # high-pass
swish *= np.sin(np.pi * swish_t / swish_t[-1]) ** 2
for b in range(int(total / BEAT)):
    if b % 2 == 1:
        add(b * BEAT - 0.05, swish * 0.018)

# fold the tail onto the start so the loop is seamless
tail = out[N:]
out = out[:N].copy()
out[:len(tail)] += tail

# vinyl crackle, very faint
cr = np.zeros(N)
idx = rng.integers(0, N, int(total * 9))
cr[idx] = rng.normal(0, 1, len(idx))
cr = cr - lp(cr, 0.3)
out += cr * 0.02

peak = np.max(np.abs(out))
out = out / peak * 10 ** (-16 / 20)   # quiet: peak -16 dBFS
pcm = (out * 32767).astype(np.int16)
w = wave.open("table-music.wav", "wb"); w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes()); w.close()
print("seconds", N / SR)
