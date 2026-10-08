"""Home-screen icons and iPhone launch screens for the installable app.

Run from apps/web:  python3 scripts/make_icons.py
Writes public/icons/*.png and public/splash/*.png, and prints the <link> tags for index.html.
Look matches the printed Job card back: dark striped card, gold keyhole in a ring, HEIST in Bebas.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent.parent
BEBAS = HERE / "src/fonts/BebasNeue-Regular.ttf"
BG = (23, 26, 32)
STRIPE = (31, 35, 43)
GOLD = (231, 181, 60)
PAPER = (242, 232, 211)


def stripes(img, step):
    d = ImageDraw.Draw(img)
    w, h = img.size
    for x in range(-h, w, step):
        d.line([(x, h), (x + h, 0)], fill=STRIPE, width=max(1, step // 4))


def keyhole(d, cx, cy, r, ring=True):
    if ring:
        d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=GOLD, width=max(2, int(r * 0.11)))
    hr = r * 0.29
    hy = cy - r * 0.19
    d.ellipse([cx - hr, hy - hr, cx + hr, hy + hr], fill=GOLD)
    d.polygon([(cx - r * 0.15, hy + hr * 0.4), (cx + r * 0.15, hy + hr * 0.4), (cx + r * 0.24, cy + r * 0.52), (cx - r * 0.24, cy + r * 0.52)], fill=GOLD)


def font(px):
    return ImageFont.truetype(str(BEBAS), px)


def icon(size, pad=0.0, word=True):
    img = Image.new("RGB", (size, size), BG)
    stripes(img, max(6, size // 28))
    d = ImageDraw.Draw(img)
    inner = size * (1 - 2 * pad)
    cx = size / 2
    if word:
        r = inner * 0.27
        cy = size / 2 - inner * 0.1
        keyhole(d, cx, cy, r)
        f = font(int(inner * 0.24))
        d.text((cx, cy + r + inner * 0.04), "HEIST", font=f, fill=PAPER, anchor="mt")
    else:
        keyhole(d, cx, size / 2, inner * 0.36)
    return img


def splash(w, h):
    img = Image.new("RGB", (w, h), BG)
    stripes(img, max(12, min(w, h) // 40))
    d = ImageDraw.Draw(img)
    s = min(w, h)
    r = s * 0.16
    cy = h / 2 - s * 0.08
    keyhole(d, w / 2, cy, r)
    d.text((w / 2, cy + r + s * 0.05), "HEIST", font=font(int(s * 0.16)), fill=PAPER, anchor="mt")
    return img


# iPhones: CSS width x height and pixel ratio. Launch images must match the screen exactly.
PHONES = [
    (440, 956, 3), (402, 874, 3), (430, 932, 3), (393, 852, 3), (428, 926, 3), (390, 844, 3),
    (375, 812, 3), (414, 896, 3), (414, 896, 2), (414, 736, 3), (375, 667, 2),
]

if __name__ == "__main__":
    out = HERE / "public"
    icon(180).save(out / "icons/apple-touch-icon.png", optimize=True)
    icon(192).save(out / "icons/icon-192.png", optimize=True)
    icon(512).save(out / "icons/icon-512.png", optimize=True)
    icon(512, pad=0.1).save(out / "icons/icon-maskable-512.png", optimize=True)
    icon(64, word=False).save(out / "icons/favicon-64.png", optimize=True)
    tags = []
    for w, h, r in PHONES:
        for orient, (pw, ph) in (("portrait", (w * r, h * r)), ("landscape", (h * r, w * r))):
            name = f"splash-{pw}x{ph}.png"
            splash(pw, ph).quantize(64).save(out / "splash" / name, optimize=True)
            tags.append(
                f'<link rel="apple-touch-startup-image" href="./splash/{name}" media="(device-width: {w}px) and (device-height: {h}px) and (-webkit-device-pixel-ratio: {r}) and (orientation: {orient})" />'
            )
    print("\n".join(tags))
