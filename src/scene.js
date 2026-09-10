/* =============================================================================
 * src/scene.js · 湖心亭看雪 —— 几何 / 材质 / 灯具实体 / 每帧运动
 * 契约：CONTRACT.md §2.1。本文件只创建场景图，不做时辰切换、不碰 renderer 设置、
 *       不碰 DOM（document.createElement('canvas') 做程序化贴图除外）、不建相机。
 *
 * ── 屋面改型后的世界常量（CONTRACT §2.0 需要同步的三个数）────────────────────
 *   hipRoof(W=3.05, H=1.42, lift=0.34)，corner 指数 2 → 1.6
 *   ROOF_ORIGIN_Y = 4.96   （不变，= PLINTH_TOP_Y 0.62 + COL_H 2.72 + 1.62）
 *   EAVE_MID_Y    = 3.54   （旧 3.34；= 4.96 − 1.42，r = 3.05）
 *   EAVE_TIP_Y    = 3.88   （旧 3.96；= 4.96 − 1.42 + 0.34，45° 方向 r = 4.31）
 *   → 檐口抬高 0.20 米、翼角尖降低 0.08 米，起翘幅度从 0.62 收到 0.34。
 *     机位表（CONTRACT §4）的 pitch/target 需要整合者按截图微调，尤其 steps。
 *
 * ── 与契约的偏差（详见交付说明的 risks）────────────────────────────────────
 *   1. 檐灯 x 由 ±1.62 改为 ±LANTERN_X(1.02)。契约给的 ±1.62 正是 COLUMN_HALF，
 *      灯笼(r0.115) 会整个埋进柱子(r0.125~0.145)里，halo 又是 depthTest:true，
 *      夜景的「湖心亭一点」会被柱子挡掉。
 *   2. 灯台的柱身归入 dark 合批（只有灯碗是自发光 mesh），避免夜里柱身整根发光。
 * ========================================================================== */

/**
 * @param {object}  THREE
 * @param {object}  renderer
 * @param {object} [init] 雪晨初值。**唯一真值源是 atmosphere.js 的 DAWN**，
 *   main.js 负责把它传进来；不传则退回下面的字面量（与 DAWN 逐字相同，
 *   只为让 buildScene 单独跑得起来）。这些值在第一帧之前一定会被
 *   createAtmosphere 的构造期 applyState() 覆盖一次。
 */
