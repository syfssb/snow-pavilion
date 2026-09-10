# snow-pavilion · 架构与模块契约

> **在加第一张贴图之前，先把曝光标定好。**
> 雪的反照率约 0.9。任何时辰预设都必须先保证地面亮度不越过 1.0，
> 否则所有贴图、法线、几何起伏都会在 tone mapping 之前被削平成纯白。
> 这条是本项目用四轮无效工作换来的，写在最前面。

本文档是四个模块并行开发时的唯一依据，记录了模块边界、导出签名、
五个机位的构图计算、三套时辰的完整参数表。保留下来是因为它解释了
「为什么是这些数字」——这部分信息在代码里看不出来。

---

# 湖心亭看雪 · 模块契约 v3

> 这份文档是 4 个并行 agent 的**唯一依据**。签名、参数名、数值全部以本文为准。
> 与 `legacy_v2.html`（旧单文件实现，只读参考）冲突时，以本文为准。
>
> 基线备份：`legacy_v2.html`（= 改造前的 `index.html`，可回退，任何人不得修改）。

---

## 0. 铁律

1. **几何体 100% 程序化**。禁止 `.glb / .gltf / .fbx / .obj / .ply` 及任何建模文件。
2. **three.js 只用 vendored 版本**（r180）。importmap 已固定：
   `"three" -> ./vendor/three.module.js`、`"three/addons/" -> ./vendor/addons/`。
   禁止 CDN、禁止 npm、禁止新增第三方库。
3. **贴图只用 `tex/` 下已有的 20 张**（wood / stone / roof / snow 各 col+nrm+rgh+ao+arm）。
   可以新增**程序化 canvas 贴图**（`CanvasTexture`），禁止下载任何新图片。
4. **必须走 http**：`cd /Users/sunyunfeng/Desktop/pan/huxinting && python3 -m http.server 8765`
   （已在跑，`curl -s -o /dev/null -w "%{http_code}" http://localhost:8765/` 返回 200）。
5. **美学基调**：「雾凇沆砀，天与云与山与水，上下一白」。极简、留白、水墨。
   禁止花哨渐变、霓虹、emoji、圆角卡片、阴影堆叠。中文一律衬线体（宋体系）。

---

## 1. 曝光标定 —— 最高优先级

这是上一版用四轮白工换来的教训，写在最前面：

> 地面反照率 × 光强 > 1.0 时，**所有明暗变化在 tone mapping 之前就被削顶成纯白**。
> 贴图、法线、几何起伏全都在，只是全被压进了同一个白色。

### 1.1 已核实的渲染管线语义（three r180，不要凭记忆推翻）

已在 `vendor/three.module.js:17036-17047` 核实：

```js
let toneMapping = NoToneMapping;
if ( material.toneMapped ) {
  if ( _currentRenderTarget === null || _currentRenderTarget.isXRRenderTarget === true ) {
    toneMapping = _this.toneMapping;
  }
}
```

推论，**三条都是硬事实**：

- **A. composer 的缓冲区是线性 HDR、未曝光、未 tone map 的。**
  RenderPass 渲染进 RenderTarget（非 null），材质里不做 tone mapping。
  ACES + `toneMappingExposure` + sRGB 编码全部由链尾的 `OutputPass` 负责。
- **B. `UnrealBloomPass.threshold` 作用在线性 HDR 值上，且不随 `toneMappingExposure` 缩放。**
  改曝光不会改变什么东西会 bloom。夜间把光强降到 11% 之后，阈值 **不需要**跟着降到 11%。
- **C. `UnrealBloomPass` 每帧 `render()` 里都会把 `this.strength / radius / threshold`
  重新写进 uniform**（`UnrealBloomPass.js:306, 340, 341`）。
  → atmosphere **必须改属性**（`bloom.strength = x`），
    **绝对不要**写 `bloom.highPassUniforms['luminosityThreshold'].value`——会被每帧覆盖。

光照公式（已核实）：
- `HemisphereLight`：`irradiance = mix(groundColor, skyColor, 0.5*dot(N,up)+0.5)`，
  其中 skyColor/groundColor uniform **已经乘过 intensity**。
- `DirectionalLight`：`irradiance = saturate(dot(N,L)) * color * intensity`。
- 漫反射：`BRDF_Lambert = albedo / PI`。
- IBL：`getIBLIrradiance` 带一个 `PI` 因子 → **`scene.environmentIntensity` 是和半球光同量级的曝光杠杆，
  不是"可有可无的反射细节"**。0.55 的环境贴图对地面的贡献 ≈ 半球光 + 方向光之和。

### 1.2 已测量的基线（唯一可信锚点）

对 `shots/02_v2_远景.png`（雪晨 / 41m 远眺 / 1024×700）逐像素统计：

| 指标 | 实测值 |
|---|---|
| 天空（雾底色） | 211–212 / 255 |
| 近处冰面 | 190–212 / 255 |
| p99 max-channel | **219** |
| max-channel ≥ 250 的像素占比 | **0.00 %** |
| max-channel ≥ 253 的像素占比 | **0.00 %** |

即：验证过的雪晨预设**不只是没过曝，还留了约 15% 余量**。这是全部推算的起点。

用上面的公式反推雪晨地面线性漫反射 ≈ 0.782，经 ACES(×0.92) → sRGB ≈ **198/255**，
与实测 190–212 吻合。**模型可信**，第 3 节的另外两套时辰就是用同一模型推的。

### 1.3 验收窗口（整合者的闸门，不是任何单个 agent 的）

四个 agent 并行改各自的文件，**没有任何一个 agent 能单独验证曝光**。
曝光验收是**整合者（写 main.js / index.html 的人）的责任**，在四路合并之后跑。

**截图配方**（main.js 必须实现这个 URL 协议）：

```
http://localhost:8765/?shot=1&time=<dawn|dusk|night>&preset=<vista|steps|inside|boat>
```

`shot=1` 时 main.js 必须：跳过入场闸门 → `atmosphere.setTime(time, true)` →
`cameras.goTo(preset, true)` → `ui` 全部隐藏（含原文、数据、机位、时辰）→
正常进主循环（雪要动起来、贴图要加载完）。截图前等 3 秒。

```bash
# 用 obscura（CDP 在 localhost:9333）或 shangwang skill 截图，然后：
python3 - <<'PY'
from PIL import Image
import collections, sys
im = Image.open(sys.argv[1] if len(sys.argv)>1 else 'shot.png').convert('RGB')
w,h = im.size; px = im.load()
hist = collections.Counter(); tot = 0
for y in range(0,h,3):
    for x in range(0,w,3):
        r,g,b = px[x,y]; hist[max(r,g,b)] += 1; tot += 1
def pct(p):
    c = 0
    for k in sorted(hist):
        c += hist[k]
        if c >= tot*p: return k
    return 255
over = sum(v for k,v in hist.items() if k >= 250) / tot * 100
dark = sum(v for k,v in hist.items() if k <= 12)  / tot * 100
print(f"p50={pct(.5)}  p99={pct(.99)}  >=250:{over:.2f}%  <=12:{dark:.2f}%")
PY
```

**通过条件**（视口 16:9 = 1280×720）。

> **★ v4 起闸门从 3 张扩到 15 张（3 时辰 × 5 机位）。**
> 旧闸门表头写着「机位一律用 vista」，另外三个近景机位没有任何亮度约束 ——
> 这正是「全部木作压成黑剪影」能一路过关上线的系统性原因：
> vista 是 41 米远眺、画面 78% 是雾色，恰好是全场最不敏感的一个取景，
> `≤12` 实测 0.00%，而同一时辰的 `dusk_inside` 是 21.13%、`dusk_steps` 15.04%。
> **压黑和压白只会在近景机位暴露，闸门却偏偏只测远景。**
> 截图配方本来就支持 `&preset=<vista|steps|inside|boat>`（自由行走那一档用 `&d=<米>`），
> 扩表不需要任何新工具，把上面那段 PIL 脚本套一层 glob 即可。
>
> 另外补一条 `crush`（luma ≤ 6 的占比）。`≤12` 取的是 `max(r,g,b)`，
> 对「被颗粒钳到纯黑」这种失效不敏感；luma 才抓得住。

**远景闸门**（`vista`，三个时辰）：

