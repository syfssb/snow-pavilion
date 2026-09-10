# Third-party assets and licenses

The project's own source code (`src/`, `index.html`, docs) is MIT — see `LICENSE`.
Bundled third-party material keeps its original license:

## three.js — MIT
`vendor/` contains a vendored copy of three.js r180 (`three.module.js`,
`three.core.js`) and five `examples/jsm` post-processing modules
(`EffectComposer`, `RenderPass`, `UnrealBloomPass`, `ShaderPass`, `OutputPass`)
plus their transitive dependencies.

Copyright © 2010–2026 three.js authors · https://github.com/mrdoob/three.js
Vendored rather than loaded from a CDN so the project runs offline and is not
subject to third-party availability.

## Textures — CC0 (Poly Haven)
`tex/` contains four PBR texture sets downloaded from https://polyhaven.com,
all released under CC0 1.0 (public domain dedication), 1K JPG:

| Prefix  | Poly Haven asset      | Maps kept              |
|---------|-----------------------|------------------------|
| `wood`  | `dark_wooden_planks`  | col, nrm, rgh, ao, arm |
| `stone` | `granite_tile_04`     | col, nrm, rgh, ao, arm |
| `roof`  | `roof_09`             | col, nrm, rgh, ao, arm |
| `snow`  | `snow_02`             | col, nrm, rgh, ao, arm |

CC0 requires no attribution, but Poly Haven deserves it anyway.

Note: `snow_02`'s diffuse map is deliberately **not** used for the ice surface —
it carries baked-in mud that reads as dirt on a snow lake. Only its normal and
roughness maps are used; the ice diffuse is generated procedurally at runtime
(`cleanSnowDiffuse()` in `src/scene.js`).

## Text
The quoted prose is 《湖心亭看雪》 by 张岱 (Zhang Dai), written 1632.
Public domain.

## Not included
No 3D models, no HDRI environment maps, no icon fonts. All geometry, the sky
environment cube, ripple normals, snow diffuse, roof-snow alpha mask and the
snowflake sprite are generated in code at runtime.
