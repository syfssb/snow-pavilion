/* ============================================================================
 * 湖心亭看雪 · src/main.js
 * 装配层：renderer / camera / composer / scene / atmosphere / cameras / ui。
 *
 * 契约：CONTRACT.md §5（装配顺序不可调换、主循环顺序不可调换）。
 *
 * URL 协议
 *   ?shot=1                 截图模式：跳过闸门 + 全部界面隐藏 + 关自动环绕
 *   ?time=<dawn|dusk|night> 时辰（别名 ?t=）
 *   ?preset=<vista|steps|inside|boat>  机位（别名 ?c=）
 *   ?d=<米>                 旧版调试参数：直接以自由行走落在距亭 N 米处
 * ========================================================================== */

import * as THREE from 'three';
import { EffectComposer }  from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }      from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass }      from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass }      from 'three/addons/postprocessing/OutputPass.js';
import { buildScene }       from './scene.js';
import { createAtmosphere, DAWN } from './atmosphere.js';
import { createCameras }    from './cameras.js';
import { createUI }         from './ui.js';

/* ==========================================================================
   0. URL 参数
   ========================================================================== */
const QS       = new URLSearchParams(location.search);
const SHOT     = QS.get('shot') === '1';
const Q_TIME   = QS.get('t') || QS.get('time') || null;
const Q_PRESET = QS.get('c') || QS.get('preset') || null;
const Q_D      = parseFloat(QS.get('d'));

const STEP_METERS = 0.72;                 // CONTRACT §2.0：HUD「步」的换算
const EYE_H       = 1.62;

/* ==========================================================================
   1. renderer —— toneMappingExposure 只在这里设一次初值（随后归 atmosphere）
   ========================================================================== */
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
/* 以下全部初值来自 atmosphere.js 的 DAWN（§3 的雪晨那一列），不再抄第二份。
   它们在第一帧之前一定会被 createAtmosphere 的构造期 applyState() 覆盖一次，
   所以真正的意义只是「第一次 setSize / 编译着色器时不要用一套跑偏的数」。 */
renderer.toneMappingExposure = DAWN.exposure;
renderer.info.autoReset = false;          // 整帧 draw call 统计必需（§1.4）
document.body.appendChild(renderer.domElement);

/* ==========================================================================
   2. camera —— rotation.order 由 cameras.js 负责设成 'YXZ'
   ========================================================================== */
const camera = new THREE.PerspectiveCamera(34, window.innerWidth / window.innerHeight, 0.08, 400);

/* ==========================================================================
   3. scene
   ========================================================================== */
const handles = buildScene(THREE, renderer, DAWN);

/* ==========================================================================
   4. composer：RenderPass → Bloom → Grade → OutputPass
   —— §1.1-A：链中缓冲是线性 HDR，ACES + 曝光 + sRGB 全在链尾 OutputPass。
   ========================================================================== */