| 时辰 | p99 **【闸门】** | ≥250 占比 **【闸门】** | ≤12 占比 **【闸门】** | p50 *（参考）* |
|---|---|---|---|---|
| 雪晨 dawn | 205 – 238 | < 0.5 % | < 1 % | **212**（v3 实测） |
| 暮雪 dusk | 185 – 240 | < 1.5 % | < 3 % | **151**（v3 实测） |
| 夜雪 night | 150 – 252（灯火可以打到顶） | < 2.5 % | < 12 % | **46**（v3 实测） |

**近景闸门**（`steps` / `inside` / `boat` / `free`，共 12 张）：

| 项 | 阈值 | 说明 |
|---|---|---|
| `≥250` 占比 | < 2.5 % | 高光削顶。夜雪的灯火可以打到顶，别的都不行 |
| `≤12` 占比 | < 8 % | 暗端削顶。v4 实测最差是 `night_steps` 3.51%（夜里该黑的那部分） |
| `crush`（luma ≤ 6） | < 3 % | 同上，抓「颗粒把暗部钳成纯黑」这一类 |

v4 实测基线（全部通过，可当回归基准）：雪晨四张 crush 全 0.00%；
暮雪最差 `inside` 0.15%；夜雪最差 `steps` 2.34%。
**任何一张近景 crush 回到 10% 量级，先查两处：`TIMES` 的 `lift`、`materials.wood` 的 `color`。**

**p50 是参考目标，不是闸门。** 三个 p50 全部是模型算出来的，从未实测过；
而且实测基线 `02_v2_远景.png` 是 **1024×700（宽高比 1.46，不是 16:9）**、画面里还带着原文和数据行，
和 `?shot=1` 的无 UI 截图不是同一个取景 —— §2.3 的 `fovFor` 在 1.46 下会把垂直 fov 从 34° 张到 41°，
天空/冰面的像素配比就变了，中位数必然漂移。
**p99 / ≥250 / ≤12 对这些都不敏感，p50 敏感。**
首次三张截完之后，用实测值把上表的 p50 参考列重设一遍，此后才拿它当趋势指标。

**闸门任何一项超窗 = 改 `TIMES` 表里的数字，不要改 scene.js 的材质颜色。**
`TIMES` 必须是纯字面量表（第 3 节），零逻辑，整合者能一行改完。

### 1.4 性能预算（同样是整合者的闸门）

上一版实测 17 fps，不可接受。目标：**1440×900、Apple Silicon、≥ 45 fps**。
- `renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75))`（旧版是 2）。
- 阴影贴图 2048，`shadow.camera` 范围见 §2.1（归 scene.js 所有）。
- draw call 目标 < 150。合并同材质小件（`InstancedMesh` 或手工合并 BufferGeometry）。
- 雪粒子 CPU 循环上限 4200，夜雪按 `snowDensity` 用 `setDrawRange` 缩减，不重建 buffer。
- 掉帧就先降 bloom 分辨率（`new Vector2(iw*0.5, ih*0.5)`），不要先砍几何体。

---

## 2. 模块拆分

```
index.html          ← 只剩 <div id="app"></div> + importmap + <script type="module" src="./src/main.js">
src/main.js         ← 装配。整合者所有。四个 agent 都不许碰
src/scene.js        ← 几何 + 材质 + 灯具实体 + 每帧运动
src/atmosphere.js   ← 时辰系统：雾 / 光 / 环境 / 曝光 / bloom / 雪 / 灯火，1.5s 插值
src/cameras.js      ← 相机：预设机位缓动 + 自由行走
src/ui.js           ← 全部 DOM 与 CSS。不 import three
```

**文件归属是排他的。** 一个 agent 只写自己那一个文件，别的文件一个字符都不能改。

### 2.0 世界常量表（scene.js 与 cameras.js 必须使用完全相同的字面量）

没有第五个共享文件，所以这张表**在两个模块里各抄一份**。抄错 = 相机穿模。

```
PAVILION_CENTER   (0, 0, 0)           湖心亭中心，踏跺朝 +Z
PLINTH_TOP_Y      0.62                台基顶面（柱脚所在平面）
FLOOR_Y           0.655               亭内可站立面（台基顶的薄雪层）
COLUMN_HALF       1.62                四柱心距中心的半距
BEAM_Y            3.18                额枋中心高度
ROOF_ORIGIN_Y     4.96                屋面几何原点
EAVE_MID_Y        3.54                檐口最低点（正中，r = 3.05）  ← v3 屋面改型后实测
EAVE_TIP_Y        3.88                翼角起翘尖（45° 方向，r = 4.31）  ← 同上
BASE_HALF         2.75                台基外沿半宽
STEPS_X_HALF      1.00                踏跺半宽
STEPS_Z0 / Z1     2.60 / 3.60         踏跺占据的 z 区间
DIKE_Z            50.6                长堤中心线
DIKE_HALF_W       1.70                长堤半宽（z ∈ [48.90, 52.30]）
DIKE_TOP_Y        0.24                长堤顶面（旧版按 0.48 抬眼高，错的，人浮空 0.24）
BOAT_POS          (-11.5, 0.02, 20.0) 小舟位置
BOAT_YAW          0.70 rad            小舟朝向
BOAT_LEN / BEAM   4.50 / 1.24         舟长 / 舟宽
ICE_Y             0.0                 冰面基准（顶点位移 ±0.14）
REED_BAND_Z       44.0 .. 50.5        枯苇带
POST_BAND_Z       39.0 .. 46.0        系船桩带
EYE_H             1.62                人眼高
WALK_SPEED / RUN  2.9 / 5.6           m/s
WALK_BOUNDS       x ∈ [-90, 90], z ∈ [-70, 56]
STEP_METERS       0.72                HUD「步」的换算：步 = 米 / 0.72
```

**地面高度函数**（cameras.js 自由行走用，scene.js 只保证几何体和它一致）：

```js
function groundY(x, z) {
  if (Math.abs(x) <= 2.40 && Math.abs(z) <= 2.40) return 0.655;              // 亭内
  if (Math.abs(x) <= 1.00 && z >= 2.60 && z <= 3.60)                          // 踏跺
    return 0.08 + (3.60 - z) / 1.00 * 0.54;
  if (Math.abs(x) <= 2.75 && Math.abs(z) <= 2.75) return 0.62;                // 台基顶面（v3 补）
  if (Math.abs(z - 50.6) <= 1.70) return 0.24;                                // 长堤
  return 0.0;
}
```

不做碰撞体，只做地面高度。眼高每帧向 `groundY + 1.62` 缓动，系数 `Math.min(1, dt * 7)`。

---

### 2.1 `src/scene.js`

```js
export function buildScene(THREE, renderer) -> handles
```

**创建并返回整个场景图**（scene 自己也在 handles 里）。同步返回，贴图异步到达。

必须实现的 handles 形状：

```js
handles = {
  scene,                    // THREE.Scene。fog 用雪晨初值建好，background 用雪晨雾色
  loadingManager,           // THREE.LoadingManager，main.js 挂 onLoad 驱动入场闸门
  whenReady(cb),            // 契约扩展【必须】：贴图到齐或 6s 超时后调一次 cb（只调一次）

  materials: {              // 【必须】atmosphere / 整合者可能要改的材质引用
    ice, stone, wood, roof, snow, dark, reed,
    iceShard, roofSnowCap,  // 碎冰 / 屋顶积雪层
    boatHull, boatCabin,
    dikeTop, dikeSide
  },

  meshes: {                 // 【必须】按语义分组的 mesh/group 引用
    ice, iceFar,            // 近场起伏冰面 / 远场大平面
    pavilion,               // Group
    reeds,                  // InstancedMesh
    iceShards,              // InstancedMesh
    posts,                  // Group（系船桩）
    dike,                   // Group（长堤：顶面 + 侧壁）
    boat                    // Group
  },

  lights: {                 // 【必须】atmosphere 唯一被允许改的光照对象
    hemi,                   // THREE.HemisphereLight
    sun,                    // THREE.DirectionalLight（夜里当月光用，不换对象）
    sunTarget               // sun.target，已 scene.add
  },
  sunOffset,                // THREE.Vector3。每帧 sun.position = camera.position + sunOffset
                            // （y 用绝对值，不叠加 camera.y）。atmosphere 改它来换太阳方位

  snowPoints,               // 【必须】THREE.Points，4200 粒
  snowMaterial,             // 【必须】THREE.PointsMaterial（= snowPoints.material，方便直取）
  SNOW_MAX: 4200,           // 【必须】常量

  lanterns: [               // 【必须】可点亮的灯具，长度 3
    { id, mesh, material, halo, light, lightScale, worldPos }
  ],

  update(dt, elapsed, camera)   // 【必须】每帧运动。见下
}
```

