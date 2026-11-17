#!/bin/bash
# villain faces: base head -> per-villain head -> merge on the rig -> export -> meshopt + webp (separate vertex layout, --prune false)
set -e; cd "$(dirname "$0")"; B=/home/box/blender_dl/blender-4.2.3-linux-x64/blender
[ -f /workspace/hero-game-assets/villain_face/base_head.blend ] || $B -b --python head_base.py | grep -E "TRIS|Error"
for v in ${VILLAINS:-a b}; do
  TEXRES=2048 $B -b --python villain_head.py -- $v 2>&1 | grep -E "Error|Traceback|DETAIL|TRIS|DONE"
  $B -b --python merge.py -- $v 2>&1 | grep -E "NECK|BODY|HEAD|Error|Traceback"
  $B -b --python ../export.py -- cent villain_${v}_anim_face_v2 2>&1 | grep -E "TRIS|EXPORTED|Error"
  ( cd /workspace/hero-game-assets/rig
    gltf-transform optimize villain_${v}_skinned_face_v2_png.glb /tmp/opt_v$v.glb --compress meshopt --texture-compress false --simplify false --join false --flatten false --instance false --vertex-layout separate --prune false 2>&1 | tail -1
    gltf-transform webp /tmp/opt_v$v.glb /workspace/hero-game/assets/villain_${v}_skinned.glb --quality 90 --effort 100 --vertex-layout separate 2>&1 | tail -1 )
done
