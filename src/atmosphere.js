/* ============================================================================
 * 湖心亭看雪 · src/atmosphere.js
 * 时辰系统：雾 / 光 / 环境 / 曝光 / bloom / 分级 / 雪 / 灯火，1.5s easeInOutCubic 插值
 *
 * 契约：CONTRACT.md §2.2 / §3
 *   export function createAtmosphere(THREE, scene, renderer, composer, handles)
 *     -> { setTime(name, instant), update(dt), TIMES, current(), isBlending() }
 *
 * 本文件不 import 任何东西（THREE 由参数传入），不新建几何体 / 材质 / Mesh / 光源，
 * 不碰 DOM（除 document.createElement('canvas') 做程序化环境贴图）、不碰相机，
 * renderer 上只写 toneMappingExposure 这一个属性。
 *
 * 三条实现纪律（对应 §1.1 已核实的渲染管线语义）：
 *   A. composer 缓冲区是线性 HDR，ACES + 曝光在链尾 OutputPass。
 *   B. bloom.threshold 作用在线性 HDR 值上，不随曝光缩放。
 *   C. UnrealBloomPass 每帧把 this.strength/radius/threshold 重写进 uniform，
 *      所以这里只改属性，绝不写 highPassUniforms。
 *
 * 另一条自己加的纪律：handles 里的**对象**一律原地改（copy / lerpColors /
 * lerpVectors / setRGB），只有标量才赋值。handles.sunOffset 尤其如此 ——
 * scene.js 的 update() 闭包持有那个 Vector3 的引用，一旦被替换成新对象，
 * 太阳就会静止在原地，而且没有任何报错。
 * ========================================================================== */

/* ---------------------------------------------------------------------------
 * §3 三套时辰的具体数值 —— 纯字面量表，原样照抄，不算、不推导。
 * 验收（§1.3）超窗时改的就是这张表，整合者能一行改完。
 * ------------------------------------------------------------------------- */
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
    lift:          0.045,            // 0.012 → 0.045（v4 实测）：木作在暗端被削平，
                                     // dawn/inside 的 luma≤6 死黑从 11.4% 降到 ~0。
                                     // 高光端不受影响（lift 是加性，vista p99 只 +1~2）。
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
    fogColor:      0x8f8477,          // 0xd9d3cb → 0x8f8477（整合实测）：41m 处 78% 的像素是雾色本身，
                                      // 雾色就是曝光。0xd9d3cb 让暮雪 p50=238/p99=242，既超窗又和雪晨无从分辨。
    fogDensity:    0.0260,            // 0.0300 → 0.0260：让逆光剪影和掠射高光带真的透得到 41m 外
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
    lift:          0.050,            // 0.008 → 0.050（v4 实测）：暮雪逆光下前景木构是全场
                                     // 最黑的一块（inside 20.4% / steps 14.8% 的像素 luma≤6）。
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
    hemiIntensity: 1.45,              // 0.55 → 1.45（v3 实测）：本值由 night_vista 定标，
                                      // 回退到契约初稿的 0.55 会跌破 §1.3 的 p99 ≥ 150 闸门
    sunColor:      0xbcd4f0,          // 同一盏 DirectionalLight，夜里当月光
    sunIntensity:  0.18,
    sunOffset:     [17, 23, -13],     // 仰角 47.1°，从右前上方来 → 屋脊积雪一道冷边光
    envPreset:     'night',
    envIntensity:  0.58,              // 关键：环境贴图强度必须压下来，否则冰面被泛光淹没。
                                      // 0.22 → 0.58（v3 实测：0.22 时夜雪地面 p99 只有 118，
                                      // 闸门要 ≥150）。同样别往回退。
    exposure:      1.22,
    bloomStrength: 0.85,
    bloomRadius:   0.85,
    bloomThreshold:0.40,              // 夜雪地面线性值 0.086，阈值是它的 4.6 倍 → 只有灯火会 bloom
    snowColor:     0xcfe0f2,
    snowOpacity:   0.82,
    snowSize:      0.118,
    snowDensity:   0.85,
    vignette:      0.88,
    grain:         0.014,             // 0.048 → 0.014：grade 的颗粒是加在线性 HDR 上的，
                                      // 夜雪线性值只有 0.03 量级，0.048 等于把噪声调到信号之上
    lift:          0.004,
    contrast:      1.000,             // 必须是 1.00。grade 的对比度支点写死在 0.5，
                                      // 而夜雪的线性值只有 0.086 —— 支点在它之上，
                                      // 1.10 是把暗部往下压：0.086 → 0.049 → 43/255，掉出验收窗。
    lanternEmissive: 3.2,
    lanternLight:    2.6,
    haloGain:        3.2
  }
};

