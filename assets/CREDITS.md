# Hero model credits

## Characters
Temper Tiger and Centurion are Ben's original characters. The meshes were generated from his concept art with TRELLIS (image-to-3D), then cleaned up, retopologised and baked in Blender.

## Rig and animations (`tiger_skinned.glb`, `cent_skinned.glb`)
- **Skeleton and skin weights:** a humanoid armature built in Blender 4.2 (headless) and fitted to each mesh. It has root, hips, a three-part spine, neck and head, clavicle-to-hand arms, and thigh-to-toe legs. There are also three 4-bone cape chains, plus a 3-bone tail chain for Tiger. The body uses Blender's automatic (bone-heat) weights with cleanup. The cape and tail use procedural weights. The mohawk is a rigid child of the head bone.
- **Retargeted clips:** `idle`, `run`, `air`, `punch` and `hit` were retargeted from Quaternius' **Universal Animation Library** (Standard/free edition): Idle_Loop, Sprint_Loop, Jump_Loop, Punch_Cross and Hit_Chest.
  - Licence: **CC0 1.0** (public domain). Author: Quaternius (https://quaternius.com/packs/universalanimationlibrary.html).
  - Fetched from the glTF mirror of the free itch.io release at https://github.com/J-Ponzo/gltf-universal-animation-library, which is also CC0.
- **Hand-keyframed clips:** `fly_hover`, `fly_fast` (Superman pose), `tackle`, `blast`, `fall`, `down` and `getup` were keyframed procedurally for this game (see `tools/rig/anim.py`).
- **Grab-counter clips:** `counter_kick` (Centurion) and `counter_slam` (Tiger) were keyframed for this game on the same rigs (see `tools/rig/counter.py`, run after `anim.py`/face builds and before `export.py`).
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
- **`audio/punch1–3.ogg/.m4a`** (melee impacts, played in rotation): cut from short video clips supplied by Ben (16 Nov 2026). punch1 is 0.10–0.72 s of `1d0ab5d8…mov`, punch2 is 0.28–0.88 s of `6cab0546…mov`, and punch3 is 0.50–1.00 s of `f0b27e3a…mov`. All are mono 44.1 kHz with short fades and normalised.
- **`audio/laser_start/loop/tail.ogg/.m4a`** (Centurion's eye beam): cut from Ben's clip `505d2a2b…mp4`. The start is 0.19–0.75 s, the loop is 0.90–2.90 s made seamless with a 0.25 s crossfade, and the tail is 3.00–3.90 s.
- All of these are encoded as Ogg Vorbis (q5) with an AAC 128 kbps fallback. The source WAVs are not in the repo.
- **Centurion's flight wind** has no sample. It is synthesised: filtered noise whose volume and pitch scale with flight speed.
- All other sounds (sonic boom, whooshes, fire, jets) are synthesised live with WebAudio in `js/audio.js`.

# Villain credits
- **Villain A (dark hair) and Villain B (blond)** were built in Blender (`tools/rig/villain/villain.py`) on Centurion's rig and body mesh. They were repainted from Ben's two character sheets (16 Nov 2026), with faces projected from generated face references based on those sheets, plus a modelled tabard, belt and collar. Their flight pose follows Ben's flight-pose reference photo, which is used only as a pose reference.
- **Villain faces (Nov 2026 upgrade):** each villain's head, hair, moustache, brows and eyes come from one sculpted base head with shape sliders, built in headless Blender by `tools/rig/villain_face/`. The base head mesh, morph targets and eye mesh come from **MakeHuman** (makehumancommunity.org), released under **CC0 1.0** (public domain). Each villain's shape is dialled in from his sheet. His skin texture, normal map (brow ridges, folds, stubble) and the hair/moustache/brow meshes are generated procedurally by those scripts.
- **Centurion face and hands (Nov 2026 upgrade):** his new head, hair, beard, moustache, brows and glowing eyes come from the same MakeHuman CC0 base head pipeline (`tools/rig/villain_face/`, config `c`). They use his own shape settings and procedurally painted textures. His eye-beam emitters sit in the new eyes. The new realistic gloved hands (palm, knuckles, jointed fingers and thumb) are modelled procedurally in `tools/rig/cent_hands/hands.py`.
