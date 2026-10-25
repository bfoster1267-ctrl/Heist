"""Heist animated cosmetics test: chip flips and drinks sliding onto the felt.

blender-python -I anim.py --what chip:<color>|drink:<kind> --out <dir> [--frames N] [--size PX] [--samples S]
Writes <dir>/0000.png ... transparent frames.
"""
import bpy, math, sys
from mathutils import Vector


def arg(k, d=None):
    return sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d


WHAT, OUT = arg("--what"), arg("--out")
SIZE, SAMPLES, ONLY = int(arg("--size", 384)), int(arg("--samples", 40)), arg("--only")

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = "CYCLES"
sc.cycles.device = "CPU"
sc.cycles.samples = SAMPLES
sc.cycles.use_denoising = True
sc.render.film_transparent = True
sc.cycles.film_transparent_glass = True
sc.cycles.film_transparent_roughness = 0.15
sc.render.image_settings.file_format = "PNG"
sc.render.image_settings.color_mode = "RGBA"
sc.view_settings.view_transform = "AgX"
sc.view_settings.look = "AgX - Medium High Contrast"

w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True
nt = w.node_tree; bg = nt.nodes["Background"]
tc = nt.nodes.new("ShaderNodeTexCoord"); ramp = nt.nodes.new("ShaderNodeValToRGB"); sep = nt.nodes.new("ShaderNodeSeparateXYZ")
ramp.color_ramp.elements[0].color = (0.01, 0.008, 0.005, 1)
ramp.color_ramp.elements[1].color = (0.9, 0.75, 0.5, 1)
nt.links.new(tc.outputs["Generated"], sep.inputs[0]); nt.links.new(sep.outputs["Z"], ramp.inputs[0])
nt.links.new(ramp.outputs[0], bg.inputs[0]); bg.inputs[1].default_value = 0.6


def srgb(h):
    h = h.lstrip("#"); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c)


def mat(name, color, metal=0.0, rough=0.4, coat=0.0, trans=0.0, ior=1.45, emit=None, emit_s=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    p = m.node_tree.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = (*(srgb(color) if isinstance(color, str) else color), 1)
    p.inputs["Metallic"].default_value = metal
    p.inputs["Roughness"].default_value = rough
    p.inputs["Coat Weight"].default_value = coat
    p.inputs["Transmission Weight"].default_value = trans
    p.inputs["IOR"].default_value = ior
    if emit:
        p.inputs["Emission Color"].default_value = (*srgb(emit), 1)
        p.inputs["Emission Strength"].default_value = emit_s
    return m


def put(obj, m):
    obj.data.materials.append(m); return obj


def smooth(obj, bevel=0.0, seg=3):
    if bevel:
        b = obj.modifiers.new("b", "BEVEL"); b.width = bevel; b.segments = seg; b.limit_method = "ANGLE"
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True); bpy.ops.object.shade_smooth_by_angle(); obj.select_set(False)


