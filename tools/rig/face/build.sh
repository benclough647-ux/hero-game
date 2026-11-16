set -e
B=/home/box/blender_dl/blender-4.2.3-linux-x64/blender
cd /workspace/hero-game-assets/rig
$B -b --python /workspace/hero-game/tools/rig/export.py -- tiger tiger_anim_face 2>&1 | grep -E "EXPORTED|rror"
gltf-transform optimize tiger_skinned_face_png.glb /tmp/opt_nt.glb --compress meshopt --texture-compress false --simplify false --join false --flatten false --instance false --vertex-layout separate 2>&1|tail -1
gltf-transform webp /tmp/opt_nt.glb tiger_skinned_face_candidate.glb --quality 90 --effort 100 --vertex-layout separate 2>&1 | tail -1
cp tiger_skinned_face_candidate.glb /workspace/hero-game/assets/tiger_skinned.glb
cp tiger_skinned_face_candidate.glb /workspace/hero-game/assets/tiger_skinned_face_candidate.glb
