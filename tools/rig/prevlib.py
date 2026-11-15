import bpy, math, mathutils
from mathutils import Vector
def setup(res=420, samples=12):
    sc = bpy.context.scene; sc.render.engine = 'CYCLES'; sc.cycles.samples = samples; sc.cycles.device = 'CPU'
    sc.cycles.use_denoising = True; sc.render.resolution_x = res; sc.render.resolution_y = res
    sc.render.film_transparent = False; sc.view_settings.view_transform = 'Standard'
    sc.cycles.max_bounces = 3
    w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = (0.8, 0.82, 0.86, 1); w.node_tree.nodes['Background'].inputs[1].default_value = 0.8
    for rot, en in [((50, 0, 30), 3.5), ((60, 0, 200), 1.5)]:
        l = bpy.data.lights.new('sun', 'SUN'); l.energy = en; o = bpy.data.objects.new('sun', l); sc.collection.objects.link(o); o.rotation_euler = [math.radians(a) for a in rot]
    cam = bpy.data.cameras.new('cam'); cam.type = 'ORTHO'; co = bpy.data.objects.new('cam', cam); sc.collection.objects.link(co); sc.camera = co
    return co
def shoot(co, center, scale, az, path, el=8):
    cx, cy, cz = center; d = 12; a = math.radians(az); e = math.radians(el)
    pos = Vector((cx + d*math.sin(a)*math.cos(e), cy - d*math.cos(a)*math.cos(e), cz + d*math.sin(e)))
    co.location = pos; co.rotation_euler = (Vector(center) - pos).to_track_quat('-Z', 'Y').to_euler(); co.data.ortho_scale = scale
    bpy.context.scene.render.filepath = path; bpy.ops.render.render(write_still=True)
def bone_sticks(ao):
    m = bpy.data.materials.new('bonemat'); m.use_nodes = True; n = m.node_tree.nodes
    b = n['Principled BSDF']; b.inputs['Base Color'].default_value = (0, 1, 0.2, 1); b.inputs['Emission Color'].default_value = (0, 1, 0.2, 1); b.inputs['Emission Strength'].default_value = 3
    objs = []
    for pb in ao.pose.bones:
        h = ao.matrix_world @ pb.head; t = ao.matrix_world @ pb.tail; L = (t - h).length
        bpy.ops.mesh.primitive_cone_add(vertices=6, radius1=0.018, radius2=0.004, depth=L, location=(h + t) / 2)
        o = bpy.context.object; o.rotation_euler = (t - h).to_track_quat('Z', 'Y').to_euler(); o.data.materials.append(m)
        o.visible_shadow = False; objs.append(o)
    return objs
