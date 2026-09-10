/* ==========================================================================
   湖心亭看雪 · src/cameras.js —— 相机系统
   契约：CONTRACT.md §2.3 / §4
     export function createCameras(THREE, camera, domElement)
       -> { goTo(name, instant), setFree(on), update(dt), PRESETS,
            isFree(), isBusy(), current(), getStick(), dispose() }

   三种状态，互斥：
     ① 过渡中（isBusy() === true）  位置 easeInOutCubic + 抛物抬升，朝向 slerp，
                                    fov 数值 lerp。期间忽略一切用户输入。
     ② 预设机位（静止）            位姿固定，只允许 ±20° 以内的拖动微调
                                    （tanh 软限位，实际到约 19°），
                                    松手 0.35s 后以 τ=0.45s 缓慢回弹归位。
     ③ 自由行走（isFree() === true）WASD/方向键 + Shift 快走 + 指针锁定
                                    （锁定失败降级为按住拖动）+ 触屏左摇杆右视角。

   与契约的偏差（整合者可一键取舍，均已在交付说明的 risks 里列出）：
     A. groundY() 补了一条「台基顶面」分支——契约版在 |z|∈(2.40,2.60) 与
        2.40<|x|≤2.75 的台基外圈会掉回 0.0，走进亭子时眼高有 ~0.24m 的踉跄。
        该分支单独成块，删掉即回到契约原文。
     B. FREE_FOV = 60（16:9 参考值）。契约只规定 setFree(true) 保持"位姿"，
        没规定 fov；沿用 vista 的 34° 走路像拿望远镜。进出自由模式时 fov
        以 ~0.3s 缓动过渡，不硬切。

   本文件不创建 / 不查询 / 不修改任何 DOM 节点，只在 domElement、window、
   document 上挂事件监听；不碰光源、材质、几何体、雾、renderer、composer。
   ========================================================================== */

/* ── 世界常量（CONTRACT §2.0，与 scene.js 各抄一份，必须逐字一致）────────── */
const EYE_H        = 1.62;          // 人眼高
const WALK_SPEED   = 2.9;           // m/s
const RUN_SPEED    = 5.6;           // m/s，Shift
const BOUND_X      = 90;            // x ∈ [-90, 90]
const BOUND_Z_MIN  = -70;           // z ∈ [-70, 56]
const BOUND_Z_MAX  = 56;
const PITCH_MIN    = -1.15;         // rad
const PITCH_MAX    = 0.95;

/* ── 输入手感 ───────────────────────────────────────────────────────────── */
const SENS_LOCK    = 0.0022;        // 指针锁定
const SENS_DRAG    = 0.0042;        // 桌面拖动降级
const SENS_TOUCH   = 0.005;         // 触屏右半屏
const STICK_RADIUS = 46;            // 摇杆判定半径 px（旋钮最大位移 36px 归 ui.js）
const STICK_ZONE   = 0.45;          // 左 45% 屏宽为摇杆区
const EYE_EASE     = 7;             // 眼高缓动系数：min(1, dt * 7)

/* ── 预设机位下的「活着」微调 ───────────────────────────────────────────── */
const NUDGE_LIMIT      = 20 * Math.PI / 180;   // ±20° 硬上限，用 tanh 软限位，越靠边越沉
const NUDGE_RAW_CAP    = NUDGE_LIMIT * 1.8;    // 原始累积量的上限。不封顶的话 tanh 会长期
                                               // 饱和在 20° 上，松手后先「粘」一两秒才动，
                                               // 手感像卡住。封顶后实际最大偏角 ≈ 18.9°
const NUDGE_SENS_MOUSE = 0.0026;               // 拖满约 240px
const NUDGE_SENS_TOUCH = 0.0032;
const NUDGE_HOLD       = 0.35;                 // 松手后停顿（秒）再回弹
const NUDGE_TAU        = 0.45;                 // 回弹时间常数（秒）：约 2.3s 完全归位

