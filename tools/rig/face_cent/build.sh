set -e
# Centurion face sculpt candidate: sculpt -> bake -> details -> export (separate vertex layout: interleaved breaks headPoints' skinIndex.getComponent)
B=/home/box/blender_dl/blender-4.2.3-linux-x64/blender
D=/workspace/hero-game/tools/rig/face_cent
cd /workspace/hero-game-assets/rig
if [ "$1" = "all" ]; then
  $B -b --python $D/sculpt.py 2>&1 | grep -E "moved|verts|rror"
  $B -b --python $D/bake.py 2>&1 | grep -E "streak|DONE|rror"
  $B -b --python $D/details.py 2>&1 | grep -E "locks|EYE|tris|rror"
fi
$B -b --python /workspace/hero-game/tools/rig/export.py -- cent cent_anim_face 2>&1 | grep -E "EXPORTED|rror"
gltf-transform optimize cent_skinned_face_png.glb /tmp/opt_cent.glb --compress meshopt --texture-compress false --simplify false --join false --flatten false --instance false --vertex-layout separate --prune false 2>&1|tail -1
gltf-transform webp /tmp/opt_cent.glb cent_skinned_face_candidate.glb --quality 90 --effort 100 --vertex-layout separate 2>&1 | tail -1
cp cent_skinned_face_candidate.glb /workspace/hero-game/assets/cent_skinned.glb
ls -la /workspace/hero-game/assets/cent_skinned.glb
