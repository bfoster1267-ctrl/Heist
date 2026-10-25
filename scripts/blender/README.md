# Blender drinks and chips

The 3D drinks and chips in `apps/web/public/3d/` are rendered here, headless, with Blender's Python module.

```sh
uv venv -p 3.13 .bvenv && uv pip install -p .bvenv bpy     # Blender 5.2 as a pip package
# frames: drinks slide in and settle (40 frames), chips tumble (12 frames)
.bvenv/bin/python -I scripts/blender/anim.py --what drink:whiskey --out frames/drink-whiskey --size 320 --samples 32
.bvenv/bin/python -I scripts/blender/anim.py --what spin:red --out frames/spin-red --size 128 --samples 24
# frames -> sprite strips + stills (needs Pillow); prints each strip's frame size for table/sprite3d.tsx
python3 scripts/blender/sprites.py . apps/web/public/3d drink   # or: chip
```

Drinks: vault, whiskey, wine, martini, beer, coffee, champagne, toast, maitai, sake, tea, boba, milk, juice
(sprites.py takes drink names after `drink`; the game only uses frames 22-39, so `--start 22` saves time). Chips: legendary, red, blue, black, green, purple.