`lanterns[i]` 字段含义：
- `mesh` 灯笼/灯台本体；`material` 它的 `MeshStandardMaterial`（atmosphere 改 `emissiveIntensity`）
- `halo` 光晕 `THREE.Sprite`（atmosphere 改 `halo.material.color`，scene 改 `opacity`）
- `light` `THREE.PointLight` 或 `null`（第 3 盏可以只有 halo 没有实光，省一个光源）
- `lightScale` 该盏灯相对主强度的倍率（见下表）
- `worldPos` `THREE.Vector3`，世界坐标，scene 自己算好，供雾衰减用

**三盏灯的规格（scene.js 建，atmosphere 点）**：

| id | 位置 | 本体 | halo | light | lightScale |
|---|---|---|---|---|---|
| `eaveL` | (-1.62, 2.60, 1.62) | 灯笼：LatheGeometry 纺锤，r 0.115 / h 0.24 + 吊绳 CylinderGeometry r 0.008 从 y3.18 到 y2.74 | Sprite | 无（`light: null`） | – |
| `eaveR` | ( 1.62, 2.60, 1.62) | 同上 | Sprite | PointLight | 1.00 |
| `lamp`  | ( 0.42, 0.94, -0.55) | 灯台：柱 Cylinder r0.05 h0.30（底在 FLOOR_Y）+ 灯碗 Sphere r0.075 置于 y 0.94 | Sprite | PointLight | 0.55 |

- 灯本体材质：`MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.85,
  emissive: 0xffb877, emissiveIntensity: 0 })`。**初值必须是 0**（白天不亮）。
- halo 材质：`SpriteMaterial({ map: haloTex, color: new THREE.Color(0,0,0),
  blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  depthTest: true, fog: false, opacity: 1 })`
  - `haloTex` = 32×32 canvas 径向渐变（白 → 透明，`stop(0)=1, stop(.35)=.55, stop(1)=0`）
  - **`sprite.material.sizeAttenuation = false`，`sprite.scale.setScalar(0.055)`**。
    这样光晕在任何距离都占屏高的固定比例（fov 46 时约 6.5%），
    近看不会糊住整个屏幕，41m 远眺时也还有约 15px —— 「湖心亭一点」靠它，不靠灯笼本体像素。
  - **`fog: false` 是刻意的**：加色混合的精灵走 three 的雾会被 `mix(color, fogColor, f)`
    反而加亮。雾衰减由 scene 每帧手算（见 update）。
- PointLight：`new THREE.PointLight(0xffb877, 0, 11, 2)`（**初值强度 0**，distance 11，decay 2）。

**`handles.update(dt, elapsed, camera)` 必须做的事**（旧版散在主循环里的运动，全部搬进来）：

1. 太阳跟随：`sun.position.copy(camera.position).add(sunOffset); sun.position.y = sunOffset.y;`
   `sunTarget.position.set(camera.position.x, 0, camera.position.z);`
2. 冰面法线贴图缓慢滚动：`offset.x += dt*0.0026; offset.y += dt*0.0016`，各自 `% 1`。
3. 雪粒子：按旧版逻辑推进 + 以相机为中心的环绕重投（半径 `SNOW_R = 34`），
   只更新 `[0, geometry.drawRange.count)` 区间内的粒子。
4. 小舟摇晃：`boat.rotation.z = Math.sin(elapsed*0.7)*0.028;
   boat.position.y = 0.02 + Math.sin(elapsed*0.9)*0.025;`
5. 灯光晕雾衰减：对每盏灯
   ```js
   const d = camera.position.distanceTo(l.worldPos);
   const k = scene.fog ? Math.exp(-Math.pow(scene.fog.density * d, 2)) : 1;
   l.halo.material.opacity = k;
   ```
   （`scene.fog.density` 由 atmosphere 每帧写，scene 只读。）

**scene.js 必须设定的初值**（保证 atmosphere 万一没跑，画面仍是标定过的雪晨）：
- `scene.background = new THREE.Color(0xe4eaee)`
- `scene.fog = new THREE.FogExp2(0xe4eaee, 0.0275)`
- `scene.environment = <day cube>`，`scene.environmentIntensity = 0.55`
- `hemi = new THREE.HemisphereLight(0xf2f7fa, 0x9fadb8, 0.95)`
- `sun = new THREE.DirectionalLight(0xfff4e6, 0.85)`，`sunOffset = new Vector3(-14, 17, 11)`
- **阴影视锥（scene.js 独家所有，atmosphere 被禁止碰 `shadowMap`，所以这里设错就永远是错的）**：
  ```js
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;    sun.shadow.camera.far    = 90;   // 旧版 70，不够
  sun.shadow.camera.left = -22;  sun.shadow.camera.right  = 22;   // 旧版 ±16，不够
  sun.shadow.camera.top  =  22;  sun.shadow.camera.bottom = -22;
  sun.shadow.bias = -0.0016;     sun.shadow.normalBias = 0.03;
  ```
  **为什么是 ±22 而不是旧版的 ±16**：暮雪的太阳仰角只有 10.4°，
  湖心亭 5 米高 → 影子拖出 `5 / tan(10.4°) ≈ 27 米`。
  而 `sunTarget` 是跟着玩家走的，视锥只覆盖玩家周围 ±16 米 ——
  影子会被一条笔直的硬边横切在冰面上。那不是风格化，那是 bug，
  而且恰好出现在 `steps` 和 `inside` 这两个影子最显眼的机位里。
  代价：44m / 2048 ≈ **2.1 cm/texel**。若 `steps` 机位下栏杆积雪的影子糊了，
  该动的是 `mapSize`（升到 4096）或换级联，**不是把范围缩回去**。

**scene.js 绝对不能碰**：
`src/atmosphere.js`、`src/cameras.js`、`src/ui.js`、`src/main.js`、`index.html`、
`legacy_v2.html`、`CONTRACT.md`、`README.md`、`vendor/**`、`tex/**`。
不写任何 DOM / CSS / `document.getElementById`（`document.createElement('canvas')` 做程序化贴图是允许的）。
不创建 `EffectComposer` 或任何 Pass。
不设置 `renderer.toneMapping` / `toneMappingExposure` / `shadowMap` / `setPixelRatio`。
不实现时辰切换逻辑（只设初值）。不创建相机。

**这一版必须修掉的旧问题**（在 `shots/03_v2_近景.png` 里肉眼可见）：
- 屋面起翘过度，翼角像蝙蝠翅膀。`hipRoof(W, H, lift)` 的 `lift` 从 0.62 降到 **0.34**，
  `H` 从 1.62 降到 **1.42**，`corner` 的指数从 2 改成 **1.6**（起翘更缓、更宋）。
  改完记得同步 `EAVE_MID_Y / EAVE_TIP_Y / ROOF_ORIGIN_Y` 三个常量并**在本文件顶部注释里写清新值**。
  → 若改了这三个数，机位表的 pitch 需要整合者重截图微调（第 4 节已标为可调）。
- `MAT.roof` 的 `color: 0x8f98a1` 叠 `roof_col` 后整体接近纯黑，屋面读不出瓦垄。
  改成 `color: 0xb0b6bc`、`roughness: 0.95`，并挂 `aoMap`（用 `roof_ao.jpg`）。
  **r180 的 `aoMap` 默认读 UV 通道 0**（`aoMap.channel = 0`），`hipRoof()` 已经写了 `uv` 属性，
  **直接复用，不要再建第二套 UV**（建了也不会被读，等于挂了一张死贴图）。
- 枯苇像一根根悬空的线：`blade` 宽度 0.022 → **0.030**，加 `alphaMap`（程序化：上端渐隐），
  底端 y 下沉到 `-0.12` 埋进雪里。
- 屋顶积雪层 `cap` 与屋面 z-fighting 风险：`polygonOffset: true, polygonOffsetFactor: -1`。

---

### 2.2 `src/atmosphere.js`

```js
export function createAtmosphere(THREE, scene, renderer, composer, handles)
  -> { setTime(name, instant), update(dt), TIMES }
```

