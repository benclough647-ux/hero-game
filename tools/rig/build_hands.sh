set -e
# Rebuild both skinned GLBs with finger bones (+ Centurion's Omni-Man fly_fast). Run from anywhere.
# fingers.py always starts from *_anim_face_prefingers.blend, so the order below is safe to re-run.
B=/home/box/blender_dl/blender-4.2.3-linux-x64/blender
R=/workspace/hero-game/tools/rig
cd /workspace/hero-game-assets/rig
for n in tiger cent; do $B -b --python $R/fingers.py -- $n 2>&1 | grep -E "ADDED|rror"; done
$B -b --python $R/cent_flight.py -- cent 2>&1 | grep -E "FLY_FAST|rror"
for n in tiger cent; do
  $B -b --python $R/export.py -- $n ${n}_anim_face 2>&1 | grep -E "EXPORTED|rror"
  # separate vertex layout (headPoints reads skinIndex per component) + no pruning (eye_emit_* / palm_* marker nodes)
  gltf-transform optimize ${n}_skinned_face_png.glb /tmp/opt_$n.glb --compress meshopt --texture-compress false --simplify false --join false --flatten false --instance false --vertex-layout separate --prune false 2>&1 | tail -1
  gltf-transform webp /tmp/opt_$n.glb /tmp/${n}_hands.glb --quality 90 --effort 100 --vertex-layout separate 2>&1 | tail -1
  cp /tmp/${n}_hands.glb /workspace/hero-game/assets/${n}_skinned.glb
done
ls -la /workspace/hero-game/assets/*_skinned.glb