/* ── 视野 ───────────────────────────────────────────────────────────────── */
const REF_ASPECT  = 16 / 9;         // PRESETS[i].fov 是这个宽高比下的垂直 fov
const FOV_MAX     = 78;             // 一般窄屏（平板竖屏 / 分屏）纵向张开的上限
/* 手机竖屏（390×844，aspect 0.46）要 99° 才能保住 16:9 的横向构图，钳到 78° 也没保住，
   却把纵向白白张成广角：上半屏一整片空天、边缘拉伸，「湖心亭一点」读不出「亭」。
   ≤0.80 的宽高比改走 PRESETS[i] 的竖屏覆盖（tallPos / tallTarget / tallFov），
   见 tallOf() 上面那段。FOV_MAX_TALL 只是给没写覆盖的机位兜底。 */
const TALL_ASPECT  = 0.80;
const FOV_MAX_TALL = 62;
const PORT_REF     = 9 / 19.5;      // ≈0.462，现代手机竖屏；PRESETS[i].tall 就是按它定的
const FREE_FOV   = 60;              // 自由行走的参考 fov（偏差 B）
const FREE_FOV_EASE = 3.2;

/* ── 预设机位（CONTRACT §4，纯数据，顺序即 UI 顺序）─────────────────────── */
/* tallPos / tallTarget / tallFov = 竖屏（aspect < 0.80）的构图覆盖，按 9:19.5 手调。
   缺省则沿用横屏那份。见 tallOf 上面那段：竖屏没有公式解，这几组数是逐张截图定的。 */
const PRESETS = [
  { id:'vista',  label:'湖心亭一点', pos:[  8.50, 1.78, 41.00 ], target:[  2.20, 2.64,  0.00 ], fov:34, dur:2.2,
    tallPos:[ 7.11, 1.97, 31.98 ], tallFov:56 },
  /* steps 由整合者按截图重瞄（§4 明确授权）：檐口中点 3.34→3.54 之后，原来的
     pos z=5.60 / target y=3.95 把屋面底整个糊在画面上（70% 面幅、≤12 的死黑占 10%），
     斗拱挂落栏杆踏跺全看不见。退到 7.60 米、视轴压到 2.58，亭子整座入画，
     两侧翼角都收在框内，中轴落在中线偏左，右侧留白给竖排原文。 */
  { id:'steps',  label:'阶前仰观',   pos:[  1.45, 1.42,  7.60 ], target:[  0.75, 2.58,  0.20 ], fov:52, dur:1.8, tallFov:64 },
  { id:'inside', label:'亭中看雪',   pos:[  0.62, 2.28, -0.95 ], target:[ -2.60, 1.55, 14.00 ], fov:46, dur:1.8, tallFov:80 },
  { id:'boat',   label:'余舟一芥',   pos:[ -9.40, 0.48, 25.60 ], target:[ -6.30, 1.50, -4.20 ], fov:48, dur:2.0,
    /* 竖屏横向只剩 41° 张角，舟（-11.5,0,20）和亭（0,2.3,0）从原机位看开了约 80°，
       两者不可能同框。改成站到舟的正后方、让「舟在前、亭在后」顺着视轴排下去 ——
       原文的次序本来也是「湖心亭一点、与余舟一芥」。 */
    tallPos:[ -14.60, 1.32, 26.40 ], tallTarget:[ -3.60, 2.10, 3.00 ], tallFov:62 },
  { id:'free',   label:'自由行走',   free:true }
];

/* ── 纯函数 ─────────────────────────────────────────────────────────────── */
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** 窄屏需要的垂直 fov（保住 16:9 的横向构图），未钳制。 */
function fovWanted(fovRef, aspect) {
  if (aspect >= REF_ASPECT) return fovRef;
  return 2 * Math.atan(Math.tan(fovRef * Math.PI / 360) * REF_ASPECT / aspect) * 180 / Math.PI;
}