- `setTime(name, instant = false)` —— `name` 是 `'dawn' | 'dusk' | 'night'`。
  `instant === true` 直接跳到目标值，否则在 **1.5 秒**内用 `easeInOutCubic` 插值过去。
  切换过程中再次调用 `setTime`：以**当前插值中的实际值**为新起点，重新计时 1.5s（不闪回）。
- `update(dt)` —— 只推进插值。**不做任何场景运动**（那是 scene.update 的事）。
- `TIMES` —— 导出给 ui.js 渲染按钮用的**只读数组**（顺序即 UI 顺序）：
  ```js
  TIMES = [ { id:'dawn', label:'雪晨' }, { id:'dusk', label:'暮雪' }, { id:'night', label:'夜雪' } ]
  ```
  （完整参数表内部私有，UI 只需要 id + label。）
- 契约扩展【必须】：`current()` 返回当前 time id；`isBlending()` 返回 bool。

**拿到后处理 pass 的方式**（签名里只有 composer，所以约定用命名属性）：
main.js 在建链时会挂上 `composer.bloomPass` 和 `composer.gradePass`。
atmosphere 先读这两个属性；读不到再退化为扫 `composer.passes` 找
`p.isUnrealBloomPass === true` / `p.material?.name === 'HuxintingGrade'`。
两条路都拿不到就 `console.warn` 并跳过 bloom/grade 的调制（其余照常工作）。

**必须插值的量**（全部用 `easeInOutCubic(t)` 后的同一个 k）：

| 目标 | 写到哪 | 插值方式 |
|---|---|---|
| fogColor | `scene.fog.color` + `scene.background` | `Color.lerpColors`（three 在线性空间插值，正确） |
| fogDensity | `scene.fog.density` | 数值 lerp |
| hemiSky / hemiGround | `handles.lights.hemi.color / .groundColor` | Color lerp |
| hemiIntensity | `handles.lights.hemi.intensity` | 数值 |
| sunColor / sunIntensity | `handles.lights.sun.color / .intensity` | Color / 数值 |
| sunOffset | `handles.sunOffset` | `Vector3.lerpVectors` |
| envIntensity | `scene.environmentIntensity` | 数值 |
| envPreset | `scene.environment` | **在 k ≥ 0.5 时硬切**（CubeTexture 无法交叉淡入；强度已在插值，切换看不出来） |
| exposure | `renderer.toneMappingExposure` | 数值 |
| bloomStrength / Radius / Threshold | `bloomPass.strength / .radius / .threshold` | 数值（**改属性，见 §1.1-C**） |
| snowColor / snowOpacity / snowSize | `handles.snowMaterial.color / .opacity / .size` | Color / 数值 |
| snowDensity | `handles.snowPoints.geometry.setDrawRange(0, Math.round(SNOW_MAX * v))` | 数值后取整 |
| vignette / grain / lift / contrast | `gradePass.uniforms.uVig / uGrain / uLift / uContrast` | 数值 |
| lanternEmissive | 每盏 `l.material.emissiveIntensity` | 数值 |
| lanternLight | `l.light.intensity = v * l.lightScale`（`l.light` 为 null 时跳过） | 数值 |
| haloGain | `l.halo.material.color.setRGB(1.0, 0.72, 0.42).multiplyScalar(v)` | 数值 |

`HALO_BASE_RGB = (1.0, 0.72, 0.42)` 是契约常量。乘出来 > 1 是**故意的**：
`Color` 不钳制，线性 HDR 缓冲区里的超白值正是 bloom 要吃的东西。

**三套环境立方体**（atmosphere 自己用 canvas 画，6 面 64×64，
`mapping = CubeReflectionMapping`，`colorSpace = SRGBColorSpace`）：

| preset | +Y 顶面 | -Y 底面 | 四侧（上→中→下线性渐变） |
|---|---|---|---|
| `day`   | `#ffffff` | `#c4ced6` | `#fdfeff` → `#e6ecf0` → `#c8d2da` |
| `dusk`  | `#e8e0d4` | `#a09a93` | `#efe6d8` → `#dcd6ce` → `#b6b2ae` |
| `night` | `#2f3d4e` | `#0e141b` | `#33404f` → `#1e2a37` → `#101820` |

三张在 `createAtmosphere` 里一次建好缓存，切换时只换引用。

**atmosphere.js 绝对不能碰**：
`src/scene.js`、`src/cameras.js`、`src/ui.js`、`src/main.js`、`index.html`、
`legacy_v2.html`、`CONTRACT.md`、`README.md`、`vendor/**`、`tex/**`。
不新建任何几何体、材质、Mesh、光源对象（只改 handles 里已有的）。
不碰 `renderer.toneMapping`（枚举）/ `shadowMap` / `setPixelRatio` / `setSize` /
`info.autoReset` —— **只允许写 `renderer.toneMappingExposure` 这一个属性**。
不碰 `composer.addPass / removePass / setSize`。不读写 DOM。不碰相机。

---

### 2.3 `src/cameras.js`

```js
export function createCameras(THREE, camera, domElement)
  -> { goTo(name, instant), setFree(on), update(dt), PRESETS, isFree() }
```

- `goTo(name, instant = false)` —— `name` 是 PRESETS 里的 id，或 `'free'`（等价 `setFree(true)`）。
  非 instant 时用 `easeInOutCubic` 在 `preset.dur` 秒内过渡；**过渡中禁用一切用户输入**。
- `setFree(on)` —— 切自由行走。`setFree(true)` 时**保持当前相机位姿**，
  从当前 `camera.rotation` 直接读出 yaw/pitch 继续（不重置视角）。
- `update(dt)` —— 推进过渡或自由行走。**每帧必须在 scene.update 之前调用**（太阳跟随依赖相机位置）。
- `isFree()` —— bool。
- 契约扩展【必须】：
  - `isBusy()` → bool，是否正在过渡（过渡中所有用户输入被忽略）
  - `current()` → 当前 preset id；自由模式返回 `'free'`
  - `getStick()` → `{ x, y, active }`，虚拟摇杆状态。
    `x/y ∈ [-1, 1]`（x 右为正、y 下为正，与旧版 `move` 一致），`active` 表示是否正被按住。
    非触屏或未按住时返回 `{ x:0, y:0, active:false }`。main.js 每帧读它喂给 `ui.setStick`
  - `dispose()` 解绑所有事件（含 window 上的 capture 监听）

**消除四元数往返 bug 的硬性要求**：

```js
camera.rotation.order = 'YXZ';   // 必须。在 createCameras 开头设一次
```

自由行走直接写 `camera.rotation.y = yaw; camera.rotation.x = pitch;`（不再 `rotateY/rotateX`）。
过渡结束时把最终朝向写回 `yaw = camera.rotation.y; pitch = camera.rotation.x;`。
`YXZ` 顺序下这个往返是无损的，不需要任何 lookAt 矩阵分解。**这是预设↔自由交接的唯一正确做法。**

**过渡实现**：
- 位置：`pos.lerpVectors(from, to, e)`，再叠一个抬升 `pos.y += arc * Math.sin(Math.PI * e)`，
  其中 `arc = Math.min(3.0, 0.055 * from.distanceTo(to))`。避免贴地掠过或穿过亭子时太生硬。
- 朝向：起点/终点各构造一个 `Quaternion`（终点由 `dummy.lookAt(target)` 得到），
  `Quaternion.slerpQuaternions(qA, qB, e)` 写进 `camera.quaternion`。
  过渡**结束的那一帧**再按上面的规则回写 yaw/pitch。
- fov：`camera.fov` 用同一个 `e` 数值 lerp，每帧 `updateProjectionMatrix()`。
- 缓动：`easeInOutCubic(t) = t < .5 ? 4t³ : 1 - (-2t+2)³/2`

**视野的宽高比自适应**（手机竖屏不能把构图裁没）：

```js
const REF_ASPECT = 16 / 9;
function fovFor(fovRef, aspect) {
  if (aspect >= REF_ASPECT) return fovRef;                 // 更宽的屏只是横向多看到一点
  const v = 2 * Math.atan(Math.tan(fovRef * Math.PI / 360) * REF_ASPECT / aspect) * 180 / Math.PI;
  return Math.min(78, v);                                  // 窄屏纵向张开以保住横向构图，上限 78°
}
```
`PRESETS[i].fov` 是 **16:9 下的垂直 fov**，是权威值。resize 时重算，过渡中也用重算后的值做 lerp 终点。

