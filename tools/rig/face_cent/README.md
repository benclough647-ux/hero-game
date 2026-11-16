# Centurion face sculpt (same route as tools/rig/face for Temper Tiger)
Reference: Ben's Centurion design sheet (attachment 99cce3b9…jpg), face panel cropped to hero-game-assets/cent_face_raw.png (274x358);
cent_face_raw_clean.png = same with the horizontal lens streak through the eyes removed (eye glows kept).
Mapping used everywhere: x = (px-140)*0.0007, z = 1.722-(py-150)*0.0007 (eyes at x=±0.037, z=1.722; chin 1.586; hairline 1.789).

Order (headless Blender 4.2.3, files in /workspace/hero-game-assets/rig/), or just `bash build.sh all`:
1. `sculpt.py`  cent_anim.blend -> cent_anim_face_s1.blend: subdivides the front of the head (cuts=3), replaces the lumpy scanned face
   with a clean symmetric fitted surface, then displaces brow ridge + frown furrows, deep-set sockets, straight nose (bridge/tip/wings),
   cheekbones, moustache/lips, full square beard + jaw. Recomputes normals on the face only (the body keeps its original custom normals).
2. `bake.py`    -> _s2: front-projects the cleaned face art into the body atlas (albedo + emissive eyes from face_tex/cent_ref_emit.png),
   flattens old normal detail there, and removes the old painted eye glow / lens streak from the sides of the head.
3. `details.py` -> cent_anim_face.blend: rigid `CentFaceDetail` mesh on the head bone (3D ears, ~460 tousled hair locks, ~170 beard tufts)
   + `eye_emit_L/R` empties in the sockets (js/heroes.js findEyes uses them before the vertex heuristic).
4. `build.sh`   export (tools/rig/export.py cent cent_anim_face) + gltf-transform (meshopt, webp q90, `--vertex-layout separate`,
   `--prune false` so the eye empties survive) -> assets/cent_skinned.glb.
`headprev.py -- <blend> <tag> [orthoScale]` renders textured + clay head close-ups to /tmp/hp_<tag>_*.png.
