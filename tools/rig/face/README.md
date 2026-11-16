# Temper Tiger face sculpt (quick route)
Order (headless Blender 4.2.3, files in /workspace/hero-game-assets/rig/):
1. `sculpt.py`  tiger_anim.blend -> tiger_anim_face_s1.blend: subdivides the front of the head (cuts=2) and displaces it: muzzle + whisker pads, nose bridge/tip, mouth groove, chin, deep-set eye sockets, angry brow ridge, cheekbones, jaw. Skin weights are interpolated by the subdivide (head bone unchanged).
2. `bake.py`    -> _s2: front-projects Ben's face art (hero-game-assets/tiger_face_raw.png) onto the head and bakes it into the body atlas (albedo + emissive eyes from face_tex/ref_emit.png), flattening the old normal-map detail there.
3. `details.py` -> tiger_anim_face.blend: rigid `TigerFaceDetail` mesh on the head bone (big pointed ears, flame/cream cheek-ruff fur locks, temple flame locks, 3D fangs), vertex-coloured.
4. `build.sh`   export (tools/rig/export.py tiger tiger_anim_face) + gltf-transform (meshopt, webp q90, separate vertex layout -- interleaved breaks headPoints' skinIndex.getComponent).