**自由行走**（保留旧版全部行为，只修两处）：
- 键盘 WASD / 方向键，Shift 快走（`RUN` 5.6，否则 `WALK_SPEED` 2.9）。
- 桌面：点击请求 pointer lock；失败则退化为按住鼠标拖动（旧版已有 `pointerlockerror` 分支，保留）。
  灵敏度：locked 0.0022，drag 0.0042。
- 触屏：左半屏虚拟摇杆（判定半径 46px，旋钮最大位移 36px），右半屏拖动转视角，灵敏度 0.005。

  **摇杆的所有权划分（这是唯一正确做法，不要自己发明别的）**：
  - **输入归 cameras.js**：在 `window` 上以 **capture 阶段**（`{ capture: true, passive: false }`）
    监听 `pointerdown / pointermove / pointerup / pointercancel`，自己算摇杆向量。
    用 window + capture 是因为 ui 的触屏层盖在 canvas 上方，
    监听 `domElement` 会收不到事件。`domElement` 只用于 pointer lock 与 click。
  - **渲染归 ui.js**：ui 只画圆环和旋钮，**不读任何 pointer 事件**，
    触屏层根节点必须 `pointer-events: none`（纯装饰，绝不拦事件）。
  - **两者由 main.js 每帧对接**：
    `const s = cameras.getStick(); ui.setStick(s.x, s.y, s.active);`
  - cameras.js **不创建任何 DOM**，ui.js **不监听任何 pointer 事件**。
- pitch 钳制 `[-1.15, 0.95]` rad。
- **修 1**：眼高用 §2.0 的 `groundY(x,z) + EYE_H`（旧版长堤加 0.48，人浮空 0.24m）。
- **修 2**：`camera.rotation.order = 'YXZ'`，不再每帧 `camera.rotation.set(0,0,0)` 再 rotateY/rotateX。

**cameras.js 绝对不能碰**：
`src/scene.js`、`src/atmosphere.js`、`src/ui.js`、`src/main.js`、`index.html`、
`legacy_v2.html`、`CONTRACT.md`、`README.md`、`vendor/**`、`tex/**`。
不创建 / 查询 / 修改任何 DOM 元素（只在 `domElement` 与 `window` / `document` 上挂事件监听）。
不碰任何光源、材质、几何体、雾、renderer 设置、composer。
**PRESETS 必须是纯数据**，`goTo` 里不许出现任何 `if (name === 'inside')` 之类的按机位分支。

---

### 2.4 `src/ui.js`

```js
export function createUI({ onTime, onPreset, onFree, onToggle, onEnter })
  -> { setStats(o), setVerse(distance), setActiveTime(n), setActivePreset(n),
       setReady(hint), setFree(on), setBusy(on), setTimes(list), setPresets(list),
       setStick(x, y, active), dispose() }
```

**回调**（全部可选，缺了要能安全跳过）：
| 回调 | 签名 | 何时触发 |
|---|---|---|
| `onTime` | `(id)` | 点了「雪晨 / 暮雪 / 夜雪」，id ∈ `dawn/dusk/night` |
| `onPreset` | `(id)` | 点了某个机位，id 见 §4 |
| `onFree` | `(on)` | 点了「自由行走」→ `onFree(true)`；ESC 退出 → `onFree(false)` |
| `onToggle` | `(key, on)` | 快捷键开关。key ∈ `'verse'`（原文）\| `'hud'`（数据）\| `'chrome'`（全部界面） |
| `onEnter` | `()` | 点了入场闸门的「入　雪」按钮 |

**返回值**（前四个是任务硬性要求，后面标注为契约扩展但同样【必须】实现）：
| 方法 | 说明 |
|---|---|
| `setStats({ fps, tris, calls, steps })` | 【必须】数据行。缺字段显示 `–` |
| `setVerse(distance)` | 【必须】`distance` 单位**米**（相机到亭中心的水平距离）。按 §4.3 阈值逐句显形 |
| `setActiveTime(id)` | 【必须】高亮时辰，并写 `document.body.dataset.time = id` 驱动 UI 明暗配色 |
| `setActivePreset(id)` | 【必须】高亮机位。`id === 'free'` 时高亮「自由行走」 |
| `setReady(hint)` | 扩展【必须】：贴图到齐 → 启用「入　雪」按钮并把提示文案换成 `hint` |
| `setFree(on)` | 扩展【必须】：进出自由模式时切换触屏摇杆显隐 + 机位高亮 |
| `setBusy(on)` | 扩展【必须】：机位过渡中把控件降到 35% 不透明并 `pointer-events:none`。**main.js 每帧都会调，值没变时必须直接 return，不许每帧写 DOM** |
| `setTimes(list)` / `setPresets(list)` | 扩展【必须】：用 `[{id,label}]` 渲染按钮。main.js 用 `atmosphere.TIMES` / `cameras.PRESETS` 喂 |
| `setStick(x, y, active)` | 扩展【必须】：把旋钮移到 `(x*36, y*36)` px 并按 `active` 显隐圆环。**纯渲染，不读事件** |
| `dispose()` | 扩展【必须】：移除所有节点与监听 |

**版式（这是水墨留白，不是控制面板）**

```
┌──────────────────────────────────────────────────────┐
│ 雪晨 · 暮雪 · 夜雪                       雾  惟      │  左上：时辰    右上：原文竖排
│                                          凇  长      │
│                                          沆  堤      │
│                                          砀  一      │
│                                          ，  痕      │
│                                                      │
│                                                      │
│ ┃ 湖心亭一点                                         │  左下：机位竖排列表
│   阶前仰观                                           │
│   亭中看雪                                           │
│   余舟一芥                                           │
│   自由行走                                           │
│                                                      │
│ 距亭 42 步 · 58 fps · 62,132 面 · 118 draw calls     │  最下：数据一行
└──────────────────────────────────────────────────────┘
```

- 时辰：左上 `top: 24px; left: 26px`，三项横排，中间用 `·` 分隔（`opacity:.35`）。
- 机位：左下竖排列表，`bottom: 52px; left: 26px`。
  激活项：颜色为 `--ink`，左侧 2px 竖线（`border-left`），其余项 `opacity: .42`。
  **不要按钮边框、不要背景块、不要圆角**。纯文字 + 一根竖线。
- 数据行：`bottom: 18px; left: 26px`，无衬线 + `font-variant-numeric: tabular-nums`，12px，`opacity:.55`。
- 原文：右上竖排（`writing-mode: vertical-rl; text-orientation: upright`），
  `top: 5vh; right: 4vw; max-height: 74vh`（旧版 82vh 会和数据行打架）。
  每句 `<span>`，`.on { opacity: .93 }`，`transition: opacity 2.4s ease`。`pointer-events: none`。
- 入场闸门 `#hxt-gate`：全屏，居中，标题「湖心亭看雪」`letter-spacing:.5em`，
  副标题提示文案，一个「入　雪」按钮（1px 边框，2px 圆角，hover 反色）。
  `onEnter` 后加 `.gone`，`transition: opacity .9s ease`。
- 触屏摇杆 `#hxt-touch`：`position:fixed; inset:0; z-index:8; pointer-events:none;`
  （**必须 `pointer-events:none`**：它只是画面上的一个指示器，事件全部归 cameras.js 在 window 上收）。
  内含 `#hxt-stick`（左下 118px 圆环，`left:26px; bottom:26px`）与 `#hxt-knob`（46px 圆点）。
  仅 `matchMedia('(hover: none)')` 且自由模式下显示；旋钮位置由 `setStick()` 驱动。

**字体**
```css
--serif: "Songti SC","STSong","Source Han Serif SC","Noto Serif SC","SimSun",serif;
--sans:  "PingFang SC","Helvetica Neue",system-ui,sans-serif;
```
中文一律 `--serif`，数字/英文用 `--sans`。

**明暗配色必须跟着时辰走**（夜雪下墨色字看不见）。用 CSS 变量 + `body[data-time]`：

```css
body { --ink:#2b3138; --ink-2:#69737d; --glow:rgba(232,238,242,.85); }
body[data-time="dusk"]  { --ink:#33302c; --ink-2:#736c63; --glow:rgba(238,232,222,.80); }
body[data-time="night"] { --ink:#dfe7f0; --ink-2:#8fa1b5; --glow:rgba(14,20,28,.75); }
```
文字统一 `color: var(--ink)`，次级 `var(--ink-2)`，
并加 `text-shadow: 0 1px 14px var(--glow)` 保证在任何底色上可读。
配色切换加 `transition: color .9s ease`，和 1.5s 时辰过渡同步呼吸。

