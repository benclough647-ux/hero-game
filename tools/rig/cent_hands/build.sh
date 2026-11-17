#!/bin/bash
# Centurion v2: new face (villain_face pipeline, config c) + realistic hands -> assets/cent_skinned.glb
set -e; cd "$(dirname "$0")/../villain_face"; B=/home/box/blender_dl/blender-4.2.3-linux-x64/blender
TEXRES=2048 $B -b --python villain_head.py -- c 2>&1 | grep -E "Error|Traceback|DETAIL|DONE"
$B -b --python merge.py -- c 2>&1 | grep -E "NECK|EYE|Error|Traceback"            # -> rig/cent_anim_face_v2.blend
$B -b --python ../cent_hands/hands.py -- cent_anim_face_v2 cent_anim_face_v3 2>&1 | grep -E "HAND|PALM|Error|Traceback"
$B -b --python ../export.py -- cent cent_anim_face_v3 2>&1 | grep -E "TRIS|EXPORTED|Error"
cd /workspace/hero-game-assets/rig
gltf-transform optimize cent_skinned_face_v3_png.glb /tmp/opt_c.glb --compress meshopt --texture-compress false --simplify false --join false --flatten false --instance false --vertex-layout separate --prune false 2>&1 | tail -1
gltf-transform webp /tmp/opt_c.glb /workspace/hero-game/assets/cent_skinned.glb --quality 90 --effort 100 --vertex-layout separate 2>&1 | tail -1