def light(loc, energy, size=2, color=(1, 1, 1), tgt=(0, 0, 0.5)):
    d = bpy.data.lights.new("l" + str(loc), "AREA"); d.energy = energy; d.color = color; d.size = size
    o = bpy.data.objects.new(d.name, d); sc.collection.objects.link(o); o.location = loc
    o.rotation_euler = (Vector(tgt) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()


def camera(loc, target, lens=70):
    c = bpy.data.cameras.new("cam"); c.lens = lens
    o = bpy.data.objects.new("cam", c); sc.collection.objects.link(o); sc.camera = o
    o.location = loc; o.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()


def parent_all(objs, name):
    root = bpy.data.objects.new(name, None); sc.collection.objects.link(root)
    for p in objs:
        if p.parent is None: p.parent = root
    return root


def lathe(name, prof, m, steps=96, sub=True):
    me = bpy.data.meshes.new(name)
    me.from_pydata([(x, 0, z) for x, z in prof], [(i, i + 1) for i in range(len(prof) - 1)], [])
    o = bpy.data.objects.new(name, me); sc.collection.objects.link(o)
    s = o.modifiers.new("s", "SCREW"); s.steps = s.render_steps = steps; s.use_merge_vertices = True
    if sub: o.modifiers.new("sub", "SUBSURF").levels = 1
    bpy.context.view_layer.objects.active = o; o.select_set(True)
    bpy.ops.object.convert(target="MESH")
    bpy.ops.object.mode_set(mode="EDIT"); bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.normals_make_consistent(inside=False); bpy.ops.object.mode_set(mode="OBJECT"); o.select_set(False)
    put(o, m); smooth(o)
    return o


GOLD = mat("gold", "#e7b53c", metal=1, rough=0.18)
GOLD_DARK = mat("golddark", "#9a6a12", metal=1, rough=0.3)
try:
    FONT = bpy.data.fonts.load("/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf")
except Exception:
    FONT = None

# the table chips' colors (apps/web/src/table/pieces.tsx) plus the legendary black-and-gold
CHIPS = {
    "red": ("#c8372d", "#f3ece0"), "blue": ("#2f78c4", "#f3ece0"), "black": ("#1d1f24", "#f3ece0"),
    "green": ("#3a9a4a", "#f3ece0"), "purple": ("#8a4fbf", "#f3ece0"), "legendary": ("#141414", None),
}


def chip(body_hex, inlay_hex):
    R, T = 1.0, 0.16
    legendary = inlay_hex is None
    BODY = mat("body", body_hex, rough=0.3, coat=0.6)
    FACE = mat("face", "#1f1a12" if legendary else body_hex, rough=0.35, coat=0.3)
    INLAY = GOLD if legendary else mat("inlay", inlay_hex, rough=0.35, coat=0.4)
    TRIM = GOLD if legendary else INLAY
    parts = []
    bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=R, depth=T)
    b = bpy.context.object; put(b, BODY); smooth(b, 0.025); parts.append(b)
    for i in range(8):
        a = i * math.pi / 4
        bpy.ops.mesh.primitive_cube_add(size=1, location=(math.cos(a) * (R - 0.06), math.sin(a) * (R - 0.06), 0))
        e = bpy.context.object; e.scale = (0.14, 0.26, T * 1.04); e.rotation_euler.z = a
        put(e, INLAY); smooth(e, 0.012); parts.append(e)
    for s in (1, -1):
        bpy.ops.mesh.primitive_torus_add(major_radius=0.7, minor_radius=0.025, major_segments=96, location=(0, 0, s * T / 2))
        r = bpy.context.object; r.scale.z = 0.5; put(r, TRIM); smooth(r); parts.append(r)
        bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=0.66, depth=0.012, location=(0, 0, s * (T / 2 + 0.002)))
        d = bpy.context.object; put(d, FACE); smooth(d); parts.append(d)
        bpy.ops.object.text_add(location=(0, 0, s * (T / 2 + 0.008)), rotation=(0 if s == 1 else math.pi, 0, 0))
        t = bpy.context.object; t.data.body = "H"; t.data.align_x = t.data.align_y = "CENTER"
        t.data.size = 0.85; t.data.extrude = 0.018; t.data.bevel_depth = 0.006
        if FONT: t.data.font = FONT
        put(t, TRIM); parts.append(t)
        for k in range(16):
            a = k * math.pi / 8 + math.pi / 16
            bpy.ops.mesh.primitive_uv_sphere_add(radius=0.022, location=(math.cos(a) * 0.82, math.sin(a) * 0.82, s * T / 2))
            dot = bpy.context.object; dot.scale.z = 0.4; put(dot, TRIM); smooth(dot); parts.append(dot)
    return parent_all(parts, "chip")


def ease_out(t):
    return 1 - (1 - t) ** 3


def key(obj, f):
    obj.keyframe_insert("location", frame=f); obj.keyframe_insert("rotation_euler", frame=f)


kind, which = WHAT.split(":")
if kind == "chip":
    # a coin toss: up, two full flips, lands flat and rattles to rest
    N = int(arg("--frames", 32))
    T = 0.16
    root = chip(*CHIPS[which])
    up, land = 0, 18
    for f in range(N):
        if f <= land:
            t = f / land
            z = T / 2 + 1.8 * 4 * t * (1 - t)
            rx = 4 * math.pi * ease_out(t) if t < 1 else 4 * math.pi
            root.location = (0, 0, z); root.rotation_euler = (rx, 0, 0.4)
        else:
            k = f - land
            wob = math.radians(9) * math.exp(-k * 0.35) * math.cos(k * 1.9)
            root.location = (0, 0, T / 2 + abs(math.sin(wob)) * 1.0); root.rotation_euler = (4 * math.pi + wob, wob * 0.6, 0.4)
        key(root, f)
    for fc in root.animation_data.action.fcurves if hasattr(root.animation_data.action, "fcurves") else []:
        for kp in fc.keyframe_points: kp.interpolation = "LINEAR"
    camera((0, -6.2, 4.2), (0, 0, 0.9), lens=58)
    light((4, -4, 6), 900, 4, (1, 0.93, 0.8))
    light((-5, -2, 3), 250, 3, (0.8, 0.85, 1))
    light((-1, 5, 5), 600, 3, (1, 0.85, 0.6))
    sc.render.resolution_x = sc.render.resolution_y = SIZE