**快捷键**（ui.js 自己监听 `window` 的 keydown，转成 `onToggle` / `onFree` / `onPreset`）：
| 键 | 行为 |
|---|---|
| `1` `2` `3` | `onTime('dawn'/'dusk'/'night')` |
| `Q` `W` `E` `R` | 不用（W 是前进，禁止占用） |
| `[` `]` | 上一个 / 下一个机位 → `onPreset(id)` |
| `F` | `onFree(true)` |
| `Escape` | 自由模式下 `onFree(false)` 并回到上一个机位 |
| `V` | `onToggle('verse', !on)` |
| `H` | `onToggle('hud', !on)` |
| `C` | `onToggle('chrome', !on)`（全部界面隐藏，用于截图） |

**移动端（`max-width: 720px`）**：机位列表改为底部横向单行、可横滑；数据行默认隐藏；
时辰保持左上；原文 `font-size` 降到 `clamp(12px, 3.4vw, 15px)`，`max-height: 56vh`。

**ui.js 绝对不能碰**：
`src/scene.js`、`src/atmosphere.js`、`src/cameras.js`、`src/main.js`、`index.html`、
`legacy_v2.html`、`CONTRACT.md`、`README.md`、`vendor/**`、`tex/**`。
**不许 `import` three**（`import * as THREE` 一次都不许出现）。
不碰 canvas / WebGL / 相机 / 场景 / 任何 3D 对象。
CSS 全部由 ui.js 用 `<style>` 注入（`index.html` 里不留样式）。

---

## 3. 三套时辰的具体数值

**这张表是纯字面量，atmosphere.js 里必须原样照抄，不要算、不要推导。**
第 1.3 节验收超窗时，改的就是这张表。

> **⚠ 本表是 v4 实测定标值，不是推算值。**
> §3 曾经和 `src/atmosphere.js` 分叉过 10 处（夜雪 hemiIntensity 契约 0.55 / 代码 1.45，
> envIntensity 0.22 / 0.58，exposure 1.15 / 1.22；暮雪 fogColor、fogDensity、sunIntensity、
> envIntensity 四项；雪晨与暮雪的 lift）。**每一处都是代码对、契约过期。**
> 危险在于 §1.1「曝光标定最高优先级」+ 本节「原样照抄，不算、不推导」的措辞，
> 会让后来者默认代码跑偏、动手往契约的旧值回退 —— 回退即把夜雪亮度打回约 1/2.6，
> p99 从 169 掉到 118，当场跌破 §1.3 的 `p99 ≥ 150` 硬闸门。
> 现已按 `shots/final/*.png` 的实测值对齐。**改这张表之前先跑一遍 §1.3 的 15 张验收。**

```js
const TIMES_DATA = {

  // ── 雪晨 ──────────────────────────────────────────────────────────
  // 已实测标定（shots/02_v2_远景.png：p99=219，≥250 占 0.00%）。
  // 除非重新截图测量，否则不要动这一列的任何数字。
  dawn: {
    id: 'dawn', label: '雪晨',
    fogColor:      0xe4eaee,
    fogDensity:    0.0275,
    hemiSky:       0xf2f7fa,
    hemiGround:    0x9fadb8,
    hemiIntensity: 0.95,
    sunColor:      0xfff4e6,
    sunIntensity:  0.85,
    sunOffset:     [-14, 17, 11],     // 仰角 43.6°，从左后上方来
    envPreset:     'day',
    envIntensity:  0.55,
    exposure:      0.92,
    bloomStrength: 0.34,
    bloomRadius:   0.85,
    bloomThreshold:0.86,
    snowColor:     0xffffff,
    snowOpacity:   0.95,
    snowSize:      0.105,
    snowDensity:   1.00,
    vignette:      0.62,
    grain:         0.035,
    lift:          0.045,
    contrast:      1.055,
    lanternEmissive: 0.0,
    lanternLight:    0.0,
    haloGain:        0.0
  },

  // ── 暮雪 ──────────────────────────────────────────────────────────
  // 低斜的暖阳从 -Z 方向来 → 亭子逆光成剪影，长影朝相机拖过来，
  // 冰面出一条掠射高光带。这是三套里唯一有"方向感"的一套。
  // 推算地面线性漫反射 0.264 → ACES(×1.02) → sRGB ≈ 134/255。
  dusk: {
    id: 'dusk', label: '暮雪',
    fogColor:      0x8f8477,
    fogDensity:    0.0260,
    hemiSky:       0xdfe3ea,
    hemiGround:    0x8d857c,
    hemiIntensity: 0.40,
    sunColor:      0xffcf94,
    sunIntensity:  1.50,
    sunOffset:     [-26, 5.8, -18],   // 仰角 10.4°，从左前下方来（在主机位的正前方）
    envPreset:     'dusk',
    envIntensity:  0.60,
    exposure:      1.02,
    bloomStrength: 0.46,
    bloomRadius:   0.90,
    bloomThreshold:0.62,              // 夕照冰面的掠射高光刚好越过阈值 → 一条辉光带
    snowColor:     0xf6ecdd,
    snowOpacity:   0.90,
    snowSize:      0.112,
    snowDensity:   1.00,
    vignette:      0.74,
    grain:         0.038,
    lift:          0.050,
    contrast:      1.070,
    lanternEmissive: 0.9,             // 灯火初上，一点点
    lanternLight:    0.35,
    haloGain:        0.6
  },

  // ── 夜雪 ──────────────────────────────────────────────────────────
  // 「湖中人鸟声俱绝」。全场最暗，亭中一点灯火是唯一光源感，也是全场情绪高点。
  // 推算地面线性漫反射 0.086 → ACES(×1.15) → sRGB ≈ 68/255（雪仍是雪，不是黑）。
  // 灯火线性值 ≈ 2.1，经 41m 雾衰减（×0.335）后 ≈ 0.71，仍高于阈值 0.40 → 远眺可见「一点」。
  night: {
    id: 'night', label: '夜雪',
    fogColor:      0x1b2733,
    fogDensity:    0.0255,            // 比雪晨略稀，让 41m 外的灯火透得出来
    hemiSky:       0x8aa6c8,          // 色相靠颜色定，亮度靠 intensity 定，两者分离
    hemiGround:    0x2b3a4c,
    hemiIntensity: 1.45,
    sunColor:      0xbcd4f0,          // 同一盏 DirectionalLight，夜里当月光
    sunIntensity:  0.18,
    sunOffset:     [17, 23, -13],     // 仰角 47.1°，从右前上方来 → 屋脊积雪一道冷边光
    envPreset:     'night',
    envIntensity:  0.58,              // 关键：环境贴图强度必须压下来，否则冰面被泛光淹没，
                                      //       「一点」就不成立了
    exposure:      1.22,
    bloomStrength: 0.85,
    bloomRadius:   0.85,
    bloomThreshold:0.40,              // 夜雪地面线性值 0.086，阈值是它的 4.6 倍 → 只有灯火会 bloom
    snowColor:     0xcfe0f2,
    snowOpacity:   0.82,
    snowSize:      0.118,
    snowDensity:   0.85,
    vignette:      0.88,
    grain:         0.014,
    lift:          0.004,
    contrast:      1.000,             // 必须是 1.00。grade 的对比度支点写死在 0.5，
                                      // 而夜雪的线性值只有 0.086 —— 支点在它之上，
                                      // 1.10 是把暗部往下压，不是提对比：0.086 → 0.049 → 43/255，
                                      // 直接掉出验收窗。详见 §3 末尾的对照表
    lanternEmissive: 3.2,
    lanternLight:    2.6,
    haloGain:        3.2
  }
};
```

**推算依据**（供整合者判断该往哪个方向调，不用照抄进代码）：

| | 半球光对地面 | 方向光对地面 | 环境贴图对地面 | 总辐照度 | 线性漫反射 | 预期 sRGB |
|---|---|---|---|---|---|---|
| 雪晨 | 0.893 | 0.563 | 1.434 | 2.890 | 0.782 | **198** ✓实测 190–212 |
| 暮雪 | 0.306 | 0.117 | 0.553 | 0.976 | 0.264 | **134** |
| 夜雪 | 0.202 | 0.084 | 0.031 | 0.317 | 0.086 | **70** |

