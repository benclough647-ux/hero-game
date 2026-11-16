# Hero model credits

## Characters
Temper Tiger and Centurion are Ben's original characters. The meshes were generated from his concept art with TRELLIS (image-to-3D), then cleaned up, retopologised and baked in Blender.

## Rig and animations (`tiger_skinned.glb`, `cent_skinned.glb`)
- **Skeleton and skin weights:** a humanoid armature built in Blender 4.2 (headless) and fitted to each mesh. It has root, hips, a three-part spine, neck and head, clavicle-to-hand arms, and thigh-to-toe legs. There are also three 4-bone cape chains, plus a 3-bone tail chain for Tiger. The body uses Blender's automatic (bone-heat) weights with cleanup. The cape and tail use procedural weights. The mohawk is a rigid child of the head bone.
- **Retargeted clips:** `idle`, `run`, `air`, `punch` and `hit` were retargeted from Quaternius' **Universal Animation Library** (Standard/free edition): Idle_Loop, Sprint_Loop, Jump_Loop, Punch_Cross and Hit_Chest.
  - Licence: **CC0 1.0** (public domain). Author: Quaternius (https://quaternius.com/packs/universalanimationlibrary.html).
  - Fetched from the glTF mirror of the free itch.io release at https://github.com/J-Ponzo/gltf-universal-animation-library, which is also CC0.
- **Hand-keyframed clips:** `fly_hover`, `fly_fast` (Superman pose), `tackle`, `blast`, `fall`, `down` and `getup` were keyframed procedurally for this game (see `tools/rig/anim.py`).
- **Secondary motion:** cape and tail motion is keyframed per clip.

The build scripts are in `tools/rig/` (run with `blender -b --python <script> -- tiger|cent`).

# City credits
All city art is original and generated in code at load time: no third-party textures or models.
- **Textures:** asphalt, lane markings, zebra crossings, stop lines, turn arrows, manholes, drains, gutters, paving slabs and grass are drawn on canvases in `js/citytex.js`.
- **Building facades:** glass curtain wall, concrete office, brick and painted stucco, plus shopfronts and signs, weathering, window recesses, blinds and lit interiors. All of it is a procedural shader in `js/facade.js`.
- **Props:** street lamps, traffic signals, benches, bins, hydrants, rooftop water tanks, vents, masts, AC units, plant rooms, parapets, cornices, awnings and trees are built from Three.js primitives in `js/city.js`.
- **Visual reference:** GTA V's city was used only as a look-and-feel reference. Nothing was copied from it.

# Audio credits
- **`audio/tiger_roar.ogg` / `audio/tiger_roar.m4a`** (Temper Tiger's RT roar blast): a real tiger roar taken from a short video clip supplied by Ben (2.0 s .mov, 16 Nov 2026). The whole roar, 0.00–1.95 s, was used: mono 44.1 kHz, 55 Hz high-pass, light FFT denoise, 20 ms fade-in and 0.3 s fade-out, loudness-normalised to -14 LUFS. Ben supplied it for use in this game.
- All other sounds (sonic boom, whooshes, fire, jets, impacts) are synthesised live with WebAudio in `js/audio.js`.