const GradeShader = {
  name: 'HuxintingGrade',                 // ← atmosphere 的退化查找靠这个 name
  uniforms: {
    tDiffuse:  { value: null },
    uTime:     { value: 0 },
    uVig:      { value: DAWN.vignette },
    uGrain:    { value: DAWN.grain },
    uLift:     { value: DAWN.lift },
    uContrast: { value: DAWN.contrast }
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uVig, uGrain, uLift, uContrast;
    varying vec2 vUv;
    /* 旧版是 fract(sin(dot(vUv*900., vec2(127.1,311.7)))*43758.5)：dot 能到 39 万，
       float32 下 sin 已经没有有效位了，夜雪那种暗底上会织出一片规则的席纹。
       换成无 sin 的整数式散列（Hoskins），量级安全、各向同性。 */
    float hash(vec2 p){
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      // 冷调阴影 / 暖调高光：水墨雪景的分级
      float l = dot(c, vec3(.2126, .7152, .0722));
      c = mix(c * vec3(0.955, 0.985, 1.045), c * vec3(1.035, 1.012, 0.972), smoothstep(0.35, 0.92, l));
      c = (c - 0.5) * uContrast + 0.5 + uLift;      // 对比 + 提亮黑位（由 atmosphere 调制）
      vec2 d = vUv - 0.5;                            // 暗角
      c *= 1.0 - uVig * dot(d, d) * 1.15;
      /* 颗粒按屏幕像素走（跟 DPR 一致，不随构图缩放），uTime 只作相位。
         ★ 幅度必须随亮度收敛。颗粒是加在**线性 HDR** 上的 ±uGrain/2，而暗部木作
           的线性值只有 0.02 量级 —— 不收敛的话负半周直接钳到 0，ACES 的趾部
           （RRTAndODTFit 带 −9.05e-5 的偏置）再把 0 附近整段压死，暗部就成了一片
           纯黑麻点。实测 dawn/inside 的 11.5% 死黑像素全部由此而来，与光够不够无关。
           真实胶片本来就是暗部无颗粒、中间调最重，所以这一步同时是物理正确的。 */
      float lv = max(c.r, max(c.g, c.b));
      float gk = smoothstep(0.0, 0.11, lv);
      c += (hash(gl_FragCoord.xy + vec2(uTime * 37.0, uTime * 53.0)) - 0.5) * uGrain * gk;
      gl_FragColor = vec4(c, 1.0);
    }`
};

let bloomScale = 1.0;                     // 掉帧时先降 bloom 分辨率（§1.4）

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(handles.scene, camera));

const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  DAWN.bloomStrength, DAWN.bloomRadius, DAWN.bloomThreshold);
composer.addPass(bloom);
composer.bloomPass = bloom;               // ← 契约命名，atmosphere 主查找路径

const grade = new ShaderPass(GradeShader);
composer.addPass(grade);
composer.gradePass = grade;               // ← 契约命名

composer.addPass(new OutputPass());

/* ==========================================================================
   5. atmosphere
   ========================================================================== */
const atmosphere = createAtmosphere(THREE, handles.scene, renderer, composer, handles);

/* ==========================================================================
   6. cameras
   ========================================================================== */
const cameras = createCameras(THREE, camera, renderer.domElement);

/* ==========================================================================
   7. ui
   ========================================================================== */
const IS_TOUCH = matchMedia('(hover: none)').matches;

/* 系统「减弱动态效果」。CSS 的 prefers-reduced-motion 块只压得住 DOM 过渡，
   压不住 2.2 秒的相机飞行和自动环绕 —— 对前庭敏感的人来说，会动的恰恰是相机那一部分。
   值从 ui 取（它已经为了置灰「自动环绕」读过一次），别在这里再 matchMedia 一遍：
   两处各读各的就是下一个「三份影子副本」。
   ↓ 赋值在 createUI 之后，下面所有用到它的都是回调 / 主循环，不会撞 TDZ。 */
let REDUCED = false;

/* ---- 自动环绕（cameras.js 无此能力，按 §ui 说明由 main 在主循环里驱动）---- */
const orbit = {
  on: false,
  ang: 0,
  rad: 41,
  y: 1.9,
  speed: 0.052,                            // rad/s ≈ 120 秒一周，慢到近乎静止
  target: new THREE.Vector3(0, 2.30, 0)
};

function startOrbit() {
  if (orbit.on) return;
  // 自由行走下按钮已经由 ui.setFree() 置灰，这里只是兜底（键盘 / 程序调用）
  if (REDUCED || cameras.isFree() || cameras.isBusy()) { ui.setToggle('orbit', false); return; }
  const p = camera.position;
  orbit.rad = Math.max(7, Math.hypot(p.x, p.z));
  orbit.y   = p.y;
  orbit.ang = Math.atan2(p.x, p.z);
  orbit.on  = true;
}

/**
 * @param {boolean} restore true = 飞回当前机位（用户手动关环绕）；
 *                          false = 调用方马上会自己发相机指令（点机位 / 进自由行走）。
 * 注：goTo(同一机位, false) 会提前返回（samePlace 分支），所以借 setFree 走一步把
 *     wasFree 置真，goTo 才会真的重放过渡。两次调用之间不跑帧，
 *     setFree(true) 写下的 FREE_FOV 会被紧接着的 goTo 覆盖，不会漏出去。
 */
function stopOrbit(restore) {
  if (!orbit.on) return;
  orbit.on = false;
  ui.setToggle('orbit', false);
  if (restore) { cameras.setFree(true); cameras.setFree(false); }
}

const ui = createUI({
  onTime: (id) => {
    atmosphere.setTime(id);
    ui.setActiveTime(id);
  },
  onPreset: (id) => {
    stopOrbit(false);
    cameras.goTo(id, REDUCED);          // 减弱动态效果 → 瞬移，不飞
    ui.setActivePreset(id);
    ui.setFree(false);
  },
  onFree: (on) => {
    stopOrbit(false);
    cameras.setFree(on, REDUCED);      // 退出自由行走时也别飞
    ui.setFree(on);
    ui.setActivePreset(on ? 'free' : cameras.current());
  },
  onToggle: (key, on) => {
    if (key === 'lantern') {
      /* 只写总闸标量，三路（emissive / PointLight / halo）由 atmosphere 统一乘。
         ★ 绝不能改回「藏 mesh」：灯笼的竹骨（吊绳 / 上下两个盖 / 两道箍 / 穗子）
           在 scene.js 里烘进了 P_DARK 合批网格、跟亭子一起常驻，藏掉纸罩只会剩下
           两组悬空的黑圆环 + 一根吊绳 + 一颗穗子，中间空无一物。
           熄灭而不隐藏，读出来才是「一盏没点的灯」。 */
      handles.lanternGain = on ? 1 : 0;
      return;
    }
    if (key === 'snow') {
      handles.snowPoints.visible = on;      // drawRange 归 atmosphere 的 snowDensity
      return;
    }
    if (key === 'orbit') {
      if (on) startOrbit(); else stopOrbit(true);
      return;
    }
    // verse / hud / chrome：ui 自己处理显隐，main 无事可做
  },
  onEnter: () => {
    // 入场时是 vista 预设机位，预设模式下锁指针会让光标消失且画面不动。
    // 自由行走的指针锁由 cameras.js 的 click 处理器负责。
    if (!IS_TOUCH && cameras.isFree()) {
      try { const r = renderer.domElement.requestPointerLock(); if (r && r.catch) r.catch(() => {}); }
      catch (e) { /* 忽略 */ }
    }
  }
});

REDUCED = ui.prefersReducedMotion();

ui.setTimes(atmosphere.TIMES);
ui.setPresets(cameras.PRESETS);

/* ==========================================================================
   8. 贴图就绪 → 开闸
   ========================================================================== */
handles.whenReady(() => {
  ui.setReady();                            // 不传 hint：由 ui 按设备给默认文案
  window.__hxtReady = true;
});

/* ==========================================================================
   9~11. 初值 + URL 覆盖
   ========================================================================== */
const timeId   = (Q_TIME   && atmosphere.TIMES.some(t => t.id === Q_TIME))     ? Q_TIME   : 'dawn';
const presetId = (Q_PRESET && cameras.PRESETS.some(p => p.id === Q_PRESET))    ? Q_PRESET : 'vista';

atmosphere.setTime(timeId, true);
ui.setActiveTime(timeId);
cameras.goTo(presetId, true);
ui.setActivePreset(presetId);

if (SHOT) {
  ui.dismissGate();          // 落幕（否则 gateGone 仍为 false）
  ui.setChrome(false);       // 再隐界面。两句都要，顺序照写。
}
/* ?d= 与 ?shot=1 不再互斥：截图模式下也要能拍「自由行走」这一档
   （PRESETS 里的 free 没有 pos/target，goTo('free') 只会保持当前位姿）。 */
if (Number.isFinite(Q_D)) {
  // 旧版 ?d=<米>：以自由行走落在距亭 N 米处，正对亭子。
  const d = Math.max(3, Math.min(60, Q_D));
  camera.position.set(1.2, EYE_H, d);
  camera.lookAt(0, 2.0, 0);                 // 先摆正，setFree 才能读到正确的 yaw/pitch
  cameras.setFree(true);
  ui.setFree(true);
  ui.setActivePreset('free');
}

/* ==========================================================================
   12. 主循环
   ========================================================================== */
const clock = new THREE.Clock();
let hudT = 0, frames = 0, fpsAcc = 0;
let lastCalls = 0, lastTris = 0;
let slowWindows = 0, fastWindows = 0;

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  composer.setSize(w, h);
  if (bloomScale !== 1.0) bloom.setSize(w * bloomScale, h * bloomScale);
}
window.addEventListener('resize', resize);

function frame() {
  requestAnimationFrame(frame);

  const raw     = clock.getDelta();          // 真实帧时（fps 统计用，不钳制）
  const dt      = Math.min(raw, 0.06);       // 物理推进用，钳制掉切标签页的巨大跳变
  const elapsed = clock.getElapsedTime();

  cameras.update(dt);                                   // ① 先动相机

  if (orbit.on && !cameras.isBusy() && !cameras.isFree()) {
    orbit.ang += dt * orbit.speed;
    camera.position.set(Math.sin(orbit.ang) * orbit.rad, orbit.y, Math.cos(orbit.ang) * orbit.rad);
    camera.lookAt(orbit.target);                        // 写在 cameras.update 之后才不会被 stepPreset 覆盖
  }

  atmosphere.update(dt);                                // ② 再推进时辰（写 fog.density 等）
  handles.update(dt, elapsed, camera);                  // ③ 场景运动（读 fog.density / 相机新位置）

  grade.uniforms.uTime.value = elapsed;                 // ④

  renderer.info.reset();                                // ⑤
  composer.render();                                    // ⑥
  lastCalls = renderer.info.render.calls;
  lastTris  = renderer.info.render.triangles;

  ui.setBusy(cameras.isBusy());
  const s = cameras.getStick();
  ui.setStick(s.x, s.y, s.active);

  /* ⑦ 每 240ms 刷新 HUD */
  /* 切标签页回来的那一帧 raw 是几十秒，混进窗口会把 fps 算成 0.02 —— 直接丢掉整窗，
     否则 bloom 会被一次「回到前台」误判成掉帧。
     门槛取 2 秒（= 0.5fps）而不是 0.5 秒：0.5 秒等于 2fps，软件渲染的机器真能长期
     停在那儿，那样 HUD 会永远刷不出来。这里只想认出「刚从后台回来」。
     注意这条 return 在 composer.render() 之后，只跳过 HUD 统计，不跳过渲染。 */
  if (raw > 2.0) { slowWindows = 0; fastWindows = 0; hudT = 0; frames = 0; fpsAcc = 0; return; }
  frames++; fpsAcc += raw;
  hudT += raw;
  if (hudT >= 0.24) {
    const fps = fpsAcc > 0 ? frames / fpsAcc : 0;
    const dist = Math.hypot(camera.position.x, camera.position.z);
    ui.setStats({ fps, tris: lastTris, calls: lastCalls, steps: dist / STEP_METERS,
                  bloomHalf: bloomScale !== 1.0 });
    ui.setVerse(dist);

    /* 掉帧先降 bloom 分辨率，不砍几何体（§1.4）。截图模式不做，保证逐帧可复现。
       起步 3 秒内不判：贴图解码 + 首帧着色器编译本来就慢，那不是稳态帧率。
       ★ 必须是双向的。原来只有降没有升：门槛其实只是「约 1 秒的掉帧」——
         切一次标签页、一次 GC 停顿就够了，之后哪怕帧率回到 120fps，
         这一整个会话的辉光都停在半分辨率，而且 resize() 还会把它持久化下去。
       38 / 52 之间留 14fps 的迟滞带，不会来回抖。 */
    if (!SHOT && elapsed > 3 && fps > 0) {
      if (bloomScale === 1.0) {
        if (fps < 38) {
          if (++slowWindows >= 4) {
            bloomScale = 0.5;
            bloom.setSize(window.innerWidth * bloomScale, window.innerHeight * bloomScale);
            slowWindows = 0; fastWindows = 0;
          }
        } else { slowWindows = 0; }
      } else if (fps > 52) {
        if (++fastWindows >= 8) {
          bloomScale = 1.0;
          bloom.setSize(window.innerWidth, window.innerHeight);
          fastWindows = 0; slowWindows = 0;
        }
      } else { fastWindows = 0; }
    }

    hudT = 0; frames = 0; fpsAcc = 0;
  }
}
requestAnimationFrame(frame);

/* 调试句柄：控制台 / 无头验收用（不参与渲染） */
window.__hxt = {
  THREE, renderer, camera, composer, bloom, grade, handles, atmosphere, cameras, ui,
  get bloomScale() { return bloomScale; },   // 无头验收查降级状态用（不再往控制台打印）
  get reduced() { return REDUCED; }
};