elif kind == "spin":
    # a chip tumbling end over end in the air, one turn, loops seamlessly
    N = int(arg("--frames", 12))
    root = chip(*CHIPS[which])
    for f in range(N):
        root.location = (0, 0, 0); root.rotation_euler = (2 * math.pi * f / N, 0, 0.4); key(root, f)
    camera((0, -5.0, 3.4), (0, 0, 0), lens=72)
    light((4, -4, 6), 900, 4, (1, 0.93, 0.8), (0, 0, 0))
    light((-5, -2, 3), 250, 3, (0.8, 0.85, 1), (0, 0, 0))
    light((-1, 5, 5), 600, 3, (1, 0.85, 0.6), (0, 0, 0))
    bg.inputs[1].default_value = 0.35  # less glare on the flat faces
    sc.render.resolution_x = sc.render.resolution_y = SIZE
else:
    # a drink sent across the table: slides in from the left, leans as it brakes, rocks and settles
    N = int(arg("--frames", 40))
    ramp.color_ramp.elements[0].color = (0.12, 0.1, 0.08, 1)
    GLASS = mat("glass", (1, 1, 1), rough=0.02, trans=1.0, ior=1.5)
    ICE = mat("ice", (0.95, 0.97, 1), rough=0.05, trans=1.0, ior=1.31)
    parts = []

    def liquid(inner, fill, color, emit, s=0.25, rough=0.05, name="liq"):
        # the inner wall up to the fill line, closed into a solid, a hair inside the glass
        pts = [(x * 0.985, z) for x, z in inner if z < fill]
        (x0, z0), (x1, z1) = [p for p in inner if p[1] < fill][-1], [p for p in inner if p[1] >= fill][0]
        rf = (x0 + (x1 - x0) * (fill - z0) / (z1 - z0)) * 0.985
        return lathe(name, pts + [(rf, fill), (0, fill)], mat(name, color, rough=rough, trans=1.0, ior=1.34, emit=emit, emit_s=s))

    if which in ("whiskey", "vault"):
        parts.append(lathe("glass", [(0.0, 0.0), (0.92, 0.0), (1.0, 0.06), (1.05, 2.1), (0.98, 2.1), (0.94, 0.38), (0.0, 0.34)], GLASS))
        parts.append(liquid([(0, 0.36), (0.94, 0.38), (0.98, 2.1)], 1.5, "#d99a1e", "#ffb83a"))
        bpy.ops.mesh.primitive_cube_add(size=0.9, location=(0.08, 0.05, 1.3))
        ice = bpy.context.object; ice.rotation_euler = (0.25, 0.18, 0.6); put(ice, ICE); smooth(ice, 0.08, 4); parts.append(ice)
        if which == "vault":
            for i, (x, y, r) in enumerate([(-0.3, 0.2, 0.2), (0.25, 0.3, 0.1), (0.05, -0.15, 0.4)]):
                bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=0.24, depth=0.05, location=(x, y, 0.4 + i * 0.03))
                c = bpy.context.object; c.rotation_euler = (r, 0.15, 0); put(c, GOLD); smooth(c, 0.01); parts.append(c)
            a = math.radians(-75)
            door = bpy.data.objects.new("door", None); sc.collection.objects.link(door); parts.append(door)
            door.location = (math.cos(a) * 1.06, math.sin(a) * 1.06, 1.05)
            door.rotation_euler = (math.radians(90), 0, a + math.radians(90))
            bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=0.42, depth=0.06)
            d = bpy.context.object; put(d, GOLD); smooth(d, 0.015); d.parent = door
            bpy.ops.mesh.primitive_torus_add(major_radius=0.33, minor_radius=0.02, location=(0, 0, 0.035))
            r = bpy.context.object; put(r, GOLD_DARK); smooth(r); r.parent = door
            wheel = bpy.data.objects.new("wheel", None); sc.collection.objects.link(wheel); wheel.parent = door
            bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=0.06, depth=0.08, location=(0, 0, 0.06))
            h = bpy.context.object; put(h, GOLD_DARK); h.parent = wheel
            for k in range(3):
                ak = k * math.pi / 1.5
                bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=0.014, depth=0.42, location=(0, 0, 0.08))
                s = bpy.context.object; s.rotation_euler = (math.pi / 2, 0, ak); put(s, GOLD_DARK); s.parent = wheel
                for sg in (1, -1):
                    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.035, location=(math.cos(ak + math.pi / 2) * 0.21 * sg, math.sin(ak + math.pi / 2) * 0.21 * sg, 0.08))
                    kb = bpy.context.object; put(kb, GOLD); kb.parent = wheel
    elif which == "wine":
        parts.append(lathe("glass", [(0, 0), (0.7, 0), (0.72, 0.04), (0.1, 0.1), (0.06, 0.3), (0.06, 1.05), (0.12, 1.2),
                                      (0.5, 1.35), (0.74, 1.65), (0.78, 2.0), (0.68, 2.7), (0.65, 2.7), (0.745, 2.0),
                                      (0.705, 1.67), (0.47, 1.39), (0.0, 1.26)], GLASS, steps=96))
        parts.append(liquid([(0, 1.27), (0.47, 1.39), (0.705, 1.67), (0.745, 2.0), (0.65, 2.7)], 1.85, "#4a0610", "#7a0f1e", 0.35))
    elif which == "martini":
        parts.append(lathe("glass", [(0, 0), (0.7, 0), (0.72, 0.04), (0.1, 0.1), (0.06, 0.3), (0.06, 1.25), (1.1, 2.4),
                                      (1.06, 2.4), (0.0, 1.33)], GLASS, steps=96))
        parts.append(liquid([(0, 1.35), (1.06, 2.4)], 2.2, "#e8ecd6", "#f6f2c8", 0.05))
        OLIVE = mat("olive", "#6b7a22", rough=0.35, coat=0.5)
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.16, location=(0.12, 0, 1.75))
        o = bpy.context.object; o.scale = (1, 1, 1.25); put(o, OLIVE); smooth(o); parts.append(o)
        bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=0.015, depth=1.5, location=(0.3, 0, 2.1))
        p = bpy.context.object; p.rotation_euler = (0, math.radians(18), 0); put(p, GOLD); parts.append(p)
    elif which == "beer":
        parts.append(lathe("glass", [(0, 0), (0.7, 0), (0.72, 0.05), (0.92, 2.6), (0.87, 2.6), (0.66, 0.2), (0, 0.18)], GLASS))
        parts.append(liquid([(0, 0.2), (0.66, 0.2), (0.87, 2.6)], 2.2, "#c87f0a", "#ffb020", 0.5))
        FOAM = mat("foam", "#fbf4e2", rough=0.9)
        parts.append(liquid([(0, 2.2), (0.814, 2.2), (0.87, 2.6)], 2.52, "#fbf4e2", None, 0, 0.9, "foam"))
        parts[-1].data.materials[0] = FOAM
    root = parent_all(parts, "drink")
    # slide in: x from -7 to 0 over the first 60%, leaning back as it brakes, then rocking to rest
    stop = int(N * 0.55)
    for f in range(N):
        if f <= stop:
            t = f / stop
            x = -5.5 + 5.5 * ease_out(t)
            lean = math.radians(7) * math.sin(math.pi * t) * t  # braking tips the top forward
        else:
            k = f - stop
            x = 0
            lean = math.radians(7) * 0.0 + math.radians(6) * math.exp(-k * 0.3) * math.cos(k * 1.1)
        root.location = (x, 0, 0); root.rotation_euler = (0, lean, x * 0.15)
        if which == "vault":
            w_ = bpy.data.objects["wheel"]; w_.rotation_euler = (0, 0, -x * 0.9 + (f > stop) * 0); w_.keyframe_insert("rotation_euler", frame=f)
        key(root, f)
    camera((2.0, -7.8, 3.0), (-1.3, 0, 1.25), lens=46)
    light((4, -4, 5), 700, 4, (1, 0.93, 0.8), (0, 0, 1))
    light((-4, -3, 2), 200, 3, (0.8, 0.85, 1), (0, 0, 1))
    light((-1, 5, 3), 900, 4, (1, 0.8, 0.5), (0, 0, 1))
    sc.render.resolution_x = int(SIZE * 1.6); sc.render.resolution_y = SIZE

frames = [int(ONLY)] if ONLY else range(N)
for f in frames:
    sc.frame_set(f)
    sc.render.filepath = f"{OUT}/{f:04d}.png"
    bpy.ops.render.render(write_still=True)
print("DONE", WHAT, len(frames))