（地面反照率取 0.85；`漫反射 = 辐照度 × 0.85 / π`；ACES 用 three 的 Narkowicz 近似。）

**这一列只算到 ACES，没算 grade pass 和暗角。** 实际帧还要再过一道
`c = (c - 0.5) * uContrast + 0.5 + uLift`，**支点写死在 0.5**。
这是个为显示域写的公式，却作用在线性 HDR 缓冲上 —— 于是它对**暗部是压缩，不是提对比**：

| | grade 前 | grade 后 | 最终 sRGB |
|---|---|---|---|
| 雪晨（0.782 在支点之上）| 0.782 | 0.810 | 200 |
| 暮雪（0.264 在支点之下）| 0.264 | 0.256 | 131 |
| 夜雪 contrast **1.10** | 0.086 | **0.049** | **43** ← 低于夜雪 p50 下限 |
| 夜雪 contrast **1.00** | 0.086 | 0.090 | **70** ← 正确 |

所以夜雪的 `contrast` **必须是 1.00**。这条已经写进 §3 的表里了，不要"顺手"调回 1.10。

（bloom 不受影响：bloom 在 grade **之前**，§3 的阈值推算仍然成立。）

调整方向：
- **画面偏亮** → 先降 `envIntensity`（杠杆最大），再降 `hemiIntensity`，最后才动 `exposure`。
- **画面偏暗** → 反过来。**不要**靠拉 `exposure` 救，那会把 bloom 和实际亮度解耦。
- **看不出明暗层次** → 说明还是过曝，降光强，不要加法线强度（这就是上一版的坑）。
- **夜雪看不见灯火** → 依次试：抬 `haloGain` → 抬 `lanternEmissive` → 降 `fogDensity` →
  降 `bloomThreshold`。**不要**抬 `hemiIntensity`（那会把夜色一起抬没）。
- **夜雪整体偏暗、p50 掉到 46 以下** → **先查 `contrast` 是不是被改回了 1.10**（见上表），
  再查 `vignette` 是不是过大。**这两个是 grade 的锅，不是光强的锅。**
  在确认 grade 无误之前，一格 `hemiIntensity` 都不要动 —— 抬光强能把 p50 拉回窗内，
  代价是「湖中人鸟声俱绝」当场消失，而且没人会发现是怎么没的。

---

## 4. 预设机位清单

`PRESETS` 是 cameras.js 导出的**纯数据数组**，顺序即 UI 顺序：

```js
const PRESETS = [
  { id:'vista',  label:'湖心亭一点', pos:[  8.50, 1.78, 41.00 ], target:[  2.20, 2.64,  0.00 ], fov:34, dur:2.2 },
  { id:'steps',  label:'阶前仰观',   pos:[  1.45, 1.42,  7.60 ], target:[  0.75, 2.58,  0.20 ], fov:52, dur:1.8 },  // v3 整合时按截图重瞄
  { id:'inside', label:'亭中看雪',   pos:[  0.62, 2.28, -0.95 ], target:[ -2.60, 1.55, 14.00 ], fov:46, dur:1.8 },
  { id:'boat',   label:'余舟一芥',   pos:[ -9.40, 0.48, 25.60 ], target:[ -6.30, 1.50, -4.20 ], fov:48, dur:2.0 },
  { id:'free',   label:'自由行走',   free:true }
];
```

> **这五组数字是初值。** 三角函数算得很仔细，但雾、宽高比、屋面改型之后
> 必须**整合时按截图微调**。调整权归整合者，agent 不要改。
> `pos/target` 单位米，`fov` 是 16:9 下的垂直视角（度），`dur` 是过渡秒数。
> 带 `free:true` 的项没有 pos/target/fov，`goTo('free')` 等价于 `setFree(true)`。

### 4.1 每个机位的构图意图（改数字前先读这段）

**1. 湖心亭一点 · vista** — fov 34（≈ 50mm 等效）
站在冰面上、距亭 41 米。这个距离是算过的：`exp(-(0.0275×41)²) = 0.30`，
亭子透过 30% —— 刚好是一个清晰但淡的剪影，再远就化没了，再近就不叫「一点」了。
- 相机 y=1.78 略高于常人眼高，让地平线压在画面中心偏下 3%，上半是天、下半是冰，白对白。
- 视轴向左偏 8.7°，亭子落在中线左侧 10.5% —— 右边整块留白留给竖排原文。
- 亭基压在地平线上，屋顶向上伸到画面 19% 处。构图重心刚好在下三分之一线上。
- 前景会自然带到 z≈40 的系船桩与碎冰，一两根深色竖线钉住近景。
- 这是**默认起始机位**，也是曝光验收用的机位。

**2. 阶前仰观 · steps** — fov 52（≈ 32mm 等效）
站在踏跺下 2.2 米，仰角 26°。整个亭子压过来。
- 近端翼角在视轴上方约 13°，正好落在画面上缘内侧 —— 屋檐"罩"住取景框顶部。
- 相机在中轴右侧 0.6 米，亭子的中轴线落在中线左侧 15%，右边仍留给原文。
- 这是唯一能看清**斗拱、挂落棂条、栏杆积雪、瓦垄**的机位。
  §2.1 里屋面起翘和瓦材质的修复，就是为这一张。

**3. 亭中看雪 · inside** — fov 46（≈ 36mm 等效）
站在亭内后部偏左，向 +Z 敞口方向望出去。
- 两根前檐柱分别落在视轴 ±30° 左右 —— **柱子成为天然画框的左右两边**，
  上边是檐口，下边是栏杆。这是全场唯一的"框景"，中国园林的基本手法。
- 框内偏左约 19° 是小舟（21 米外），框正中往深处是 50 米外的长堤 ——
  雾透过率约 15%，正好是「长堤一痕」。
  **一个画面里同时装下「余舟一芥」和「长堤一痕」**，这是四个机位里信息密度最高的一张。
- 夜雪时两盏檐灯就挂在相机前上方 —— 这是「湖心亭一点」的内部视角，暖光洒在栏杆积雪上。

**4. 余舟一芥 · boat** — fov 48（≈ 34mm 等效）
贴着冰面（相机 y=0.48）站在小舟斜后方 6 米。
- 相机-小舟-湖心亭三者近乎共线，相机在延长线上侧移了一点。
- 小舟在中线左侧 74% 处（部分出画）—— **前景元素被画框切断是刻意的**，
  它把视线往画面深处推。湖心亭在中线右侧 32% 处、27 米外，是小舟的远处回声。
- 极低机位让冰面从画面底边一路铺到地平线，占掉下半张。上半张全是空白的天。
  「余舟一芥」的"芥"字（芥子，极小）由**大前景 + 大空白的反差**给出，不是靠把船画小。
- 暮雪时逆光最强，舟成剪影，冰面反出一条光路直指画外。

**5. 自由行走 · free**
保留全部 WASD / 摇杆逻辑。从任意机位切入时保持当前位姿，不重置视角。
`groundY()` 允许沿踏跺走上台基、走进亭中，也能登上长堤。

### 4.2 一句话标题（UI 上就显示这五个）

| id | 中文标题 | 出处 |
|---|---|---|
| `vista`  | 湖心亭一点 | 「惟长堤一痕、湖心亭一点」 |
| `steps`  | 阶前仰观 | — |
| `inside` | 亭中看雪 | 篇名 |
| `boat`   | 余舟一芥 | 「与余舟一芥」 |
| `free`   | 自由行走 | — |

### 4.3 原文逐句显形阈值（ui.js 用）

`setVerse(distance)`，`distance` 是相机到亭中心 (0,0) 的**水平**距离，单位米。
`distance < 阈值` 则该句 `.on`。

```js
const VERSE = [
  ['雾凇沆砀，天与云与山与水，上下一白。', 999],
  ['湖上影子，',                            44],
  ['惟长堤一痕、',                          36],
  ['湖心亭一点、',                          26],
  ['与余舟一芥、',                          17],
  ['舟中人两三粒而已。',                     9]
];
```

四个机位落在的距离：vista 41.9m（前 2 句）、boat 27.3m（前 3 句）、
steps 5.7m（全 6 句）、inside 1.1m（全 6 句）。逐机位递进，是设计好的。

---

## 5. main.js 装配顺序与调用关系

