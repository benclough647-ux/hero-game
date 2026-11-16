# Export a skinned, animated GLB per hero: rig + body/cape LOD0 + body/cape LOD1 (decimated, same skeleton) + mohawk on the head bone.
import bpy, sys, os
args = sys.argv[sys.argv.index('--')+1:]; name = args[0]; src = args[1] if len(args) > 1 else f'{name}_anim'  # e.g. tiger tiger_anim_face
bpy.ops.wm.open_mainfile(filepath=f'/workspace/hero-game-assets/rig/{src}.blend')
ao = bpy.data.objects[f'{name}_rig']; body = bpy.data.objects[f'{name}_body']; cape = bpy.data.objects[f'cape_{name}']; moh = bpy.data.objects.get('Mohawk')
face = bpy.data.objects.get('TigerFaceDetail')  # rigid face details (ears, cheek ruff, fangs) on the head bone
for o in list(bpy.data.objects):
    if o.type in ('LIGHT', 'CAMERA') or (o.type == 'MESH' and o not in (body, cape, moh, face)): bpy.data.objects.remove(o)
def sel(objs):
    for x in bpy.context.view_layer.objects: x.select_set(False)
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
ao.animation_data.action = None
for pb in ao.pose.bones: pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0)
lods = []
for o, ratio in ((body, 0.45), (cape, 0.4)):
    c = o.copy(); c.data = o.data.copy(); bpy.context.scene.collection.objects.link(c); c.name = o.name + '_lod1'; c.data.name = c.name
    sel([c]); d = c.modifiers.new('dec', 'DECIMATE'); d.ratio = ratio
    bpy.ops.object.modifier_move_to_index(modifier='dec', index=0); bpy.ops.object.modifier_apply(modifier='dec')
    lods.append(c)
def tris(o): return sum(len(p.vertices) - 2 for p in o.data.polygons)
print('TRIS', {o.name: tris(o) for o in [body, cape] + lods + ([moh] if moh else [])})
for o in (body, cape, *lods):
    for p in o.data.polygons: p.use_smooth = True
objs = [ao, body, cape] + lods + ([moh] if moh else []) + ([face] if face else [])
sel(objs)
out = f'/workspace/hero-game-assets/rig/{src.replace("_anim", "_skinned")}_png.glb'
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_yup=True, export_apply=False,
    export_image_format='AUTO', export_texcoords=True, export_normals=True, export_tangents=False, export_materials='EXPORT',
    export_skins=True, export_all_influences=False, export_def_bones=False, export_animations=True, export_animation_mode='ACTIONS',
    export_force_sampling=True, export_frame_step=1, export_optimize_animation_size=True, export_anim_slide_to_zero=True,
    export_reset_pose_bones=True, export_morph=False)
print('EXPORTED', out, os.path.getsize(out))