export function buildScene(THREE, renderer, init) {

  const INIT = init || {};
  const iv = (k, d) => (INIT[k] === undefined ? d : INIT[k]);

  /* ---------------------------------------------------------------------- *
   * 0. 世界常量（CONTRACT §2.0 抄本 —— 与 cameras.js 必须逐字一致）
   * ---------------------------------------------------------------------- */
  const PLINTH_TOP_Y = 0.62;      // 台基顶面（柱脚所在平面）
  const FLOOR_Y      = 0.655;     // 亭内可站立面（台基顶的薄雪层顶面）
  const COLUMN_HALF  = 1.62;      // 四柱心距中心的半距
  const COL_H        = 2.72;      // 柱高
  const BEAM_Y       = 3.18;      // 额枋中心高度
  const ROOF_ORIGIN_Y = 4.96;     // 屋面几何原点（宝顶所在）
  const ROOF_W = 3.05, ROOF_H = 1.42, ROOF_LIFT = 0.34, ROOF_EXP = 1.6;
  const BASE_HALF    = 2.75;      // 台基外沿半宽
  const DIKE_Z       = 50.6, DIKE_HALF_W = 1.70, DIKE_TOP_Y = 0.24;
  const SNOW_MAX     = 4200;
  const SNOW_R       = 34;        // 雪的环绕半径（以相机为中心）
  const LANTERN_X    = 1.02;      // ← 偏差 1：契约写 1.62（= 柱心），会埋进柱子

  const FOG_COLOR = iv('fogColor', 0xe4eaee), FOG_DENS = iv('fogDensity', 0.0275);

  /* ---------------------------------------------------------------------- *
   * 1. 小工具
   * ---------------------------------------------------------------------- */
  // 固定种子 —— 每次刷新的陈设分布完全一致，截图才可比对
  const rng = (s => () => (s = s * 16807 % 2147483647) / 2147483647)(20260910);

  const _p = new THREE.Vector3(), _q = new THREE.Quaternion();
  const _e = new THREE.Euler(),   _s = new THREE.Vector3();
  /** 组一个变换矩阵（合批用） */
  function M(px, py, pz, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    _p.set(px, py, pz); _e.set(rx, ry, rz); _q.setFromEuler(_e); _s.set(sx, sy, sz);
    return new THREE.Matrix4().compose(_p, _q, _s);
  }

  /**
   * 手工合并同材质的小件（vendor/addons 里没有 BufferGeometryUtils）。
   * parts: [ [geometry, Matrix4], ... ]  →  一个带 position/normal/uv 的索引几何体。
   * 上一版亭子光「挂落」就有 44 个 mesh，全场 100+ draw call、17fps。
   */
  function mergeParts(parts) {
    let vTotal = 0, iTotal = 0;
    const prepped = parts.map(([geo, m]) => {
      const g = geo.clone();
      if (m) g.applyMatrix4(m);
      if (!g.attributes.normal) g.computeVertexNormals();
      const n = g.attributes.position.count;
      if (!g.attributes.uv)
        g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
      if (!g.index) {
        const a = new Uint32Array(n);
        for (let i = 0; i < n; i++) a[i] = i;
        g.setIndex(new THREE.BufferAttribute(a, 1));
      }
      vTotal += n; iTotal += g.index.count;
      return g;
    });
    const pos = new Float32Array(vTotal * 3);
    const nrm = new Float32Array(vTotal * 3);
    const uvs = new Float32Array(vTotal * 2);
    const idx = new Uint32Array(iTotal);
    let vo = 0, io = 0;
    for (const g of prepped) {
      pos.set(g.attributes.position.array, vo * 3);
      nrm.set(g.attributes.normal.array,   vo * 3);
      uvs.set(g.attributes.uv.array,       vo * 2);
      const gi = g.index.array;
      for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
      vo += g.attributes.position.count; io += gi.length;
      g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal',   new THREE.BufferAttribute(nrm, 3));
    out.setAttribute('uv',       new THREE.BufferAttribute(uvs, 2));
    out.setIndex(new THREE.BufferAttribute(idx, 1));
    out.computeBoundingSphere();
    return out;
  }

  /* ---------------------------------------------------------------------- *
   * 2. 贴图加载（自己计数，不依赖 LoadingManager.onLoad：whenReady 需要 6s 超时兜底，
   *    onLoad 给不了；而且 onLoad 在「一张都没请求成功」时根本不触发）
   * ---------------------------------------------------------------------- */
  const loadingManager = new THREE.LoadingManager();
  const loader = new THREE.TextureLoader(loadingManager).setPath('./tex/');
  const MAXA = (renderer && renderer.capabilities && renderer.capabilities.getMaxAnisotropy)
    ? renderer.capabilities.getMaxAnisotropy() : 4;

  let pending = 1;                       // 1 = 「尚未发完全部请求」的哨兵
  let readyFired = false;
  const readyCbs = [];
  function fireReady() {
    if (readyFired) return;
    readyFired = true;
    const list = readyCbs.splice(0);
    for (const cb of list) { try { cb(); } catch (err) { console.warn('[scene] whenReady:', err); } }
  }
  function settle() { if (--pending <= 0) fireReady(); }
  /** 契约扩展：贴图到齐或 6s 超时后调一次 cb（只调一次） */
  function whenReady(cb) {
    if (typeof cb !== 'function') return;
    if (readyFired) cb(); else readyCbs.push(cb);
  }
  setTimeout(fireReady, 6000);           // 贴图没到齐也要让人能进场

  function tex(file, { srgb = false, repeat = 1 } = {}) {
    pending++;
    const t = loader.load(file, settle, undefined, () => {
      console.warn('[scene] 贴图加载失败：', file); settle();
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.anisotropy = MAXA;
    t.channel = 0;                       // aoMap 也走 uv 通道 0（r180 默认值，写明以防手滑）
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  function pbr(slot, repeat, opts = {}) {
    return new THREE.MeshStandardMaterial(Object.assign({
      map:          tex(`${slot}_col.jpg`, { srgb: true, repeat }),
      normalMap:    tex(`${slot}_nrm.jpg`, { repeat }),
      roughnessMap: tex(`${slot}_rgh.jpg`, { repeat }),
      metalness: 0.0
    }, opts));
  }

  /* ---------------------------------------------------------------------- *
   * 3. 程序化 canvas 贴图
   * ---------------------------------------------------------------------- */

  /** 干净的雪地漫反射：多层正弦叠加（整数频率 ⇒ 无缝），蓝白低对比，无泥污。
   *  ★ 这张图的数值就是全场曝光标定的锚点（雪晨地面线性漫反射 ≈ 0.782），一格都不要调亮。 */
  function cleanSnowDiffuse(size = 512) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d'); const img = g.createImageData(size, size);
    const T = Math.PI * 2 / size;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let v = Math.sin(x * T * 2 + Math.cos(y * T * 3) * 1.9) * 0.42
            + Math.sin(y * T * 3 + Math.cos(x * T * 2) * 1.5) * 0.30
            + Math.sin((x + y) * T * 7)  * 0.16
            + Math.sin((x - y) * T * 13) * 0.09
            + Math.sin(x * T * 23 + y * T * 19) * 0.05;
      v = v * 0.5 + 0.5;
      const i = (y * size + x) * 4;
      img.data[i]     = 232 + v * 20;    // 极低对比，偏冷
      img.data[i + 1] = 238 + v * 17;
      img.data[i + 2] = 244 + v * 11;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = MAXA;
    return t;
  }

  /** 屋面积雪的斑驳遮罩。
   *  ★ three 的 alphaMap 取的是 **绿通道**（alphamap_fragment: texture2D(alphaMap,uv).g），
   *    旧版把值写进 alpha 通道、RGB 恒为 255 ⇒ 遮罩全 1，等于没生效（积雪是死板一整层）。
   *    这里写进 RGB。同时 repeat 必须是 (1,1)：cap 的 uv 本身已经张到 (0..6, 0..2.2)，
   *    再乘 3 就是 18×6.6 铺 —— 那是电视雪花不是积雪。 */
  function patchAlpha(size = 256) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d'); const img = g.createImageData(size, size);
    const T = Math.PI * 2 / size;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let v = Math.sin(x * T * 4 + Math.cos(y * T * 3) * 2.1) * 0.5
            + Math.sin(y * T * 6 + Math.cos(x * T * 5) * 1.4) * 0.3
            + Math.sin((x + y) * T * 9) * 0.2;
      v = Math.max(0, Math.min(1, v * 0.9 + 0.52));
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v * 255;   // ← 绿通道
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 1);
    return t;
  }

  /** 枯苇遮罩：上端参差渐隐（同样写绿通道）。配 alphaTest，不进透明队列。 */
  function reedAlpha(w = 32, h = 128) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); const img = g.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      const v = 1 - y / (h - 1);                       // flipY ⇒ canvas 顶行是 v=1（苇尖）
      for (let x = 0; x < w; x++) {
        const u = x / (w - 1);
        const n = 0.5 + 0.5 * Math.sin(x * 0.9 + Math.cos(x * 0.37) * 2.0);
        const start = 0.30 + n * 0.34;                 // 每根（每列）断在不同高度 ⇒ 参差
        let a = v <= start ? 1 : 1 - (v - start) / Math.max(1e-3, 1 - start);
        a *= Math.min(1, (0.5 - Math.abs(u - 0.5)) / 0.16);   // 两侧边缘收一点
        a = Math.max(0, Math.min(1, a));
        const i = (y * w + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = a * 255;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  }

  /** 雪粒 sprite */
  function flakeTex() {
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.45, 'rgba(255,255,255,.7)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
    return new THREE.CanvasTexture(c);
  }

  /** 灯火光晕：32×32 径向渐变，stop(0)=1 / stop(.35)=.55 / stop(1)=0（契约 §2.1） */
  function haloTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.35, 'rgba(255,255,255,.55)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
    return new THREE.CanvasTexture(c);
  }

  /* 这里原来还有一个 dayEnv()：六面 64×64、色值和 atmosphere.js 的 ENV_SPEC.day
     逐字相同的第二份抄本。createAtmosphere 的构造末尾无条件 applyEnv('day')，
     中间不跑任何一帧，所以它造出来就被顶掉、从没上过 GPU —— 不是兜底，
     是一份会静默漂移的影子定标值。整个删掉，scene.environment 交给 atmosphere。 */

  /* ---------------------------------------------------------------------- *
   * 4. 材质
   * ---------------------------------------------------------------------- */
  /* snow_nrm.jpg（1.08 MB，tex/ 里最大的一张）和 snow_rgh.jpg（146 KB）
     冰面和积雪各要一份，区别只有 repeat（180 vs 3）。
     vendor/three.core.js 的 Cache.enabled = false，TextureLoader 不去重，
     两次 load 就是两个独立 Source：两次解码 + 两次 GPU 上传 + 两格 pending，
     白花约 1.2 MB，还把入场闸门的开闸时间往后拖。
     repeat/offset 挂在 Texture 上、像素挂在 Source 上，所以 clone() 正好
     共享 Source 又各留各的 repeat —— 冰面每帧漂的 offset 也不会污染积雪。 */
  const snowNrm = tex('snow_nrm.jpg', { repeat: 3 });
  const snowRgh = tex('snow_rgh.jpg', { repeat: 3 });
  const iceNrmTex = snowNrm.clone(); iceNrmTex.repeat.set(180, 180); iceNrmTex.needsUpdate = true;
  const iceRghTex = snowRgh.clone(); iceRghTex.repeat.set(180, 180); iceRghTex.needsUpdate = true;

  const materials = {
    // 冰面：拿 snow 的法线/粗糙度做细节，漫反射换成程序化的干净雪色。
    // snow 原始漫反射自带泥污，铺在雪湖上是一片脏斑；删掉又会死白一块（平光下法线读不出）。
    ice: (() => {
      const diffuse = cleanSnowDiffuse();
      diffuse.repeat.set(20, 20);            // 法线每 3.3m 一铺，漫反射每 30m 一铺
      return new THREE.MeshStandardMaterial({ // 不走 pbr()：snow_col 根本不用，别白下载一张
        color: 0xe9f1f6, roughness: 0.50, metalness: 0.0,
        map: diffuse,
        normalMap:    iceNrmTex,
        roughnessMap: iceRghTex,
        normalScale: new THREE.Vector2(1.7, 1.7)
      });
    })(),
    stone: pbr('stone', 6, { color: 0xb9c0c6, roughness: 1.00 }),
    // 0x6b564b → 0xa8968a（v4 实测）：wood_col 本身线性均值只有 (0.087,0.068,0.049)，
    // 再乘 0x6b564b 的 (0.152,0.095,0.070)，有效反照率只剩 1.3% —— 比木炭还黑。
    // 全部木作（四柱/额枋/挂落/斗拱/栏杆/船体）压成黑剪影，贴图与法线一概读不出。
    // 这和上一行 roof 犯过、已修的是同一个错，只是没人回头看柱子。
    wood:  pbr('wood',  2, { color: 0xa8968a, roughness: 1.00 }),
    // 旧版 0x8f98a1 叠 roof_col 之后整体接近纯黑，瓦垄完全读不出（见 shots/03_v2_近景.png）
    roof:  pbr('roof',  4, {
      color: 0xb0b6bc, roughness: 0.95, side: THREE.DoubleSide,
      aoMap: tex('roof_ao.jpg', { repeat: 4 }), aoMapIntensity: 0.55
    }),
    // 不走 pbr()：法线/粗糙度复用上面那两张，只补一张 snow_col
    snow:  new THREE.MeshStandardMaterial({
      color: 0xf4f8fa, roughness: 0.86, metalness: 0.0,
      map: tex('snow_col.jpg', { srgb: true, repeat: 3 }),
      normalMap: snowNrm, roughnessMap: snowRgh
    }),
    dark:  new THREE.MeshStandardMaterial({ color: 0x2c3238, roughness: 0.90, metalness: 0.0 }),
    reed:  null,          // ↓ 需要 alphaMap，下面单独建
    iceShard: null, roofSnowCap: null,
    boatHull: null, boatCabin: null, dikeTop: null, dikeSide: null
  };

  materials.reed = new THREE.MeshStandardMaterial({
    color: 0x6d6353, roughness: 0.95, metalness: 0.0,
    side: THREE.DoubleSide,
    alphaMap: reedAlpha(), alphaTest: 0.35     // 不透明队列 + 逐片元裁剪，阴影也吃 alphaTest
  });

  // 碎冰：借 snow(repeat 3) 的法线/粗糙度。借 ice 的会是 repeat 180 铺在 0.5m 的薄片上 —— 纯噪点
  materials.iceShard = new THREE.MeshStandardMaterial({
    color: 0xe2eaf0, roughness: 0.42, metalness: 0.0,
    normalMap: materials.snow.normalMap,
    roughnessMap: materials.snow.roughnessMap,
    normalScale: new THREE.Vector2(0.5, 0.5)
  });

  materials.roofSnowCap = new THREE.MeshStandardMaterial({
    color: 0xf6fafc, roughness: 0.85, metalness: 0.0,
    alphaMap: patchAlpha(), transparent: true, side: THREE.DoubleSide,
    normalMap: materials.snow.normalMap, normalScale: new THREE.Vector2(0.4, 0.4),
    polygonOffset: true, polygonOffsetFactor: -1      // 与屋面 z-fighting 的保险
  });

  // 契约要求这四个是独立引用（atmosphere / 整合者可以单独调），所以从基材质克隆
  materials.boatHull  = materials.wood.clone();
  materials.boatCabin = materials.wood.clone();
  materials.dikeTop   = materials.snow.clone();
  materials.dikeSide  = materials.stone.clone();

  /* ---------------------------------------------------------------------- *
   * 5. 场景 / 光 / 环境（雪晨初值 —— atmosphere 万一没跑，画面仍是标定过的那一套）
   * ---------------------------------------------------------------------- */
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(FOG_COLOR);
  scene.fog = new THREE.FogExp2(FOG_COLOR, FOG_DENS);
  // scene.environment 交给 atmosphere：它的构造期 applyEnv() 会在第一帧前写进来
  scene.environmentIntensity = iv('envIntensity', 0.55);   // 和半球光同量级的曝光杠杆

  const hemi = new THREE.HemisphereLight(
    iv('hemiSky', 0xf2f7fa), iv('hemiGround', 0x9fadb8), iv('hemiIntensity', 0.95));
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(iv('sunColor', 0xfff4e6), iv('sunIntensity', 0.85));
  const SUN_OFF = iv('sunOffset', [-14, 17, 11]);
  const sunOffset = new THREE.Vector3(SUN_OFF[0], SUN_OFF[1], SUN_OFF[2]);
  sun.position.copy(sunOffset);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;    sun.shadow.camera.far    = 90;
  sun.shadow.camera.left = -22;  sun.shadow.camera.right  = 22;
  sun.shadow.camera.top  =  22;  sun.shadow.camera.bottom = -22;
  sun.shadow.bias = -0.0016;     sun.shadow.normalBias = 0.03;
  scene.add(sun);
  scene.add(sun.target);

  /* ---------------------------------------------------------------------- *
   * 6. 冰面
   * ---------------------------------------------------------------------- */
  // 1.6m 眼高的掠射角下，平面 + 法线贴图几乎读不出细节（法线被压进几行像素，mip 一平均就没了）。
  // 雪地的形体感必须来自真实的顶点起伏。
  const ICE_SEG = 150, ICE_SIZE = 260;

  /** 冰面世界坐标高度。平面在局部 XY 面位移 Z，再绕 X 转 −90° ⇒ 局部 y = −世界 z。
   *  照抄公式而不换号，第 2、3 项会整体错位（碎冰会一半埋进雪里、一半浮空）。 */
  const iceH = (X, Z) =>
      Math.sin(X * 0.085) * Math.cos(Z * 0.071) * 0.085     // 大尺度雪垄
    + Math.sin(X * 0.24 - Z * 0.19) * 0.040
    - Math.sin(X * 0.62) * Math.sin(Z * 0.55) * 0.018;      // 细碎起伏

  const iceGeo = new THREE.PlaneGeometry(ICE_SIZE, ICE_SIZE, ICE_SEG, ICE_SEG);
  {
    const pa = iceGeo.attributes.position;
    for (let i = 0; i < pa.count; i++) {
      const x = pa.getX(i), y = pa.getY(i);
      pa.setZ(i, Math.sin(x * 0.085) * Math.cos(y * 0.071) * 0.085
               + Math.sin(x * 0.24 + y * 0.19) * 0.040
               + Math.sin(x * 0.62) * Math.sin(y * 0.55) * 0.018);
    }
    iceGeo.computeVertexNormals();
  }
  const iceMesh = new THREE.Mesh(iceGeo, materials.ice);
  iceMesh.rotation.x = -Math.PI / 2;
  iceMesh.receiveShadow = true;
  scene.add(iceMesh);

  // 远景补一张大平面盖住边缘（雾里看不见接缝）。
  // ★ y 必须低于近场起伏的最低点（−0.143），否则它会盖掉约四成的雪垄凹处 ——
  //   150×150 的细分就白做了，还附赠一圈 z-fighting。
  const iceFar = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), materials.ice);
  iceFar.rotation.x = -Math.PI / 2;
  iceFar.position.y = -0.18;
  scene.add(iceFar);

  /* ---------------------------------------------------------------------- *
   * 7. 湖心亭
   * ---------------------------------------------------------------------- */

  /** 四角攒尖顶参数曲面。u 沿坡（0 = 宝顶，1 = 檐口），th 绕一圈。 */
  function hipRoof(W, H, lift, segU = 18, segT = 80) {
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= segU; i++) {
      const u = i / segU;
      for (let j = 0; j <= segT; j++) {
        const th = (j / segT) * Math.PI * 2;
        const ca = Math.abs(Math.cos(th)), sa = Math.abs(Math.sin(th));
        const rEave = W / Math.max(ca, sa);
        // ★ Math.max(0, …)：th=0 时浮点噪声可能给出 −1e−16，pow(负, 1.6) = NaN = 屋顶破洞
        const corner = Math.max(0, (ca + sa - 1) / (Math.SQRT2 - 1));
        const zEave = -H + lift * Math.pow(corner, ROOF_EXP);
        const r = u * rEave;
        pos.push(r * Math.cos(th), zEave * (1 - Math.pow(1 - u, 2.2)), r * Math.sin(th));
        uv.push(j / segT * 6, u * 2.2);              // 沿坡度铺瓦
      }
    }
    for (let i = 0; i < segU; i++) for (let j = 0; j < segT; j++) {
      const a = i * (segT + 1) + j, b = a + segT + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  }

  /** 屋面某方向、某半径处的高度（相对 ROOF_ORIGIN_Y），用来给垂脊/斗拱找净空 */
  function roofYAt(th, r) {
    const ca = Math.abs(Math.cos(th)), sa = Math.abs(Math.sin(th));
    const rEave = ROOF_W / Math.max(ca, sa);
    const corner = Math.max(0, (ca + sa - 1) / (Math.SQRT2 - 1));
    const zEave = -ROOF_H + ROOF_LIFT * Math.pow(corner, ROOF_EXP);
    const u = Math.min(1, r / rEave);
    return zEave * (1 - Math.pow(1 - u, 2.2));
  }

  /** 垂脊：沿真实屋面曲线扫出的梯形截面小梁。
   *  旧版拿一根直 Box 斜着摆，中段会离屋面浮起 0.3 米。 */
  function hipRidgeGeo(th, halfW = 0.055, halfH = 0.055, u0 = 0.05, u1 = 1.03, seg = 22, yShift = 0) {
    const dirX = Math.cos(th), dirZ = Math.sin(th);
    const perpX = -Math.sin(th), perpZ = Math.cos(th);
    const ca = Math.abs(Math.cos(th)), sa = Math.abs(Math.sin(th));
    const rEave = ROOF_W / Math.max(ca, sa);
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= seg; i++) {
      const u = u0 + (u1 - u0) * (i / seg);
      const r = u * rEave;
      const cy = roofYAt(th, r) + halfH * 0.55 + yShift;
      const cx = dirX * r, cz = dirZ * r;
      const ring = [
        [cx + perpX * halfW,        cy - halfH, cz + perpZ * halfW],
        [cx + perpX * halfW * 0.55, cy + halfH, cz + perpZ * halfW * 0.55],
        [cx - perpX * halfW * 0.55, cy + halfH, cz - perpZ * halfW * 0.55],
        [cx - perpX * halfW,        cy - halfH, cz - perpZ * halfW]
      ];
      for (let k = 0; k < 4; k++) { pos.push(ring[k][0], ring[k][1], ring[k][2]); uv.push(u * 3, k / 3); }
    }
    for (let i = 0; i < seg; i++) for (let k = 0; k < 4; k++) {
      const a = i * 4 + k, b = i * 4 + (k + 1) % 4, c = (i + 1) * 4 + (k + 1) % 4, d = (i + 1) * 4 + k;
      idx.push(a, c, b, a, d, c);           // 这个绕序法线朝外，反了整根脊会消失
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  }

  const pavilion = new THREE.Group();
  const P_STONE = [], P_WOOD = [], P_SNOW = [], P_DARK = [];
  const put = (bucket, geo, m) => bucket.push([geo, m]);

  /* 台基 · 踏跺 */
  put(P_STONE, new THREE.BoxGeometry(BASE_HALF * 2, 0.34, BASE_HALF * 2), M(0, 0.17, 0));
  put(P_STONE, new THREE.BoxGeometry(4.70, 0.30, 4.70), M(0, 0.49, 0));
  // 台基上的一层薄雪：顶面正好落在 FLOOR_Y
  put(P_SNOW,  new THREE.BoxGeometry(4.72, 0.04, 4.72), M(0, FLOOR_Y - 0.02, 0));
  for (let s = 0; s < 3; s++) {
    const z = 2.75 + (2 - s) * 0.34, y = 0.08 + s * 0.16;
    put(P_STONE, new THREE.BoxGeometry(2.00, 0.16, 0.34), M(0, y, z));
    put(P_SNOW,  new THREE.BoxGeometry(1.96, 0.03, 0.30), M(0, y + 0.095, z));   // 阶上薄雪
  }

  /* 柱 · 柱础 */
  {
    const colGeo = new THREE.CylinderGeometry(0.125, 0.145, COL_H, 16);
    const bsGeo  = new THREE.CylinderGeometry(0.20, 0.22, 0.13, 16);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      put(P_WOOD,  colGeo, M(sx * COLUMN_HALF, PLINTH_TOP_Y + COL_H / 2, sz * COLUMN_HALF));
      put(P_STONE, bsGeo,  M(sx * COLUMN_HALF, PLINTH_TOP_Y + 0.065,     sz * COLUMN_HALF));
    }
  }

  /* 额枋 */
  for (const sz of [-1, 1])
    put(P_WOOD, new THREE.BoxGeometry(COLUMN_HALF * 2 + 0.32, 0.20, 0.15), M(0, BEAM_Y, sz * COLUMN_HALF));
  for (const sx of [-1, 1])
    put(P_WOOD, new THREE.BoxGeometry(0.15, 0.20, COLUMN_HALF * 2 + 0.32), M(sx * COLUMN_HALF, BEAM_Y, 0));

  /* 挂落：额枋下的一排短棂条 */
  {
    const fx = new THREE.BoxGeometry(0.05, 0.24, 0.05);
    for (const sz of [-1, 1]) for (let k = -5; k <= 5; k++)
      put(P_WOOD, fx, M(k * 0.29, BEAM_Y - 0.22, sz * COLUMN_HALF));
    for (const sx of [-1, 1]) for (let k = -5; k <= 5; k++)
      put(P_WOOD, fx, M(sx * COLUMN_HALF, BEAM_Y - 0.22, k * 0.29));
  }

  /* 斗拱：一斗三升。额枋顶 3.28 起，收在 3.61 —— 柱头处屋面底在 3.81，净空 0.20 */
  {
    const y0 = BEAM_Y + 0.10;
    const luDou = new THREE.BoxGeometry(0.30, 0.13, 0.30);
    const gongA = new THREE.BoxGeometry(0.68, 0.10, 0.12);
    const gongB = new THREE.BoxGeometry(0.12, 0.10, 0.68);
    const sanDou = new THREE.BoxGeometry(0.13, 0.10, 0.13);
    const seats = [];                                      // 四角柱头铺作 + 四面补间铺作
    for (const sx of [-1, 0, 1]) for (const sz of [-1, 0, 1]) {
      if (sx === 0 && sz === 0) continue;                  // 正中没有柱子
      seats.push([sx * COLUMN_HALF, sz * COLUMN_HALF]);
    }
    for (const [x, z] of seats) {
      put(P_WOOD, luDou,  M(x, y0 + 0.065, z));
      put(P_WOOD, gongA,  M(x, y0 + 0.180, z));
      put(P_WOOD, gongB,  M(x, y0 + 0.180, z));
      for (const [ox, oz] of [[0.29, 0], [-0.29, 0], [0, 0.29], [0, -0.29]])
        put(P_WOOD, sanDou, M(x + ox, y0 + 0.275, z + oz));
    }
  }

  /* 栏杆 + 望柱 + 栏杆积雪（+Z 一面留空做踏跺出入口） */
  {
    const railY = PLINTH_TOP_Y + 0.52;
    const sides = [[0, -COLUMN_HALF, COLUMN_HALF * 2, 0.08],
                   [-COLUMN_HALF, 0, 0.08, COLUMN_HALF * 2],
                   [ COLUMN_HALF, 0, 0.08, COLUMN_HALF * 2]];
    for (const [x, z, w, d] of sides) {
      put(P_WOOD, new THREE.BoxGeometry(w, 0.08, d), M(x, railY, z));
      put(P_SNOW, new THREE.BoxGeometry(w * 0.98, 0.035, d * 0.98), M(x, railY + 0.058, z));
      put(P_WOOD, new THREE.BoxGeometry(w, 0.06, d), M(x, railY - 0.30, z));
      put(P_WOOD, new THREE.BoxGeometry(0.09, 0.60, 0.09), M(x, FLOOR_Y + 0.30, z));   // 望柱
      put(P_SNOW, new THREE.BoxGeometry(0.10, 0.03, 0.10), M(x, FLOOR_Y + 0.615, z));
    }
  }

  /* 亭中陈设：一石桌两石凳（「铺毡对坐」），桌上一壶两盏 */
  {
    const TX = -0.42, TZ = -0.10;
    put(P_STONE, new THREE.CylinderGeometry(0.40, 0.40, 0.07, 20), M(TX, 1.055, TZ));   // 桌面
    put(P_STONE, new THREE.CylinderGeometry(0.13, 0.17, 0.375, 12), M(TX, 0.8425, TZ)); // 桌腿
    put(P_STONE, new THREE.CylinderGeometry(0.26, 0.30, 0.06, 16),  M(TX, 0.685, TZ));  // 桌础
    const stoolGeo = new THREE.CylinderGeometry(0.185, 0.205, 0.40, 14);
    const feltGeo  = new THREE.CylinderGeometry(0.175, 0.175, 0.022, 14);
    for (const dx of [-0.74, 0.74]) {
      put(P_STONE, stoolGeo, M(TX + dx, FLOOR_Y + 0.20, TZ));
      put(P_DARK,  feltGeo,  M(TX + dx, 1.066, TZ));                                    // 毡
    }
    put(P_DARK, new THREE.CylinderGeometry(0.055, 0.065, 0.10, 10), M(TX - 0.06, 1.140, TZ + 0.02));
    put(P_DARK, new THREE.CylinderGeometry(0.030, 0.055, 0.03, 10), M(TX - 0.06, 1.205, TZ + 0.02));
    put(P_DARK, new THREE.CylinderGeometry(0.030, 0.024, 0.032, 8), M(TX + 0.20, 1.106, TZ - 0.12));
    put(P_DARK, new THREE.CylinderGeometry(0.030, 0.024, 0.032, 8), M(TX + 0.19, 1.106, TZ + 0.14));
  }

  /* 屋面 + 屋面积雪 */
  const roofMesh = new THREE.Mesh(hipRoof(ROOF_W, ROOF_H, ROOF_LIFT), materials.roof);
  roofMesh.position.y = ROOF_ORIGIN_Y;
  roofMesh.castShadow = true; roofMesh.receiveShadow = true;
  pavilion.add(roofMesh);

  const roofCap = new THREE.Mesh(hipRoof(3.075, 1.415, 0.345), materials.roofSnowCap);
  roofCap.position.y = ROOF_ORIGIN_Y + 0.014;
  roofCap.castShadow = false;                 // 斑驳的一层雪不该投出实心影子，屋面自己投
  roofCap.receiveShadow = true;
  pavilion.add(roofCap);

  /* 椽：从宝顶放射到檐口，贴在屋面之下。
   * 屋面底面的光 100% 是间接光（半球光的 groundColor + 环境贴图的 −Y 面），
   * 一整片朝下的法线拿到的是同一个值 ⇒ steps 机位下屋顶就是一大块死黑。
   * 椽子的侧面是水平法线（半球光取 mix 的中点，比朝下亮得多），
   * 一根根排过去，暗部才有结构。这不是装饰，是把 30% 的画面从死黑里救回来。 */
  {
    const NR = 56;                                   // 6.43° 一根，檐口间距约 0.34m
    for (let k = 0; k < NR; k++)
      put(P_WOOD, hipRidgeGeo((k + 0.5) * Math.PI * 2 / NR,   // +0.5 让开四条垂脊
                              0.028, 0.030, 0.12, 1.0, 8, -0.075),
          M(0, ROOF_ORIGIN_Y, 0));
  }

  /* 封檐板：屋面是零厚度曲面，檐口会薄得像纸。挂一圈 7.5cm 的板，
   * 顺带给远眺时的剪影描一道边（vista 的「一点」靠的就是这条边）。 */
  {
    const drop = 0.075, segT = 80, pos = [], uv = [], idx = [];
    for (let j = 0; j <= segT; j++) {
      const th = (j / segT) * Math.PI * 2;
      const ca = Math.abs(Math.cos(th)), sa = Math.abs(Math.sin(th));
      const rEave = ROOF_W / Math.max(ca, sa);
      const y = roofYAt(th, rEave);
      const x = rEave * Math.cos(th), z = rEave * Math.sin(th);
      pos.push(x, y, z, x, y - drop, z);
      uv.push(j / segT * 8, 1, j / segT * 8, 0);
    }
    for (let j = 0; j < segT; j++) {
      const t0 = j * 2, b0 = t0 + 1, t1 = t0 + 2, b1 = t0 + 3;
      idx.push(t0, b1, b0, t0, t1, b1);              // 法线朝外
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    put(P_DARK, g, M(0, ROOF_ORIGIN_Y, 0));
  }

  /* 垂脊 ×4 + 宝顶 */
  for (let k = 0; k < 4; k++)
    put(P_DARK, hipRidgeGeo(Math.PI / 4 + k * Math.PI / 2), M(0, ROOF_ORIGIN_Y, 0));
  put(P_DARK, new THREE.CylinderGeometry(0.10, 0.30, 0.26, 16), M(0, ROOF_ORIGIN_Y - 0.16, 0));
  put(P_DARK, new THREE.SphereGeometry(0.145, 18, 14),          M(0, ROOF_ORIGIN_Y + 0.02, 0));
  put(P_DARK, new THREE.SphereGeometry(0.055, 12, 10),          M(0, ROOF_ORIGIN_Y + 0.185, 0));

  /* ---------------------------------------------------------------------- *
   * 8. 灯具（scene 建，atmosphere 点）
   * ---------------------------------------------------------------------- */
  const haloTex = haloTexture();
  /* 0.055 → 0.016（整合实测）：sizeAttenuation=false 时屏高占比 = scale / tan(fov/2) / 2，
     fov 34 的 vista 下 0.055 是 65px 的实心白团，两盏并排把整座亭子吞掉。
     0.016 约 19px：一个亮核，外面的光晕交给 bloom（夜雪 threshold 0.40 / strength 0.85）去铺。 */
  const HALO_SCALE = 0.016;
  const lanterns = [];

  function makeHalo(pos) {
    // 每盏灯必须有独立 SpriteMaterial：update() 按各自距离写 opacity，
    // atmosphere 按各自写 color。共用一份的话三盏会互相覆盖。
    const mat = new THREE.SpriteMaterial({
      map: haloTex, color: new THREE.Color(0, 0, 0),
      blending: THREE.AdditiveBlending, transparent: true,
      depthWrite: false, depthTest: true, fog: false, opacity: 1
    });
    mat.sizeAttenuation = false;      // 光晕在任何距离都占屏高的固定比例
    const sp = new THREE.Sprite(mat);
    sp.scale.setScalar(HALO_SCALE);
    sp.position.copy(pos);
    sp.renderOrder = 4;
    return sp;
  }
  function lanternMaterial() {
    return new THREE.MeshStandardMaterial({
      color: 0x3a2a1c, roughness: 0.85, metalness: 0.0,
      emissive: new THREE.Color(0xffb877), emissiveIntensity: 0    // 白天不亮
    });
  }

  /* 檐灯 ×2：竹骨（dark 合批）+ 半透纸罩（LatheGeometry 纺锤）+ 吊绳 */
  {
    const prof = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      prof.push(new THREE.Vector2(0.028 + Math.sin(t * Math.PI) * 0.087, -0.12 + t * 0.24));
    }
    const shadeGeo = new THREE.LatheGeometry(prof, 14);
    const cordGeo  = new THREE.CylinderGeometry(0.008, 0.008, 0.44, 6);
    const capGeo   = new THREE.CylinderGeometry(0.035, 0.035, 0.022, 10);
    const hoopGeo  = new THREE.TorusGeometry(0.112, 0.006, 5, 18);
    const tasGeo   = new THREE.CylinderGeometry(0.007, 0.004, 0.085, 5);

    for (const [id, sx] of [['eaveL', -1], ['eaveR', 1]]) {
      const x = sx * LANTERN_X, y = 2.60, z = COLUMN_HALF;
      const worldPos = new THREE.Vector3(x, y, z);

      const mat = lanternMaterial();
      const mesh = new THREE.Mesh(shadeGeo, mat);
      mesh.position.copy(worldPos);
      pavilion.add(mesh);

      put(P_DARK, cordGeo, M(x, 2.96, z));                       // 吊绳 y3.18 → y2.74
      put(P_DARK, capGeo,  M(x, y + 0.125, z));
      put(P_DARK, capGeo,  M(x, y - 0.125, z));
      put(P_DARK, hoopGeo, M(x, y + 0.052, z, Math.PI / 2, 0, 0));
      put(P_DARK, hoopGeo, M(x, y - 0.052, z, Math.PI / 2, 0, 0));
      put(P_DARK, tasGeo,  M(x, y - 0.180, z));

      const halo = makeHalo(worldPos);
      pavilion.add(halo);

      let light = null;
      if (id === 'eaveR') {
        light = new THREE.PointLight(0xffb877, 0, 11, 2);
        light.position.copy(worldPos);
        pavilion.add(light);
      }
      lanterns.push({ id, mesh, material: mat, halo, light, lightScale: 1.00, worldPos });
    }
  }

  /* 亭中灯台：柱身归 dark（不然夜里整根柱子发光），只有灯碗是自发光 mesh */
  {
    const x = 0.42, z = -0.55;
    const worldPos = new THREE.Vector3(x, 0.94, z);
    put(P_DARK, new THREE.CylinderGeometry(0.05, 0.05, 0.30, 10), M(x, FLOOR_Y + 0.15, z));
    put(P_DARK, new THREE.CylinderGeometry(0.09, 0.10, 0.025, 12), M(x, FLOOR_Y + 0.0125, z));

    const mat = lanternMaterial();
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 10), mat);
    mesh.position.copy(worldPos);
    pavilion.add(mesh);

    const halo = makeHalo(worldPos);
    pavilion.add(halo);

    const light = new THREE.PointLight(0xffb877, 0, 11, 2);
    light.position.copy(worldPos);
    pavilion.add(light);

    lanterns.push({ id: 'lamp', mesh, material: mat, halo, light, lightScale: 0.55, worldPos });
  }

  /* 亭子的四份合批 */
  for (const [parts, mat] of [[P_STONE, materials.stone], [P_WOOD, materials.wood],
                              [P_SNOW, materials.snow],   [P_DARK, materials.dark]]) {
    const mesh = new THREE.Mesh(mergeParts(parts), mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    pavilion.add(mesh);
  }
  scene.add(pavilion);

  /* ---------------------------------------------------------------------- *
   * 9. 场景陈设
   * ---------------------------------------------------------------------- */

  /* 枯苇：一根 = 一个窄长条，InstancedMesh 一次画完 */
  let reeds;
  {
    const blade = new THREE.PlaneGeometry(0.030, 1.0, 1, 4);
    const pa = blade.attributes.position;
    for (let i = 0; i < pa.count; i++) {                 // 上细下粗 + 弯曲
      const y = pa.getY(i), t = y + 0.5;
      pa.setX(i, pa.getX(i) * (1 - t * 0.75));
      pa.setZ(i, Math.pow(t, 2) * 0.16);
    }
    blade.computeVertexNormals();
    const N = 900;
    reeds = new THREE.InstancedMesh(blade, materials.reed, N);
    reeds.castShadow = true;
    const dm = new THREE.Object3D();
    for (let n = 0; n < N; n++) {
      let x, z;
      if (n % 5 === 0) {                                  // 亭子周围一小丛（让开 4.7 的台基）
        const a = rng() * Math.PI * 2, r = 5.4 + rng() * 3.6;
        x = Math.cos(a) * r; z = Math.sin(a) * r;
      } else {                                            // 长堤前的苇带 z ∈ [44.0, 50.5]
        x = (rng() - 0.5) * 150; z = 44.0 + rng() * 6.5;
      }
      const h = 0.55 + rng() * 0.95;
      dm.position.set(x, iceH(x, z) + h * 0.5 - 0.12, z); // 底端埋进雪里 0.12
      dm.rotation.set((rng() - 0.5) * 0.22, rng() * Math.PI * 2, (rng() - 0.5) * 0.30);
      dm.scale.set(1, h, 1);
      dm.updateMatrix(); reeds.setMatrixAt(n, dm.matrix);
    }
    reeds.instanceMatrix.needsUpdate = true;
    scene.add(reeds);
  }

  /* 碎冰：不规则薄片，贴着冰面起伏摆 */
  let iceShards;
  {
    const shard = new THREE.CircleGeometry(1, 7);
    const pa = shard.attributes.position;
    for (let i = 1; i < pa.count; i++) {
      const k = 0.55 + rng() * 0.6;
      pa.setX(i, pa.getX(i) * k); pa.setY(i, pa.getY(i) * k);
    }
    shard.computeVertexNormals();
    const N = 130;
    iceShards = new THREE.InstancedMesh(shard, materials.iceShard, N);
    iceShards.receiveShadow = true;
    const dm = new THREE.Object3D();
    for (let i = 0; i < N; i++) {
      const x = (rng() - 0.5) * 120, z = 18 + rng() * 28;
      dm.position.set(x, iceH(x, z) + 0.012 + rng() * 0.012, z);
      dm.rotation.set(-Math.PI / 2, 0, rng() * Math.PI * 2);
      const s = 0.22 + rng() * 0.62; dm.scale.set(s, s, 1);
      dm.updateMatrix(); iceShards.setMatrixAt(i, dm.matrix);
    }
    iceShards.instanceMatrix.needsUpdate = true;
    scene.add(iceShards);
  }

  /* 系船桩：几根歪斜的木桩，桩顶一顶小雪帽 */
  const posts = new THREE.Group();
  {
    const A = [], B = [];
    for (let i = 0; i < 7; i++) {
      const h = 0.8 + rng() * 0.9;
      const x = -26 + i * 7.5 + rng() * 3, z = 39 + rng() * 7;
      const rz = (rng() - 0.5) * 0.24, rx = (rng() - 0.5) * 0.2;
      const y = iceH(x, z) + h * 0.5 - 0.10;
      A.push([new THREE.CylinderGeometry(0.07, 0.09, h, 8), M(x, y, z, rx, 0, rz)]);
      B.push([new THREE.CylinderGeometry(0.085, 0.085, 0.035, 8), M(x, y + h * 0.5, z, rx, 0, rz)]);
    }
    const pm = new THREE.Mesh(mergeParts(A), materials.wood);
    pm.castShadow = true; pm.receiveShadow = true; posts.add(pm);
    const cm = new THREE.Mesh(mergeParts(B), materials.snow);
    cm.castShadow = true; cm.receiveShadow = true; posts.add(cm);
    scene.add(posts);
  }

  /* 长堤一痕 */
  const dike = new THREE.Group();
  {
    const g = new THREE.PlaneGeometry(220, DIKE_HALF_W * 2, 120, 2);
    const pa = g.attributes.position;
    for (let i = 0; i < pa.count; i++)
      pa.setZ(i, Math.sin(pa.getX(i) * 0.21) * 0.11 + Math.sin(pa.getX(i) * 0.63) * 0.05);
    g.computeVertexNormals();
    const top = new THREE.Mesh(g, materials.dikeTop);
    top.rotation.x = -Math.PI / 2;
    top.position.set(0, DIKE_TOP_Y, DIKE_Z);
    top.receiveShadow = true; dike.add(top);
    const side = new THREE.Mesh(new THREE.BoxGeometry(220, 0.48, DIKE_HALF_W * 2), materials.dikeSide);
    side.position.set(0, 0.0, DIKE_Z);
    side.receiveShadow = true; dike.add(side);
    scene.add(dike);
  }

  /* 余舟一芥：放样船体 + 乌篷。
   * 旧版是一个 z 向拉长 3.6 倍的 LatheGeometry —— 最宽处在腰高，上下对称，
   * 远看是一枚黑色的凸透镜，加个方盒子当船舱。boat 机位（离船 6 米）撑不住。 */
  const boat = new THREE.Group();
  {
    const LEN = 4.50, BEAM = 1.24, DEPTH = 0.46;     // 契约 §2.0 的 BOAT_LEN / BEAM

    /** 船体：沿龙骨放样。两端收尖、舷线两头翘、横剖面是 U 形 */
    function hullGeo(N = 26, Mv = 12) {
      const pos = [], uv = [], idx = [];
      for (let i = 0; i <= N; i++) {
        const t = -1 + 2 * i / N;                    // −1 艏 … +1 艉
        const k = Math.max(0, 1 - t * t);
        const w = (BEAM / 2) * Math.pow(k, 0.55);
        const d = DEPTH * Math.pow(k, 0.42);
        const sheer = 0.30 + 0.16 * t * t;           // 舷线：两端翘起
        for (let j = 0; j <= Mv; j++) {
          const s = -1 + 2 * j / Mv;                 // −1 左舷 … +1 右舷
          pos.push(w * s, sheer - d * (1 - Math.pow(Math.abs(s), 1.8)), t * (LEN / 2));
          uv.push(j / Mv * 1.1, i / N * 3.2);
        }
      }
      for (let i = 0; i < N; i++) for (let j = 0; j < Mv; j++) {
        const a = i * (Mv + 1) + j, b = a + Mv + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx); g.computeVertexNormals();
      return g;
    }

    /** 篷：一段圆拱壳（两端敞口，就是乌篷船的样子） */
    function arcGeo(rw, rh, y0, z0, z1, a0, a1, K = 16, A = 16) {
      const pos = [], uv = [], idx = [];
      for (let i = 0; i <= K; i++) {
        const z = z0 + (z1 - z0) * i / K;
        for (let j = 0; j <= A; j++) {
          const a = a0 + (a1 - a0) * j / A;
          pos.push(rw * Math.cos(a), y0 + rh * Math.sin(a), z);
          uv.push(j / A * 1.4, i / K * 2.4);
        }
      }
      for (let i = 0; i < K; i++) for (let j = 0; j < A; j++) {
        const a = i * (A + 1) + j, b = a + A + 1;
        idx.push(a, a + 1, b, b, a + 1, b + 1);      // 这个绕序法线朝上/朝外
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx); g.computeVertexNormals();
      return g;
    }

    // 船体是敞口壳、篷是敞口拱，都得双面才不会从上方看穿
    materials.boatHull.side = THREE.DoubleSide;
    materials.boatCabin.side = THREE.DoubleSide;

    const hull = new THREE.Mesh(mergeParts([
      [hullGeo(), M(0, 0, 0)],
      // 一支竹篙搁在舷上
      [new THREE.CylinderGeometry(0.022, 0.017, 2.10, 6), M(0.30, 0.42, 0.25, Math.PI / 2 - 0.13, 0.05, 0)]
    ]), materials.boatHull);
    hull.castShadow = true; hull.receiveShadow = true; boat.add(hull);

    const canopy = new THREE.Mesh(arcGeo(0.400, 0.330, 0.245, -0.95, 0.75, 0, Math.PI), materials.boatCabin);
    canopy.castShadow = true; canopy.receiveShadow = true; boat.add(canopy);

    const cSnow = new THREE.Mesh(
      arcGeo(0.418, 0.348, 0.247, -0.96, 0.76, Math.PI * 0.22, Math.PI * 0.78, 14, 12), materials.snow);
    boat.add(cSnow);                                  // 篷上一道积雪

    boat.position.set(-11.5, 0.02, 20.0);             // 龙骨埋进冰面 0.14，不是浮在上面
    boat.rotation.y = 0.70;
    scene.add(boat);
  }

  /* ---------------------------------------------------------------------- *
   * 10. 雪
   * ---------------------------------------------------------------------- */
  const snowGeo = new THREE.BufferGeometry();
  const snowPos = new Float32Array(SNOW_MAX * 3);
  const snowVel = new Float32Array(SNOW_MAX * 3);
  for (let i = 0; i < SNOW_MAX; i++) {
    const j = i * 3;
    snowPos[j]     = (rng() - 0.5) * SNOW_R * 2;
    snowPos[j + 1] = rng() * 22;
    snowPos[j + 2] = (rng() - 0.5) * SNOW_R * 2;
    snowVel[j]     = (rng() - 0.5) * 0.35;
    snowVel[j + 1] = -(0.30 + rng() * 0.55);
    snowVel[j + 2] = (rng() - 0.5) * 0.35;
  }
  snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
  snowGeo.setDrawRange(0, SNOW_MAX);
  const snowMaterial = new THREE.PointsMaterial({
    color: iv('snowColor', 0xffffff), size: iv('snowSize', 0.105),
    map: flakeTex(), transparent: true,
    depthWrite: false, sizeAttenuation: true, opacity: iv('snowOpacity', 0.95), fog: true
  });
  const snowPoints = new THREE.Points(snowGeo, snowMaterial);
  snowPoints.frustumCulled = false;   // 粒子跟着相机走，包围球是建场时算的，不关掉会整片消失
  scene.add(snowPoints);

  /* ---------------------------------------------------------------------- *
   * 11. 每帧运动
   * ---------------------------------------------------------------------- */
  const iceNrm = materials.ice.normalMap;
  const SNOW_SPAN = SNOW_R * 2;
  const wrap = (v, c) => {                 // 一帧收敛的环绕重投（相机可能一口气走出去几十米）
    let d = v - c;
    d = ((d + SNOW_R) % SNOW_SPAN + SNOW_SPAN) % SNOW_SPAN - SNOW_R;
    return c + d;
  };

  function update(dt, elapsed, camera) {
    if (!camera) return;
    const cp = camera.position;

    // 1) 太阳跟着相机走（阴影视锥只有 ±22 米）
    sun.position.copy(cp).add(sunOffset);
    sun.position.y = sunOffset.y;
    sun.target.position.set(cp.x, 0, cp.z);

    // 2) 冰面法线极缓地漂 —— 不是水流，是让平光下的雪面别死板
    if (iceNrm) {
      iceNrm.offset.x = (iceNrm.offset.x + dt * 0.0026) % 1;
      iceNrm.offset.y = (iceNrm.offset.y + dt * 0.0016) % 1;
    }

    /* 3) 雪：只推进 drawRange 之内的粒子（夜雪只用 85%）。
       ★ snowPoints.visible 为假时整段短路 —— 这是整帧最热的一段 JS
         （4200 粒子 × 3 次乘加 + 2 次环绕判定），后面那句 needsUpdate 还会
         每帧向 GPU 重传 50 KB 顶点缓冲，全都是画给一个根本不画的 Points。 */
    if (snowPoints.visible) {
      const dr = snowGeo.drawRange.count;
      const n = Number.isFinite(dr) ? Math.max(0, Math.min(SNOW_MAX, dr)) : SNOW_MAX;
      const P = snowPos;
      for (let i = 0; i < n; i++) {
        const j = i * 3;
        P[j]     += snowVel[j]     * dt + Math.sin(elapsed * 0.6 + i) * dt * 0.22;
        P[j + 1] += snowVel[j + 1] * dt;
        P[j + 2] += snowVel[j + 2] * dt;
        if (P[j + 1] < -0.4) P[j + 1] = 21;
        if (P[j]     - cp.x >  SNOW_R || P[j]     - cp.x < -SNOW_R) P[j]     = wrap(P[j],     cp.x);
        if (P[j + 2] - cp.z >  SNOW_R || P[j + 2] - cp.z < -SNOW_R) P[j + 2] = wrap(P[j + 2], cp.z);
      }
      snowGeo.attributes.position.needsUpdate = true;
    }

    // 4) 小舟摇晃
    boat.rotation.z = Math.sin(elapsed * 0.7) * 0.028;
    boat.position.y = 0.02 + Math.sin(elapsed * 0.9) * 0.025;

    // 5) 灯火光晕的雾衰减（fog.density 由 atmosphere 每帧写，这里只读）
    const dens = scene.fog ? scene.fog.density : 0;
    for (let i = 0; i < lanterns.length; i++) {
      const l = lanterns[i];
      const d = cp.distanceTo(l.worldPos);
      l.halo.material.opacity = dens > 0 ? Math.exp(-Math.pow(dens * d, 2)) : 1;
    }
  }

  /* ---------------------------------------------------------------------- *
   * 12. handles
   * ---------------------------------------------------------------------- */
  settle();          // 撤掉哨兵：贴图请求已全部发出

  return {
    scene,
    loadingManager,      // CONTRACT §2.1 要求导出；当前无调用方（入场闸门走 whenReady）
    whenReady,

    materials,
    meshes: {
      ice: iceMesh, iceFar,
      pavilion,
      reeds,
      iceShards,
      posts,
      dike,
      boat
    },
    lights: { hemi, sun, sunTarget: sun.target },
    sunOffset,

    snowPoints,
    snowMaterial,
    SNOW_MAX,

    lanterns,
    /** 「亭中灯火」总闸（0/1），main.js 写、atmosphere.applyLanterns() 读。
     *  灯笼的竹骨在 P_DARK 合批网格里，藏纸罩会剩下悬空的黑圆环，所以不藏，只熄。 */
    lanternGain: 1,
    update
  };
}
