<div align="center">

# snow-pavilion

**惟长堤一痕、湖心亭一点、与余舟一芥、舟中人两三粒而已。**

<sub>— 张岱《湖心亭看雪》· Zhang Dai, *Viewing Snow from the Lake-Heart Pavilion*, 1632</sub>

A walkable snow-lake pavilion in your browser.
**Every polygon is generated from an equation.** No 3D models, no HDRI, no build step.

[简体中文](README.zh-CN.md) · [Architecture](ARCHITECTURE.md) · [Licenses](THIRD_PARTY.md)

<img src="docs/night_steps.jpg" width="100%" alt="Night snow — lantern light on the rafters">

</div>

---

## What it is

A 400-year-old Chinese prose miniature, rebuilt as a real-time 3D scene you can walk
around in. Zhang Dai rowed out onto a frozen West Lake in 1632 and found the world
reduced to four marks: a streak of causeway, a dot of pavilion, a mustard seed of boat,
and two or three grains of people.

That reduction is the whole design brief — and it happens to be the reason this runs
at 60fps from a 475-byte HTML file.

**5 camera presets × 3 times of day.** Or drop into free-walk and cross the ice yourself.

| | | |
|:-:|:-:|:-:|
| <img src="docs/dawn_vista.jpg" width="100%"> | <img src="docs/dusk_vista.jpg" width="100%"> | <img src="docs/night_vista.jpg" width="100%"> |
| 雪晨 · Snow Dawn | 暮雪 · Snow Dusk | 夜雪 · Snow Night |

## Run it

```bash
git clone https://github.com/YOUR_NAME/snow-pavilion
cd snow-pavilion
python3 -m http.server 8765
# open http://localhost:8765/
```

No `npm install`. No bundler. three.js is vendored in `vendor/`, so it also works offline.
(An HTTP server is required — `file://` blocks both ES modules and texture loading.)

**Controls** — `1` `2` `3` time of day · `[` `]` camera preset · `F` free walk ·
`WASD` + `Shift` to move · mouse to look.
Deep-link with `?t=night&c=steps&d=41`.

## Why it works: the fog *is* the LOD

「上下一白」— *above and below, all one white.* Dense fog is the aesthetic requirement.
It is also, for free:

- **A draw-distance cull.** Nothing beyond ~40m needs to exist. No LOD tiers, no
  streaming, no distant geometry.
- **A composition tool.** The default camera sits at exactly 41m because
  `exp(-(0.0275 × 41)²) = 0.30` — the pavilion transmits 30% through the fog.
  Any further and it dissolves; any closer and it stops being 「一点」, *a single dot*.
- **A reveal mechanism.** Walking toward the pavilion *is* the experience, and the six
  clauses of the original prose surface one by one as the distance closes.

The aesthetic and the frame budget point in the same direction. That is rare, and it is
why an essay from 1632 makes an unusually good spec for a WebGL scene.

## The roof is three equations

A Chinese 四角攒尖顶 (square pyramidal hip roof) with 飞檐 (upturned eaves) looks like
something you must model by hand. It isn't:

```js
rEave  = W / max(|cos θ|, |sin θ|)            // square eave outline
corner = (|cos θ| + |sin θ| - 1) / (√2 - 1)   // 0 at face centre, 1 at corner
zEave  = -H + lift · corner²                  // eaves lift toward the corners
z      = zEave · (1 - (1-u)^2.2)              // 举折 — steep at the ridge, flat at the eave
```

Sixteen rings × eighty segments, `computeVertexNormals()`, done. The same trick builds
the boat (a lathe), the reeds (900 instanced blades), the drift ice, and the lake itself.

## The most useful thing in this repo

Four rounds were spent adding texture detail, raising normal-map strength and replacing
the flat ice plane with displaced geometry. **Nothing changed on screen.**

The cause was not detail. It was **exposure clipping**: snow's albedo is ~0.9, and with a
hemisphere light at 1.75 plus a directional at 1.85 plus an environment map, ground
luminance sat permanently above 1.0. Every bit of variation was flattened to pure white
*before* tone mapping ever ran.

Halving the lights made four rounds of invisible work appear at once.

A second instance of the same class of bug, found later: film grain of `±0.0175` was being
added in **linear HDR**, where dark woodwork sits around `0.02`. The negative half-cycle
clamped to zero, and three.js's `RRTAndODTFit` numerator carries a `−9.05e-5` bias that
crushes the region near zero — producing pixels of *exactly* `(0,0,0)` even with a lift
of `0.045`. Fix: `smoothstep(0, 0.11, luma)`, because film has no grain in the shadows
either.

**Calibrate exposure before you add a single texture.** It is written at the top of
`ARCHITECTURE.md` for a reason.

## What's in the box

```
index.html          475 bytes — importmap + one module tag
src/scene.js        geometry & materials, procedural textures
src/atmosphere.js   3 time presets, 22 parameters cross-faded over 1.5s
src/cameras.js      preset framing, quaternion slerp, free-walk controls
src/ui.js           all DOM + CSS, self-injected, zero framework
src/main.js         assembly + post-processing chain + render loop
vendor/             three.js r180, vendored (MIT)
tex/                4 PBR sets from Poly Haven (CC0)
ARCHITECTURE.md     the full module contract — camera framing maths,
                    the three lighting tables, module boundaries
```

**Techniques**: hand-written `BufferGeometry` · `InstancedMesh` · procedural
`CanvasTexture` (snow diffuse, ripple normals, roof-snow alpha, snowflake sprite) ·
procedural `CubeTexture` sky environment · `FogExp2` · `PCFSoftShadowMap` ·
`ACESFilmicToneMapping` · `EffectComposer` → `UnrealBloomPass` → custom grade
`ShaderPass` → `OutputPass` · `Quaternion.slerp` camera transitions.

**Not used**: any modeling tool, `GLTFLoader`, planar reflection, baked GI, React, a
bundler, a CDN.

## Where procedural generation stops

This repo is a demonstration of one rule:

> **If it has an equation, write code. If it only has a look, you need an artist.**

The pavilion is modular timber architecture built to a dimensional standard — it has an
equation. So do snow drifts, ripples, reeds, and a lathe-turned hull.

What is deliberately missing marks the other side of that line: the 斗拱 (interlocking
bracket sets), carved balustrades, painted beams, roof-ridge figures — and 「舟中人两三粒」,
*two or three grains of people in the boat*. A human figure has no equation. Neither
does a reed with a seed head.

Known limits, honestly: the boat casts no contact shadow (the directional light's shadow
frustum is ±22m and the boat preset sits at its edge); ≥45fps has never been verified on
real hardware; touch input has only been exercised with synthetic pointer events.

## Credits

Built with [three.js](https://threejs.org) (MIT). Textures from
[Poly Haven](https://polyhaven.com) (CC0). Prose by 张岱, 1632, public domain.
See [THIRD_PARTY.md](THIRD_PARTY.md).

MIT licensed. Fork it, change the season, put your own building on the lake.
