"""Blender frames -> sprite strips for the web app (apps/web/public/3d/)."""
import glob, json, os, sys
from PIL import Image
S, OUT, KIND = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(OUT, exist_ok=True)
meta = {}
def strip(frames, h, name):
    box = None
    for f in frames:
        b = f.getchannel("A").point(lambda a: 255 if a > 6 else 0).getbbox()
        box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
    fr = [f.crop(box) for f in frames]
    w = round(fr[0].width * h / fr[0].height)
    fr = [f.resize((w, h), Image.LANCZOS) for f in fr]
    sheet = Image.new("RGBA", (w * len(fr), h))
    for i, f in enumerate(fr): sheet.paste(f, (i * w, 0))
    sheet.save(f"{OUT}/{name}.webp", quality=88, method=6)
    fr[-1].save(f"{OUT}/{name}-still.webp", quality=88, method=6)
    meta[name] = {"frames": len(fr), "w": w, "h": h}
if KIND == "drink":
    # the settle: from the frame the slide stops (anim.py: 55% of 40) to the end
    for d in sys.argv[4:] or ["vault", "whiskey", "wine", "martini", "beer"]:
        fs = [f for f in sorted(glob.glob(f"{S}/frames/drink-{d}/*.png")) if int(os.path.basename(f)[:4]) >= 22]
        strip([Image.open(f).convert("RGBA") for f in fs], 112, f"drink-{d}")
else:
    for c in ["legendary", "red", "blue", "black", "green", "purple"]:
        fs = sorted(glob.glob(f"{S}/frames/spin-{c}/*.png"))
        strip([Image.open(f).convert("RGBA") for f in fs], 64, f"chip-{c}")
print(json.dumps(meta))
