"""Blender frames -> sprite strips for the web app (apps/web/public/3d/)."""
import glob, json, os, sys
from PIL import Image
S, OUT, KIND = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(OUT, exist_ok=True)
meta = {}


def bbox(frames):
    box = None
    for f in frames:
        b = f.getchannel("A").point(lambda a: 255 if a > 6 else 0).getbbox()
        box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
    return box


def strip(frames, h, name, box=None, still=True):
    fr = [f.crop(box or bbox(frames)) for f in frames]
    w = round(fr[0].width * h / fr[0].height)
    fr = [f.resize((w, h), Image.LANCZOS) for f in fr]
    sheet = Image.new("RGBA", (w * len(fr), h))
    for i, f in enumerate(fr): sheet.paste(f, (i * w, 0))
    sheet.save(f"{OUT}/{name}.webp", quality=88, method=6)
    if still: fr[-1].save(f"{OUT}/{name}-still.webp", quality=88, method=6)
    meta[name] = {"frames": len(fr), "w": w, "h": h}


def frames(d, keep=lambda n: True):
    return [Image.open(f).convert("RGBA") for f in sorted(glob.glob(f"{S}/frames/{d}/*.png")) if keep(int(os.path.basename(f)[:4]))]


if KIND == "drink":
    for d in sys.argv[4:] or ["vault", "whiskey", "wine", "martini", "beer"]:
        # the settle: from the frame the slide stops (anim.py: 55% of 40) to the end
        settle = frames(f"drink-{d}", lambda n: n >= 22)
        # the lean while it slides (anim.py --inplace), cropped the same so the swap at landing doesn't jump
        slide = frames(f"slide-{d}")
        box = bbox(settle + slide)
        strip(settle, 112, f"drink-{d}", box)
        if slide: strip(slide, 112, f"drink-{d}-slide", box, still=False)
else:
    for c in ["legendary", "red", "blue", "black", "green", "purple"]:
        strip(frames(f"spin-{c}"), 64, f"chip-{c}")
print(json.dumps(meta))