/**
 * 竖屏（aspect < TALL_ASPECT）改用 PRESETS[i].tallFov：它是按 PORT_REF 手调的
 * 垂直 fov，随 aspect 用同一套「保住横向构图」的公式伸缩，不再另设上限
 * —— 上限是给「没有 tallFov 的机位」兜底的。
 */
function fovFor(fovRef, aspect, tallFov) {
  if (aspect >= REF_ASPECT) return fovRef;                 // 更宽的屏只是横向多看到一点
  if (aspect < TALL_ASPECT && tallFov > 0) {
    return 2 * Math.atan(Math.tan(tallFov * Math.PI / 360) * PORT_REF / aspect) * 180 / Math.PI;
  }
  const v = fovWanted(fovRef, aspect);
  return Math.min(aspect < TALL_ASPECT ? FOV_MAX_TALL : FOV_MAX, v);
}

/**
 * 竖屏（aspect < TALL_ASPECT）取机位的竖屏覆盖：tallPos / tallTarget / tallFov。
 * 三个都可选，缺哪个就用横屏那份。
 *
 * ★ 这里踩过一个坑，留个记号：审查建议用 k = tan(用的半角)/tan(想要的半角)
 *   自动补偿钳位丢掉的画幅。实测那条公式两个方向都不对 ——
 *   按它推近（k<1），vista 的亭子从占屏宽 19% 涨到 60%，「湖心亭一点」变成「阶前」；
 *   按它退后（1/k≈1.96），vista 要退到 63 米，雾（density .0275）在那里已经吃掉 95%，
 *   亭子直接没了。而 inside 需要的恰恰是**更大**的 fov（竖屏横向张角不够，两根柱子
 *   全被裁到画外），和「钳小 fov」的方向正相反。
 *   结论：9:19.5 与 16:9 之间不存在保住构图的公式解，只能一机位一机位看着截图定。
 *   所以改成每个机位自带一份手调的竖屏覆盖。
 */
function tallOf(p, aspect) {
  return (aspect < TALL_ASPECT) ? p : null;
}

/* 地面高度（CONTRACT §2.0）。不做碰撞体，只做高度。 */
function groundY(x, z) {
  if (Math.abs(x) <= 2.40 && Math.abs(z) <= 2.40) return 0.655;              // 亭内 FLOOR_Y
  if (Math.abs(x) <= 1.00 && z >= 2.60 && z <= 3.60)                          // 踏跺
    return 0.08 + (3.60 - z) / 1.00 * 0.54;
  /* ↓↓↓ 契约偏差 A（整块可删，删掉即回契约原文）────────────────────────────
     契约原文在这两条之后直接判长堤，于是 |z|∈(2.40,2.60) 和 2.40<|x|≤2.75
     的台基外圈全落回 0.0：踏跺顶端 0.62 → 亭内 0.655 中间夹了一格 0.0，
     以 2.9m/s 走进亭子时眼高会先掉 ~0.24m 再弹回来，是个看得见的踉跄。
     台基外沿 BASE_HALF = 2.75、顶面 PLINTH_TOP_Y = 0.62，补上即连续。 */
  if (Math.abs(x) <= 2.75 && Math.abs(z) <= 2.75) return 0.62;                // 台基顶面
  /* ↑↑↑ 契约偏差 A 结束 ───────────────────────────────────────────────── */
  if (Math.abs(z - 50.6) <= 1.70) return 0.24;                                // 长堤 DIKE_TOP_Y
  return 0.0;                                                                 // 冰面 ICE_Y
}

/* ==========================================================================
   createCameras
   ========================================================================== */