/**
 * 雪晨这一套是**唯一真值源**。main.js 的 toneMappingExposure / GradeShader 初值 /
 * UnrealBloomPass 三参，以及 scene.js 的 fog / hemi / sun / environmentIntensity / snow
 * 初值，全部从这里取 —— 以前那三处各抄了一份，靠「atmosphere 万一没跑」的注释辩护，
 * 但 createAtmosphere 构造末尾无条件 applyState()+applyLanterns()，副本永远在第一帧前
 * 被覆盖：它们不是兜底，是三份会各自静默漂移的影子定标值。
 * 冻结是为了让「谁手滑改了初值」当场报错，而不是画面悄悄漂掉。
 */
export const DAWN = Object.freeze(TIMES_DATA.dawn);

/** UI 只需要 id + label；完整参数表内部私有。顺序即 UI 顺序。 */
const TIMES = Object.freeze([
  Object.freeze({ id: 'dawn',  label: '雪晨' }),
  Object.freeze({ id: 'dusk',  label: '暮雪' }),
  Object.freeze({ id: 'night', label: '夜雪' })
]);

/** 契约常量。乘出来 > 1 是故意的：Color 不钳制，线性 HDR 里的超白正是 bloom 要吃的。 */
const HALO_R = 1.0, HALO_G = 0.72, HALO_B = 0.42;

/** §2.2：过渡时长固定 1.5s。 */
const BLEND_DUR = 1.5;

/** §2.2 三套环境立方体的面色（6 面 64×64 canvas）。 */
const ENV_SPEC = {
  day:   { top: '#ffffff', bottom: '#c4ced6', side: ['#fdfeff', '#e6ecf0', '#c8d2da'] },
  dusk:  { top: '#e8e0d4', bottom: '#a09a93', side: ['#efe6d8', '#dcd6ce', '#b6b2ae'] },
  night: { top: '#2f3d4e', bottom: '#0e141b', side: ['#33404f', '#1e2a37', '#101820'] }
};

const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerp = (a, b, k) => a + (b - a) * k;