**main.js 由整合者写，四个 agent 都不许碰。** 写在这里是为了让四个 agent
知道自己会被怎么调用。

```js
import * as THREE from 'three';
import { EffectComposer }  from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }      from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass }      from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass }      from 'three/addons/postprocessing/OutputPass.js';
import { buildScene }      from './scene.js';
import { createAtmosphere }from './atmosphere.js';
import { createCameras }   from './cameras.js';
import { createUI }        from './ui.js';
```

装配顺序（**不可调换**）：

```
 1. renderer                 antialias:true, powerPreference:'high-performance'
                             setPixelRatio(min(dpr, 1.75))
                             shadowMap.enabled = true, type = PCFSoftShadowMap
                             toneMapping = ACESFilmicToneMapping
                             toneMappingExposure = 0.92        ← 只在这里设一次初值
                             info.autoReset = false            ← 整帧 draw call 统计必需
 2. camera                   PerspectiveCamera(34, aspect, 0.08, 400)
                             camera.rotation.order 由 cameras.js 负责设成 'YXZ'
 3. handles = buildScene(THREE, renderer)
 4. composer                 new EffectComposer(renderer)
                             addPass RenderPass(handles.scene, camera)
                             bloom = new UnrealBloomPass(Vector2(iw, ih), 0.34, 0.85, 0.86)
                             addPass bloom;   composer.bloomPass = bloom      ← 契约命名
                             grade = new ShaderPass(GradeShader)              ← 见下
                             addPass grade;   composer.gradePass = grade      ← 契约命名
                             addPass new OutputPass()
 5. atmosphere = createAtmosphere(THREE, handles.scene, renderer, composer, handles)
 6. cameras    = createCameras(THREE, camera, renderer.domElement)
 7. ui         = createUI({ onTime, onPreset, onFree, onToggle, onEnter })
                 ui.setTimes(atmosphere.TIMES);  ui.setPresets(cameras.PRESETS)
                 （ui 不 import 任何模块，按钮清单一律由 main.js 喂）
 8. handles.whenReady(() => ui.setReady(hint))
 9. atmosphere.setTime('dawn', true)      // instant
10. cameras.goTo('vista',   true)         // instant
11. 若 URL 带 ?shot=1 → 跳过闸门、ui 全隐、按 &time= / &preset= instant 设定
12. requestAnimationFrame 主循环
```

主循环每帧的**严格顺序**：

```
dt = min((now - prev)/1000, 0.06)
① cameras.update(dt)                       ← 先动相机
② atmosphere.update(dt)                    ← 再推进时辰插值（写 fog.density 等）
③ handles.update(dt, elapsed, camera)      ← 场景运动：太阳跟随相机、雪、舟、灯晕雾衰减
④ grade.uniforms.uTime.value = elapsed
⑤ renderer.info.reset()
⑥ composer.render()
⑦ 每 240ms：ui.setStats({...})、ui.setVerse(hypot(camera.x, camera.z))
```

②必须在③之前：scene 的灯晕雾衰减要读 atmosphere 刚写的 `scene.fog.density`。
①必须在③之前：太阳跟随要读相机的新位置。

**回调接线**：

```js
onTime:   id => { atmosphere.setTime(id); ui.setActiveTime(id); }
onPreset: id => { cameras.goTo(id);  ui.setActivePreset(id);  ui.setFree(false); }
onFree:   on => { cameras.setFree(on); ui.setFree(on);
                  ui.setActivePreset(on ? 'free' : cameras.current()); }
onToggle: (k, on) => ui 自己处理显隐；main 只在 k==='chrome' 时兼做别的
onEnter:  () => { /* 闸门淡出，主循环已在跑；桌面端请求 pointer lock */ }
每帧：    ui.setBusy(cameras.isBusy())              ← 过渡中锁 UI（ui 内部做 no-op 去重）
          const s = cameras.getStick();
          ui.setStick(s.x, s.y, s.active)          ← 摇杆：输入在 cameras，渲染在 ui
```

**Grade shader**（main.js 持有，沿用旧版并加两个 uniform）：

```js
const GradeShader = {
  name: 'HuxintingGrade',                 // ← atmosphere 的退化查找靠这个 name
  uniforms: {
    tDiffuse:{value:null}, uTime:{value:0},
    uVig:{value:0.62}, uGrain:{value:0.035},
    uLift:{value:0.012}, uContrast:{value:1.055}    // ← 新增，供 atmosphere 调制
  },
  ...
  // 片元里把旧版写死的 1.055 / 0.012 换成 uContrast / uLift
};
```
`ShaderPass` 会把 `name` 复制到 `this.material.name`。

**模块间调用关系（唯一合法的箭头）**：

```
                     main.js
        ┌──────────────┬───────────────┬──────────────┐
        ▼              ▼               ▼              ▼
    scene.js      atmosphere.js    cameras.js       ui.js
                       │
                       └── 只读写 handles / scene / renderer.toneMappingExposure
                           / composer.bloomPass / composer.gradePass

scene.js      → 不 import 任何本项目模块
atmosphere.js → 不 import 任何本项目模块（handles 由参数传入）
cameras.js    → 不 import 任何本项目模块
ui.js         → 不 import 任何本项目模块，也不 import three
```

**四个模块之间零 import。**所有耦合都经过 main.js 的参数传递。

---

## 6. 每个模块的「绝对不能碰」总表

| 文件 | 唯一所有者 | 该所有者不许碰的东西 |
|---|---|---|
| `src/scene.js` | scene agent | 其余 3 个 src 文件、`main.js`、`index.html`、`legacy_v2.html`、`CONTRACT.md`、`README.md`、`vendor/**`、`tex/**`；DOM/CSS；composer/Pass；`renderer.toneMapping*` / `shadowMap` / `setPixelRatio` / `info.*`；相机对象；时辰切换逻辑 |
| `src/atmosphere.js` | atmosphere agent | 同上文件清单；新建几何体/材质/Mesh/光源；`renderer` 的除 `toneMappingExposure` 外一切属性；`composer.addPass/removePass/setSize`；`bloom.highPassUniforms`（见 §1.1-C）；DOM；相机 |
| `src/cameras.js` | cameras agent | 同上文件清单；创建/查询/修改任何 DOM 节点（只许挂事件）；光源、材质、几何体、雾、renderer、composer；`goTo` 里的按机位 if 分支 |
| `src/ui.js` | ui agent | 同上文件清单；`import three`（一次都不许）；canvas / WebGL / 相机 / 场景 / 任何 3D 对象；**任何 pointerdown/move/up 监听**（摇杆输入归 cameras.js） |
| `src/main.js`、`index.html` | 整合者 | — |
| `legacy_v2.html` | 无人 | **任何人不得修改**。这是可回退的工作版本 |
| `vendor/**`、`tex/**` | 无人 | **任何人不得修改或新增文件** |

冲突处理：需要别人文件里的东西 → **在自己的交付说明里写清楚需求，让整合者去接**，
不要跨文件改。

---

## 7. 交付时每个 agent 必须自查的清单

- [ ] 只改了自己那一个文件，`git status` 式确认（本项目非 git，用 `ls -la src/` + 时间戳自查）
- [ ] `http://localhost:8765/` 打得开，控制台**零报错、零警告**
- [ ] 导出的函数名、参数名、返回字段名与本文档**逐字一致**（大小写、下划线都算）
- [ ] 没有引入任何 `.glb/.gltf/.fbx`、CDN、npm 依赖、新图片
- [ ] 没有 emoji、没有霓虹色、中文用衬线体
- [ ] 手机宽度（400px）下不横向滚动、不溢出
- [ ] 在交付说明里列出：**做了什么 / 与契约的任何偏差及原因 / 需要整合者接的线 / 没验证的部分**

整合者额外必须做的：
- [ ] 三套时辰 × `vista` 机位各截一张，跑 §1.3 的直方图脚本，三行都在窗内
- [ ] 四个机位各截一张，肉眼确认构图（不满意就改 §4 的 pos/target/fov，改完再截）
- [ ] 1440×900 下 fps ≥ 45，draw calls < 150
- [ ] 时辰切换的 1.5s 过渡不闪、不跳、不硬切（尤其环境贴图 k≥0.5 的硬切要看不出来）
- [ ] 预设 ↔ 自由行走来回切 5 次，视角不漂移、不翻转（YXZ 往返的验证）