export function createCameras(THREE, camera, domElement) {

  /* YXZ 是预设 ↔ 自由交接无损往返的前提（CONTRACT §2.3）。只设一次。 */
  camera.rotation.order = 'YXZ';

  /* ---- 复用对象，主循环里零分配 ---- */
  const _fwd     = new THREE.Vector3();
  const _right   = new THREE.Vector3();
  const _up      = new THREE.Vector3(0, 1, 0);
  const _m       = new THREE.Matrix4();
  const _target  = new THREE.Vector3();
  const _fromPos = new THREE.Vector3();
  const _toPos   = new THREE.Vector3();
  const _qA      = new THREE.Quaternion();
  const _qB      = new THREE.Quaternion();

  /* ---- 状态 ---- */
  let free      = false;                 // 自由行走
  let busy      = false;                 // 过渡中
  let presetId  = PRESETS[0].id;         // 当前 / 过渡目标机位
  let fovRefNow = PRESETS[0].fov;        // 当前生效的参考 fov（16:9 下）

  let yaw   = camera.rotation.y;         // 基准朝向（不含微调偏移）
  let pitch = camera.rotation.x;

  let nudgeYawRaw = 0, nudgePitchRaw = 0, nudgeHold = 0, nudging = false;

  let locked = false, drag = null;       // 桌面：指针锁定 / 拖动降级
  const keys = Object.create(null);

  let stickId = null, stickO = null;     // 触屏摇杆
  let lookId  = null, lookPrev = null;   // 触屏转视角
  const stick = { x: 0, y: 0 };
  const _stickOut = { x: 0, y: 0, active: false };   // getStick() 的复用返回体

  /* 过渡 */
  let trT = 0, trDur = 1, trArc = 0, trFovA = camera.fov, trFovRef = fovRefNow;
  let trTallFov = PRESETS[0].tallFov;
  /* 过渡对用户是一句时长承诺（2.2 秒就该是 2.2 秒）。累加钳过的 dt 会让它在低帧率下
     变成慢动作：dt 钳在 0.06，帧率低于 ~17fps 时每帧只推进 0.06s 模拟时间，实际耗时更长
     —— 实测无头环境下 2.0s 的过渡走了 14 秒墙钟。改成读墙钟，低帧率只是插值步子变粗。 */
  const nowSec = () => (typeof performance !== 'undefined' && performance.now
    ? performance.now() : Date.now()) / 1000;
  let trStart = 0;

  const isTouchDevice = (typeof window !== 'undefined' && window.matchMedia)
    ? window.matchMedia('(hover: none)').matches : false;

  /* ---- 小工具 ---- */
  const clamp = (v, lo, hi) => v < lo ? lo : (v > hi ? hi : v);
  const clampPitch = v => clamp(v, PITCH_MIN, PITCH_MAX);

  /* tanh 软限位：靠近 ±20° 时越推越沉，不会撞在硬边上 */
  const softLimit = v => NUDGE_LIMIT * Math.tanh(v / NUDGE_LIMIT);

  /* 预设机位下的拖动微调：累加 + 封顶，松手计时 */
  function addNudge(dx, dy, sens) {
    nudgeYawRaw   = clamp(nudgeYawRaw   - dx * sens, -NUDGE_RAW_CAP, NUDGE_RAW_CAP);
    nudgePitchRaw = clamp(nudgePitchRaw - dy * sens, -NUDGE_RAW_CAP, NUDGE_RAW_CAP);
    nudgeHold = NUDGE_HOLD;
  }

  function aspect() {
    const w = window.innerWidth, h = window.innerHeight;
    if (w > 0 && h > 0) return w / h;
    return camera.aspect || REF_ASPECT;
  }

  function setFov(v) {
    if (Math.abs(camera.fov - v) > 1e-4) { camera.fov = v; camera.updateProjectionMatrix(); }
  }

  /* 事件是否落在「画面」上（而不是 ui 的按钮上）。
     只做引用比较，不查询 DOM。触屏摇杆按契约豁免这一检查。 */
  function onCanvas(t) {
    return t === domElement || t == null || t === window ||
           (typeof document !== 'undefined' &&
             (t === document || t === document.body || t === document.documentElement));
  }

  function releaseLock() {
    locked = false;
    try {
      if (typeof document !== 'undefined' &&
          document.pointerLockElement === domElement && document.exitPointerLock) {
        document.exitPointerLock();
      }
    } catch (e) { /* 浏览器拒绝就算了 */ }
  }

  function clearInput() {
    drag = null; nudging = false;
    stickId = null; stickO = null; stick.x = 0; stick.y = 0;
    lookId = null; lookPrev = null;
  }

  /* ---- 朝向：由 pos / target 求相机四元数（相机 -Z 指向 target）----
     用 Matrix4.lookAt 而不是 Object3D.lookAt：后者对非相机对象是
     lookAt(target, position, up)，会把朝向翻转 180°。 */
  function quatLookAt(out, pos, target) {
    _m.lookAt(pos, target, _up);
    out.setFromRotationMatrix(_m);
    return out;
  }

  /* ======================================================================
     goTo / setFree
     ====================================================================== */
  function goTo(name, instant = false) {
    const p = PRESETS.find(q => q.id === name);
    if (!p) { console.warn('[cameras] 未知机位:', name); return; }
    if (p.free) { setFree(true); return; }

    const wasFree = free;
    const wasBusy = busy;
    const samePlace = !wasFree && !wasBusy && presetId === p.id;

    free = false;
    presetId = p.id;
    fovRefNow = p.fov;
    clearInput();
    releaseLock();

    /* 已经站在这个机位上：不重放 2 秒过渡，只把微调立刻放手回弹 */
    if (samePlace && !instant) { nudgeHold = 0; setFov(fovFor(p.fov, aspect(), p.tallFov)); return; }

    const tall = tallOf(p, aspect());
    _target.fromArray((tall && tall.tallTarget) || p.target);
    _toPos.fromArray((tall && tall.tallPos) || p.pos);
    quatLookAt(_qB, _toPos, _target);
    const fovB = fovFor(p.fov, aspect(), p.tallFov);

    if (instant) {
      camera.position.copy(_toPos);
      camera.quaternion.copy(_qB);          // 会自动同步 camera.rotation（YXZ）
      setFov(fovB);
      yaw = camera.rotation.y; pitch = camera.rotation.x;
      nudgeYawRaw = nudgePitchRaw = 0; nudgeHold = 0;
      busy = false;
      return;
    }

    _fromPos.copy(camera.position);
    _qA.copy(camera.quaternion);            // 含当前微调偏移，视觉连续
    trFovA    = camera.fov;
    trFovRef  = p.fov;
    trTallFov = p.tallFov;
    trArc    = Math.min(3.0, 0.055 * _fromPos.distanceTo(_toPos));
    trDur    = Math.max(0.001, p.dur || 1.8);
    trT      = 0;
    trStart  = nowSec();
    busy     = true;
  }

  /** @param {boolean} instant 退出自由行走时是否瞬移回机位（系统「减弱动态效果」用）。 */
  function setFree(on, instant = false) {
    if (on) {
      busy = false;                          // 打断过渡，保持当前位姿
      free = true;
      fovRefNow = FREE_FOV;
      /* 从当前 camera.rotation 直接读出 yaw/pitch 继续（含微调偏移，不重置视角） */
      yaw = camera.rotation.y;
      pitch = clampPitch(camera.rotation.x);
      nudgeYawRaw = nudgePitchRaw = 0; nudgeHold = 0; nudging = false;
      drag = null;
      return;
    }
    if (!free) return;
    goTo(presetId, instant);                 // 回到上一个机位（goTo 内部会置 free = false）
  }

  /* ======================================================================
     每帧
     ====================================================================== */
  function update(dt) {
    if (!(dt > 0)) dt = 0;
    if (dt > 0.06) dt = 0.06;
    if (busy)      stepTransition(dt);
    else if (free) stepFree(dt);
    else           stepPreset(dt);
  }

  function stepTransition(dt) {
    trT = nowSec() - trStart;                               // 墙钟，不累加钳过的 dt
    const raw = trDur > 0 ? Math.min(1, trT / trDur) : 1;
    const e = easeInOutCubic(raw);

    camera.position.lerpVectors(_fromPos, _toPos, e);
    camera.position.y += trArc * Math.sin(Math.PI * e);     // 一点抛物抬升，不贴地掠过
    camera.quaternion.slerpQuaternions(_qA, _qB, e);

    const fovB = fovFor(trFovRef, aspect(), trTallFov);      // resize 也吃得住
    camera.fov = trFovA + (fovB - trFovA) * e;
    camera.updateProjectionMatrix();

    if (raw >= 1) {
      camera.position.copy(_toPos);
      camera.quaternion.copy(_qB);
      camera.fov = fovB; camera.updateProjectionMatrix();
      /* 结束这一帧把朝向回写成 yaw/pitch —— YXZ 下这个往返无损 */
      yaw = camera.rotation.y;
      pitch = clampPitch(camera.rotation.x);
      nudgeYawRaw = nudgePitchRaw = 0; nudgeHold = 0; nudging = false;
      busy = false;
    }
  }

  function stepPreset(dt) {
    if (!nudging) {
      if (nudgeHold > 0) {
        nudgeHold = Math.max(0, nudgeHold - dt);
      } else if (nudgeYawRaw !== 0 || nudgePitchRaw !== 0) {
        const decay = Math.exp(-dt / NUDGE_TAU);
        nudgeYawRaw   *= decay;
        nudgePitchRaw *= decay;
        if (Math.abs(nudgeYawRaw)   < 1e-5) nudgeYawRaw = 0;
        if (Math.abs(nudgePitchRaw) < 1e-5) nudgePitchRaw = 0;
      }
    }
    camera.rotation.set(
      clampPitch(pitch + softLimit(nudgePitchRaw)),
      yaw + softLimit(nudgeYawRaw),
      0
    );
  }

  function stepFree(dt) {
    _fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    _right.set(Math.cos(yaw), 0, -Math.sin(yaw));

    let ix = 0, iz = 0;
    if (keys['KeyW'] || keys['ArrowUp'])    iz += 1;
    if (keys['KeyS'] || keys['ArrowDown'])  iz -= 1;
    if (keys['KeyD'] || keys['ArrowRight']) ix += 1;
    if (keys['KeyA'] || keys['ArrowLeft'])  ix -= 1;
    if (stickId !== null) { ix += stick.x; iz -= stick.y; }

    const len = Math.hypot(ix, iz);
    if (len > 0.001) {
      const spd = (keys['ShiftLeft'] || keys['ShiftRight']) ? RUN_SPEED : WALK_SPEED;
      const k = (spd * dt) / Math.max(len, 1);              // 斜向不加速，单向不减速
      camera.position.addScaledVector(_fwd, iz * k).addScaledVector(_right, ix * k);
    }

    camera.position.x = clamp(camera.position.x, -BOUND_X, BOUND_X);
    camera.position.z = clamp(camera.position.z, BOUND_Z_MIN, BOUND_Z_MAX);

    const targetY = groundY(camera.position.x, camera.position.z) + EYE_H;
    camera.position.y += (targetY - camera.position.y) * Math.min(1, dt * EYE_EASE);

    camera.rotation.set(pitch, yaw, 0);

    const f = fovFor(FREE_FOV, aspect());
    if (Math.abs(camera.fov - f) > 0.02) {
      camera.fov += (f - camera.fov) * Math.min(1, dt * FREE_FOV_EASE);
      camera.updateProjectionMatrix();
    } else {
      setFov(f);
    }
  }

  /* ======================================================================
     输入
     ====================================================================== */

  /* ---- 键盘（只记状态，动不动由 stepFree 决定）---- */
  function onKeyDown(e) { keys[e.code] = true; }
  function onKeyUp(e)   { keys[e.code] = false; }
  function onBlur() {
    for (const k in keys) keys[k] = false;
    clearInput();
  }

  /* ---- 指针锁定 ---- */
  function onLockChange() {
    locked = (typeof document !== 'undefined' && document.pointerLockElement === domElement);
    /* 预设机位下锁住指针 = 用户卡死：光标没了、画面不动、UI 点不着。
       main.js 的 onEnter 按契约 §5 会在入场时请求锁，而入场时是 vista 机位，
       所以这里自愈式地放掉。自由行走时才允许锁。 */
    if (locked && !free) releaseLock();
  }
  function onLockError() { locked = false; }   // 降级为按住拖动；提示文案归 ui.js

  function onClick() {
    if (!free || busy || locked || isTouchDevice) return;
    try {
      const r = domElement.requestPointerLock();
      if (r && typeof r.catch === 'function') r.catch(() => {});
    } catch (e) { /* 不支持就走拖动降级 */ }
  }

  /* ---- 鼠标（pointer 分支里已排除 pointerType === 'mouse'，不会重复处理）---- */
  function onMouseDown(e) {
    if (busy || e.button !== 0 || !onCanvas(e.target)) return;
    if (free) { if (!locked) drag = { x: e.clientX, y: e.clientY }; }
    else      { drag = { x: e.clientX, y: e.clientY }; nudging = true; }
  }

  function onMouseMove(e) {
    if (busy) return;
    if (free && locked) {
      yaw -= e.movementX * SENS_LOCK;
      pitch = clampPitch(pitch - e.movementY * SENS_LOCK);
      return;
    }
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    if (free) {
      yaw -= dx * SENS_DRAG;
      pitch = clampPitch(pitch - dy * SENS_DRAG);
    } else {
      addNudge(dx, dy, NUDGE_SENS_MOUSE);
    }
  }

  function onMouseUp() { drag = null; nudging = false; }

  /* ---- 触屏 ----
     按契约挂在 window 的 capture 阶段：ui 的触屏层盖在 canvas 上方，
     挂 domElement 会收不到事件。摇杆不做 onCanvas 判定（契约豁免），
     转视角/微调做判定，免得拖 ui 按钮时画面跟着转。 */
  function onPointerDown(e) {
    if (e.pointerType === 'mouse') return;
    if (busy) return;
    /* 契约偏差 C：摇杆分支补上 onCanvas 判定（契约原文豁免这一检查）。
       原文的判定区是「左 45% 屏宽 × 整个屏高」，它盖住了底部抽屉的左半栏
       —— 390px 下抽屉里的「夜雪」中心在 x=102，正落在 x<175.5 的摇杆区里，
       点它会激活摇杆、把相机推走，pointermove 的 preventDefault 还把 click 吃掉，
       于是抽屉左半栏在自由行走下彻底点不动。机位栏也被啃掉 17px。
       #hxt-touch / #hxt-stick / #hxt-knob 都是 pointer-events:none，
       落在摇杆图形上的手指 target 仍然是 canvas，所以摇杆本身不受影响。 */
    if (free && stickId === null && onCanvas(e.target) &&
        e.clientX < window.innerWidth * STICK_ZONE) {
      stickId = e.pointerId; stickO = { x: e.clientX, y: e.clientY };
      stick.x = 0; stick.y = 0;
      return;
    }
    if (lookId === null && onCanvas(e.target)) {
      lookId = e.pointerId; lookPrev = { x: e.clientX, y: e.clientY };
      if (!free) nudging = true;
    }
  }

  function onPointerMove(e) {
    if (e.pointerType === 'mouse') return;
    if (e.pointerId === stickId) {
      const dx = e.clientX - stickO.x, dy = e.clientY - stickO.y;
      const m = Math.min(1, Math.hypot(dx, dy) / STICK_RADIUS), a = Math.atan2(dy, dx);
      stick.x = Math.cos(a) * m;                 // x 右为正
      stick.y = Math.sin(a) * m;                 // y 下为正（与旧版 move 一致）
      if (e.cancelable) e.preventDefault();
      return;
    }
    if (e.pointerId !== lookId) return;
    const dx = e.clientX - lookPrev.x, dy = e.clientY - lookPrev.y;
    lookPrev.x = e.clientX; lookPrev.y = e.clientY;
    if (busy) return;
    if (free) {
      yaw -= dx * SENS_TOUCH;
      pitch = clampPitch(pitch - dy * SENS_TOUCH);
    } else {
      addNudge(dx, dy, NUDGE_SENS_TOUCH);
    }
    if (e.cancelable) e.preventDefault();
  }

  function onPointerUp(e) {
    if (e.pointerType === 'mouse') return;
    if (e.pointerId === stickId) {
      stickId = null; stickO = null; stick.x = 0; stick.y = 0;
    }
    if (e.pointerId === lookId) {
      lookId = null; lookPrev = null; nudging = false;
    }
  }

  /* ---- resize：PRESETS[i].fov 是 16:9 下的权威值，窄屏要重算 ---- */
  function onResize() {
    if (busy) return;                            // 过渡每帧自己算终点 fov
    if (free) return;                            // 自由模式由 stepFree 缓动过去
    const p = PRESETS.find(q => q.id === presetId);
    setFov(fovFor(fovRefNow, aspect(), p && p.tallFov));
    /* 竖屏覆盖随 aspect 变，转屏 / 分屏后必须重算，否则会停在上一次的构图上。
       手指正按着微调时不动，免得把用户拖着的画面拽走（下一次 resize / 换机位会补上）。
       写 quaternion 只是为了顺手把 yaw/pitch 取回来 —— 它下一帧就会被 stepPreset
       用 yaw/pitch + 微调偏移重写，所以微调正在回弹时这样写也不会跳。 */
    if (p && p.pos && !nudging) {
      const tall = tallOf(p, aspect());
      _target.fromArray((tall && tall.tallTarget) || p.target);
      _toPos.fromArray((tall && tall.tallPos) || p.pos);
      camera.position.copy(_toPos);
      camera.quaternion.copy(quatLookAt(_qB, _toPos, _target));
      yaw = camera.rotation.y; pitch = clampPitch(camera.rotation.x);
    }
  }

  /* ---- 挂载 ---- */
  const CAP  = { capture: true };
  const CAPP = { capture: true, passive: false };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  window.addEventListener('resize', onResize);
  window.addEventListener('mousedown', onMouseDown, CAP);
  window.addEventListener('mousemove', onMouseMove, CAP);
  window.addEventListener('mouseup', onMouseUp, CAP);
  window.addEventListener('pointerdown', onPointerDown, CAPP);
  window.addEventListener('pointermove', onPointerMove, CAPP);
  window.addEventListener('pointerup', onPointerUp, CAPP);
  window.addEventListener('pointercancel', onPointerUp, CAPP);
  document.addEventListener('pointerlockchange', onLockChange);
  document.addEventListener('pointerlockerror', onLockError);
  domElement.addEventListener('click', onClick);

  function dispose() {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('mousedown', onMouseDown, CAP);
    window.removeEventListener('mousemove', onMouseMove, CAP);
    window.removeEventListener('mouseup', onMouseUp, CAP);
    window.removeEventListener('pointerdown', onPointerDown, CAPP);
    window.removeEventListener('pointermove', onPointerMove, CAPP);
    window.removeEventListener('pointerup', onPointerUp, CAPP);
    window.removeEventListener('pointercancel', onPointerUp, CAPP);
    document.removeEventListener('pointerlockchange', onLockChange);
    document.removeEventListener('pointerlockerror', onLockError);
    domElement.removeEventListener('click', onClick);
    releaseLock();
    clearInput();
  }

  /* ---- 对外 ---- */
  return {
    goTo,
    setFree,
    update,
    PRESETS,
    isFree:  () => free,
    isBusy:  () => busy,
    current: () => (free ? 'free' : presetId),
    /** ★ 返回的是**复用对象**，调用方不得持有（主循环每帧调一次，
     *  本文件其余地方一丝不苟地零分配，这里不该是唯一的破例）。 */
    getStick() {
      const active = stickId !== null;
      _stickOut.x = active ? stick.x : 0;
      _stickOut.y = active ? stick.y : 0;
      _stickOut.active = active;
      return _stickOut;
    },
    dispose
  };
}