export function createAtmosphere(THREE, scene, renderer, composer, handles) {

  handles = handles || {};

  /* ---------------------------------------------------------------------
   * 后处理 pass：先读契约命名属性，读不到再退化扫 composer.passes。
   * 注意 r180 的 UnrealBloomPass **没有** isUnrealBloomPass 标志位
   * （已核实 vendor/addons/postprocessing/UnrealBloomPass.js），
   * 所以退化路径用 duck typing：认的就是本模块要写的那三个属性。
   * ------------------------------------------------------------------- */
  const passes = (composer && Array.isArray(composer.passes)) ? composer.passes : [];

  let bloomPass = (composer && composer.bloomPass) || null;
  if (!bloomPass) {
    bloomPass = passes.find(p => p && (
      p.isUnrealBloomPass === true ||
      (typeof p.strength === 'number' && typeof p.radius === 'number' &&
       typeof p.threshold === 'number' && p.highPassUniforms)
    )) || null;
  }

  let gradePass = (composer && composer.gradePass) || null;
  if (!gradePass) {
    gradePass = passes.find(p => p && p.material && p.material.name === 'HuxintingGrade') || null;
  }
  const gradeUniforms = (gradePass && gradePass.uniforms) || null;

  if (!bloomPass) console.warn('[atmosphere] 未找到 bloom pass，跳过 bloom 调制');
  if (!gradeUniforms) console.warn('[atmosphere] 未找到 grade pass，跳过分级调制');

  const SNOW_MAX = (typeof handles.SNOW_MAX === 'number' && handles.SNOW_MAX > 0)
    ? handles.SNOW_MAX : 4200;

  /* ---------------------------------------------------------------------
   * 三套环境立方体，构造时一次建好缓存，切换时只换引用。
   * ------------------------------------------------------------------- */
  function buildCube(key, size = 64) {
    const spec = ENV_SPEC[key];
    const faces = [];
    // CubeTexture 面序：[+X, -X, +Y, -Y, +Z, -Z] → 2 是顶、3 是底
    for (let f = 0; f < 6; f++) {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const g = c.getContext('2d');
      if (f === 2) { g.fillStyle = spec.top; g.fillRect(0, 0, size, size); }
      else if (f === 3) { g.fillStyle = spec.bottom; g.fillRect(0, 0, size, size); }
      else {
        const gr = g.createLinearGradient(0, 0, 0, size);
        gr.addColorStop(0, spec.side[0]);
        gr.addColorStop(0.5, spec.side[1]);
        gr.addColorStop(1, spec.side[2]);
        g.fillStyle = gr; g.fillRect(0, 0, size, size);
      }
      faces.push(c);
    }
    const t = new THREE.CubeTexture(faces);
    t.mapping = THREE.CubeReflectionMapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  }

  const ENV = { day: buildCube('day'), dusk: buildCube('dusk'), night: buildCube('night') };

  /** 已经真正写进 scene.environment 的那一套（不是"离开的那个预设"）。
   *  中途打断时的硬切起点必须是它，否则会出现 night → day → dusk 的双闪。 */
  let appliedEnv = null;
  function applyEnv(key) {
    const tex = ENV[key];
    if (!tex) return;
    if (appliedEnv === key && scene.environment === tex) return;
    scene.environment = tex;
    appliedEnv = key;
  }

  /* ---------------------------------------------------------------------
   * 插值状态：from（起点快照） / cur（当前实际值） / to（目标）三个独立对象。
   * from 必须是 cur 的**拷贝**，一旦别名到同一个对象，
   * lerpState 会边写边污染自己的起点，曲线会退化成指数衰减。
   * ------------------------------------------------------------------- */
  function makeState() {
    return {
      fogColor: new THREE.Color(), fogDensity: 0,
      hemiSky: new THREE.Color(), hemiGround: new THREE.Color(), hemiIntensity: 0,
      sunColor: new THREE.Color(), sunIntensity: 0,
      sunOffset: new THREE.Vector3(),
      envIntensity: 0,
      exposure: 1,
      bloomStrength: 0, bloomRadius: 0, bloomThreshold: 0,
      snowColor: new THREE.Color(), snowOpacity: 1, snowSize: 0.1, snowDensity: 1,
      vignette: 0, grain: 0, lift: 0, contrast: 1,
      lanternEmissive: 0, lanternLight: 0, haloGain: 0
    };
  }

  function readPreset(out, d) {
    out.fogColor.setHex(d.fogColor);
    out.fogDensity = d.fogDensity;
    out.hemiSky.setHex(d.hemiSky);
    out.hemiGround.setHex(d.hemiGround);
    out.hemiIntensity = d.hemiIntensity;
    out.sunColor.setHex(d.sunColor);
    out.sunIntensity = d.sunIntensity;
    out.sunOffset.set(d.sunOffset[0], d.sunOffset[1], d.sunOffset[2]);
    out.envIntensity = d.envIntensity;
    out.exposure = d.exposure;
    out.bloomStrength = d.bloomStrength;
    out.bloomRadius = d.bloomRadius;
    out.bloomThreshold = d.bloomThreshold;
    out.snowColor.setHex(d.snowColor);
    out.snowOpacity = d.snowOpacity;
    out.snowSize = d.snowSize;
    out.snowDensity = d.snowDensity;
    out.vignette = d.vignette;
    out.grain = d.grain;
    out.lift = d.lift;
    out.contrast = d.contrast;
    out.lanternEmissive = d.lanternEmissive;
    out.lanternLight = d.lanternLight;
    out.haloGain = d.haloGain;
    return out;
  }

  function copyState(out, s) {
    out.fogColor.copy(s.fogColor);
    out.fogDensity = s.fogDensity;
    out.hemiSky.copy(s.hemiSky);
    out.hemiGround.copy(s.hemiGround);
    out.hemiIntensity = s.hemiIntensity;
    out.sunColor.copy(s.sunColor);
    out.sunIntensity = s.sunIntensity;
    out.sunOffset.copy(s.sunOffset);
    out.envIntensity = s.envIntensity;
    out.exposure = s.exposure;
    out.bloomStrength = s.bloomStrength;
    out.bloomRadius = s.bloomRadius;
    out.bloomThreshold = s.bloomThreshold;
    out.snowColor.copy(s.snowColor);
    out.snowOpacity = s.snowOpacity;
    out.snowSize = s.snowSize;
    out.snowDensity = s.snowDensity;
    out.vignette = s.vignette;
    out.grain = s.grain;
    out.lift = s.lift;
    out.contrast = s.contrast;
    out.lanternEmissive = s.lanternEmissive;
    out.lanternLight = s.lanternLight;
    out.haloGain = s.haloGain;
    return out;
  }

  function lerpState(out, a, b, k) {
    out.fogColor.lerpColors(a.fogColor, b.fogColor, k);
    out.fogDensity = lerp(a.fogDensity, b.fogDensity, k);
    out.hemiSky.lerpColors(a.hemiSky, b.hemiSky, k);
    out.hemiGround.lerpColors(a.hemiGround, b.hemiGround, k);
    out.hemiIntensity = lerp(a.hemiIntensity, b.hemiIntensity, k);
    out.sunColor.lerpColors(a.sunColor, b.sunColor, k);
    out.sunIntensity = lerp(a.sunIntensity, b.sunIntensity, k);
    out.sunOffset.lerpVectors(a.sunOffset, b.sunOffset, k);
    out.envIntensity = lerp(a.envIntensity, b.envIntensity, k);
    out.exposure = lerp(a.exposure, b.exposure, k);
    out.bloomStrength = lerp(a.bloomStrength, b.bloomStrength, k);
    out.bloomRadius = lerp(a.bloomRadius, b.bloomRadius, k);
    out.bloomThreshold = lerp(a.bloomThreshold, b.bloomThreshold, k);
    out.snowColor.lerpColors(a.snowColor, b.snowColor, k);
    out.snowOpacity = lerp(a.snowOpacity, b.snowOpacity, k);
    out.snowSize = lerp(a.snowSize, b.snowSize, k);
    out.snowDensity = lerp(a.snowDensity, b.snowDensity, k);
    out.vignette = lerp(a.vignette, b.vignette, k);
    out.grain = lerp(a.grain, b.grain, k);
    out.lift = lerp(a.lift, b.lift, k);
    out.contrast = lerp(a.contrast, b.contrast, k);
    out.lanternEmissive = lerp(a.lanternEmissive, b.lanternEmissive, k);
    out.lanternLight = lerp(a.lanternLight, b.lanternLight, k);
    out.haloGain = lerp(a.haloGain, b.haloGain, k);
    return out;
  }

  const cur = readPreset(makeState(), TIMES_DATA.dawn);
  const from = copyState(makeState(), cur);
  const to = copyState(makeState(), cur);

  /* ---------------------------------------------------------------------
   * 写场景。对象原地改，标量赋值。
   * ------------------------------------------------------------------- */
  function applyState() {
    // 雾 + 背景（FogExp2 实例本身绝不替换）
    if (scene.fog) {
      scene.fog.color.copy(cur.fogColor);
      scene.fog.density = cur.fogDensity;
    }
    if (scene.background && scene.background.isColor) {
      scene.background.copy(cur.fogColor);
    }

    // 灯光
    const L = handles.lights || {};
    if (L.hemi) {
      L.hemi.color.copy(cur.hemiSky);
      L.hemi.groundColor.copy(cur.hemiGround);
      L.hemi.intensity = cur.hemiIntensity;
    }
    if (L.sun) {
      L.sun.color.copy(cur.sunColor);
      L.sun.intensity = cur.sunIntensity;
    }
    // 原地改：scene.js 的 update() 闭包持有这个 Vector3
    if (handles.sunOffset && handles.sunOffset.isVector3) {
      handles.sunOffset.copy(cur.sunOffset);
    }

    // 环境贴图强度（§1.1：和半球光同量级的曝光杠杆）
    scene.environmentIntensity = cur.envIntensity;

    // 曝光 —— renderer 上唯一允许写的属性
    if (renderer) renderer.toneMappingExposure = cur.exposure;

    // bloom：改属性，不写 highPassUniforms（§1.1-C）
    if (bloomPass) {
      bloomPass.strength = cur.bloomStrength;
      bloomPass.radius = cur.bloomRadius;
      bloomPass.threshold = cur.bloomThreshold;
    }

    // 分级：uniform 逐个守卫（main.js 可能还是旧版两 uniform 的 shader）
    if (gradeUniforms) {
      if (gradeUniforms.uVig) gradeUniforms.uVig.value = cur.vignette;
      if (gradeUniforms.uGrain) gradeUniforms.uGrain.value = cur.grain;
      if (gradeUniforms.uLift) gradeUniforms.uLift.value = cur.lift;
      if (gradeUniforms.uContrast) gradeUniforms.uContrast.value = cur.contrast;
    }

    // 雪
    const sm = handles.snowMaterial;
    if (sm) {
      if (sm.color) sm.color.copy(cur.snowColor);
      sm.opacity = cur.snowOpacity;
      sm.size = cur.snowSize;
    }
    const sp = handles.snowPoints;
    if (sp && sp.geometry) {
      const n = Math.max(0, Math.min(SNOW_MAX, Math.round(SNOW_MAX * cur.snowDensity)));
      if (!sp.geometry.drawRange || sp.geometry.drawRange.count !== n) {
        sp.geometry.setDrawRange(0, n);
      }
    }
  }

  /* ---------------------------------------------------------------------
   * 灯火呼吸。
   * 相位只由 update(dt) 累积，不读 performance.now()、不用 Math.random()，
   * 这样 ?shot=1 等 3 秒截图是逐帧可复现的（§1.3 的验收要靠这一点）。
   * 一盏灯的 f 同时乘到 emissive / PointLight / halo 三路，
   * 只动其中一路会读成 bug。峰值 ±8.5%，不足以让「一点」时隐时现。
   * ------------------------------------------------------------------- */
  let clock = 0;

  function flickerAt(i) {
    const ph = i * 2.1;
    return 1 + 0.055 * Math.sin(clock * 1.7 + ph) + 0.030 * Math.sin(clock * 2.9 + ph * 2.3);
  }

  /**
   * 「亭中灯火」总闸：0 = 灭，1 = 点。main.js 只写 handles.lanternGain 这一个标量，
   * 三路（emissive / PointLight / halo）在这里统一乘上去。
   * ★ 不能改成隐藏纸罩 —— 灯笼的竹骨（吊绳 / 上下两个盖 / 两道箍 / 穗子）在
   *   scene.js 里全被烘进了 P_DARK 合批网格，跟亭子一起常驻，藏掉纸罩只会剩下
   *   两组悬空的黑圆环，读起来是穿帮而不是「一盏没点的灯」。
   *   保留纸罩、只把它熄掉，才是「灯在，没点」。
   */
  function lanternGain() {
    const g = handles.lanternGain;
    return (typeof g === 'number' && isFinite(g)) ? Math.max(0, Math.min(1, g)) : 1;
  }

  function applyLanterns() {
    const arr = handles.lanterns;
    if (!arr || !arr.length) return;
    const gain = lanternGain();
    for (let i = 0; i < arr.length; i++) {
      const l = arr[i];
      if (!l) continue;
      const f = flickerAt(i) * gain;
      if (l.material) l.material.emissiveIntensity = cur.lanternEmissive * f;
      if (l.light) {
        const s = (typeof l.lightScale === 'number') ? l.lightScale : 1;
        l.light.intensity = cur.lanternLight * s * f;
      }
      if (l.halo && l.halo.material && l.halo.material.color) {
        l.halo.material.color
          .setRGB(HALO_R, HALO_G, HALO_B)
          .multiplyScalar(cur.haloGain * f);
      }
    }
  }

  /* 关灯那一帧也必须写下去，所以 gain 变化要能把 applyLanterns 再叫起来一次。
     lastGain 记住上一帧写进去的值，变了就再写一次（不然 dawn + 关灯 → 开灯，
     因为 cur.* 全是 0、lanternsLit() 为假，零值永远刷不掉）。 */
  let lastGain = 1;

  const lanternsLit = () =>
    cur.lanternEmissive > 0 || cur.lanternLight > 0 || cur.haloGain > 0;

  /* ---------------------------------------------------------------------
   * 对外接口
   * ------------------------------------------------------------------- */
  let curId = 'dawn';
  let targetEnvKey = TIMES_DATA.dawn.envPreset;
  let blending = false;
  let bt = 0;
  /* 1.5s 是对用户的时长承诺，按墙钟走，不累加钳过的 dt。
     dt 钳在 0.06：低于 ~17fps 时每帧只推进 0.06s 模拟时间，实际耗时更长 ——
     实测无头环境下 1.5s 的时辰插值整整走了 12.1 秒墙钟，逻辑没错，只是慢动作。
     注意：灯火呼吸的相位 clock 仍然按 dt 累加，?shot=1 的逐帧可复现靠的是它。 */
  const nowSec = () => (typeof performance !== 'undefined' && performance.now
    ? performance.now() : Date.now()) / 1000;
  let blendStart = 0;

  function setTime(name, instant = false) {
    const d = TIMES_DATA[name] || TIMES_DATA.dawn;
    readPreset(to, d);
    curId = d.id;
    targetEnvKey = d.envPreset;

    if (instant) {
      blending = false;
      bt = 0;
      copyState(cur, to);
      applyEnv(targetEnvKey);
      applyState();
      applyLanterns();
      return;
    }

    // 以当前插值中的实际值为新起点，重新计时 1.5s（不闪回）
    copyState(from, cur);
    blending = true;
    bt = 0;
    blendStart = nowSec();
  }

  function update(dt) {
    const d = (typeof dt === 'number' && isFinite(dt) && dt > 0) ? dt : 0;
    clock += d;

    if (blending) {
      bt = nowSec() - blendStart;
      let t = bt / BLEND_DUR;
      if (t >= 1) { t = 1; blending = false; }
      const k = easeInOutCubic(t);
      lerpState(cur, from, to, k);
      // CubeTexture 无法交叉淡入 → k ≥ 0.5 硬切；此时强度已在插值，切换看不出来
      if (k >= 0.5) applyEnv(targetEnvKey);
      applyState();
      applyLanterns();   // 结束的那一帧也会跑，保证零值被写下去之后才开始跳过
    } else if (lanternsLit() || lanternGain() !== lastGain) {
      applyLanterns();   // 只有灯亮着（或总闸刚被拨动）才写，白天完全静默
    }
    lastGain = lanternGain();
  }

  function dispose() {
    for (const k in ENV) {
      if (ENV[k] && typeof ENV[k].dispose === 'function') ENV[k].dispose();
    }
  }

  // 构造即落地一次雪晨，保证 atmosphere 与场景初值严格一致
  applyEnv(targetEnvKey);
  applyState();
  applyLanterns();

  return {
    setTime,
    update,
    TIMES,
    current: () => curId,
    isBlending: () => blending,
    dispose
  };
}
