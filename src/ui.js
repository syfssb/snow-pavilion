/* ==========================================================================
   src/ui.js —— 湖心亭看雪 · 全部界面
   --------------------------------------------------------------------------
   契约：CONTRACT.md §2.4 / §4.2 / §4.3
     export function createUI({ onTime, onPreset, onFree, onToggle, onEnter })
       -> { setStats, setVerse, setActiveTime, setActivePreset, setReady,
            setFree, setBusy, setTimes, setPresets, setStick, dispose,
            setChrome, setToggle, dismissGate }   ← 末三个是超集扩展，见文件末注释

   本文件：
     · 不 import three，不碰 canvas / WebGL / 相机 / 场景 / 任何 3D 对象
     · 不监听任何 pointerdown / pointermove / pointerup（摇杆输入归 cameras.js）
       只用 click 与 window keydown
     · 全部 CSS 由本文件注入 <style id="hxt-style">，index.html 里不留样式
     · 无 emoji，图标一律内联 SVG；中文衬线，功能性数字/提示无衬线
   ========================================================================== */

/* ---------- 契约常量（CONTRACT §2.4 / §4.2 / §4.3，逐字照抄） ---------- */

const DEFAULT_TIMES = [
  { id: 'dawn',  label: '雪晨' },
  { id: 'dusk',  label: '暮雪' },
  { id: 'night', label: '夜雪' }
];

const DEFAULT_PRESETS = [
  { id: 'vista',  label: '湖心亭一点' },
  { id: 'steps',  label: '阶前仰观'   },
  { id: 'inside', label: '亭中看雪'   },
  { id: 'boat',   label: '余舟一芥'   },
  { id: 'free',   label: '自由行走', free: true }
];

/* CONTRACT §4.3 —— distance < 阈值 则该句 .on */
const VERSE = [
  ['雾凇沆砀，天与云与山与水，上下一白。', 999],
  ['湖上影子，',                            44],
  ['惟长堤一痕、',                          36],
  ['湖心亭一点、',                          26],
  ['与余舟一芥、',                          17],
  ['舟中人两三粒而已。',                      9]
];

const STEP_METERS = 0.72;          // CONTRACT §2.0

/* ---------- 内联 SVG 图标（无 emoji，1px 墨线） ---------- */

const SVG_OPEN =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" ' +
  'stroke="currentColor" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round">';

const ICONS = {
  /* 雪晨：初日在地平线之上 */
  dawn: SVG_OPEN +
    '<circle cx="8" cy="7.1" r="2.85"/>' +
    '<path d="M8 1.5v1.25M14.6 7.1h-1.25M1.4 7.1h1.25M12.05 3.05l-.88.88M3.95 3.05l.88.88"/>' +
    '<path d="M1.4 12.7h13.2" opacity=".5"/></svg>',
  /* 暮雪：日半落，只余上弦 */
  dusk: SVG_OPEN +
    '<path d="M5.15 11.5a2.85 2.85 0 0 1 5.7 0"/>' +
    '<path d="M1.4 11.5h13.2"/>' +
    '<path d="M8 5.5v1.15M12.0 7.15l-.82.82M4.0 7.15l.82.82" opacity=".62"/></svg>',
  /* 夜雪：残月 */
  night: SVG_OPEN +
    '<path d="M10.85 2.5a5.65 5.65 0 1 0 2.95 9.7A6.25 6.25 0 0 1 10.85 2.5z"/></svg>',
  /* 自动环绕：绕行轨道 */
  orbit: SVG_OPEN +
    '<ellipse cx="8" cy="8.5" rx="6.3" ry="2.95"/>' +
    '<path d="M11.15 5.5l1.75.6-.45 1.8"/>' +
    '<circle cx="8" cy="8.5" r="1.05" fill="currentColor" stroke="none"/></svg>'
};

/* ---------- CSS ---------- */

const CSS = `
:root{color-scheme:light}
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;height:100%;overflow:hidden;background:#dfe5ea;
  -webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none}
canvas{display:block;touch-action:none}

body{
  --serif:"Songti SC","STSong","Source Han Serif SC","Noto Serif SC","SimSun",serif;
  --sans:"PingFang SC","Helvetica Neue",system-ui,sans-serif;
  --ink:#2b3138; --ink-2:#464e57; --glow:rgba(232,238,242,.85);
  --hair:rgba(43,49,56,.22); --wash:rgba(228,234,238,.92);
  --paper:#eef2f5; --gate:rgba(223,229,234,.96);
  --scrim:rgba(233,239,243,.62); --scrim-hud:rgba(233,239,243,.80);
  font:14px/1.7 var(--serif); color:var(--ink);
}
body[data-time="dusk"]{
  --ink:#33302c; --ink-2:#4f4a42; --glow:rgba(238,232,222,.80);
  --hair:rgba(51,48,44,.24); --wash:rgba(234,228,218,.92);
  --paper:#f2ece2; --gate:rgba(233,227,217,.95);
  --scrim:rgba(238,232,222,.62); --scrim-hud:rgba(240,234,224,.80);
}
body[data-time="night"]{
  --ink:#dfe7f0; --ink-2:#b8c8da; --glow:rgba(14,20,28,.75);
  --hair:rgba(223,231,240,.24); --wash:rgba(19,27,37,.90);
  --paper:#121922; --gate:rgba(16,22,30,.94);
  --scrim:rgba(11,17,25,.62); --scrim-hud:rgba(9,14,21,.80);
}

/* ---- 根容器：纯覆盖层，默认不拦事件 ---- */
#hxt-root{position:fixed;inset:0;z-index:6;pointer-events:none;
  color:var(--ink);transition:color .9s ease}
#hxt-root *{transition-property:color,border-color,background-color,opacity;
  transition-duration:.9s;transition-timing-function:ease}
#hxt-root.is-hidden > *:not(#hxt-gate){opacity:0!important;pointer-events:none!important;
  transition:opacity .35s ease}
#hxt-root.is-hidden #hxt-gate{opacity:0;pointer-events:none}
/* 闸门未落幕时，界面全部暂不出现；入雪后随 .9s 过渡淡入 */
#hxt-root.gated > *:not(#hxt-gate){opacity:0;pointer-events:none}

/* 贴身光晕（3px，托住笔画本身）+ 柔光（14px，托住整块）。
   单层柔光在暗底上等于没有：14px 的模糊摊到 14px 的字上，笔画边缘一点都没被托到。 */
.hxt-shade{text-shadow:0 0 3px var(--glow),0 1px 14px var(--glow)}

/* ---- 字底纸洗（CONTRACT 外的新增，见 README「界面墨色不跟画面走」一节）----
   界面墨色只跟 body[data-time] 走，不跟画面实际亮度走：暮雪 + 亭中看雪时
   前景是暗木构，深墨字压在 luma 77 的底上，实测对比度只有 1.6:1。
   解法不是把字加粗或加投影（深墨对纯黑的理论对比度上限只有 1.6:1，
   再多的 text-shadow 也到不了 4.5:1），而是给每一簇文字一块自己的纸。
   做法：一个模糊过的实心块当底 —— 中间是平的、四边自然羽化，没有任何硬边。
   它是**自归一化**的：画面亮（雪地 210）时叠上去只亮 10 来级，肉眼几乎看不出；
   画面暗（木构 77）时才真的托起来。留白不破。 */
/* position 只补给本来是 static 的三个（title/stats/hint 已经是 fixed，别覆盖掉） */
#hxt-panel,#hxt-verse,#hxt-dockwrap{position:relative}
.hxt-scrim::before{content:"";position:absolute;z-index:-1;pointer-events:none;
  background:var(--scrim);border-radius:34px;filter:blur(28px);
  transition:background-color .9s ease}
#hxt-title::before{inset:-20px -40px -24px -30px}
#hxt-panel::before{inset:-22px -30px -24px -26px}
#hxt-verse::before{inset:-18px -26px -20px -22px}
/* 机位栏的底挂在包一层的 #hxt-dockwrap 上：#hxt-presets 自己是 overflow-x:auto，
   ::before 会被它裁掉、还会跟着横滑走。 */
#hxt-dockwrap::before{inset:-14px -22px -16px -22px;border-radius:26px;filter:blur(21px)}
/* 数据条 / 提示是 12px 的无衬线小字，--ink-2 又比 --ink 淡一档，
   靠 --scrim 那点浓度到不了 4.5:1；这两块本来就贴在屏幕角上，
   给一层浓一点的 --scrim-hud（等于一小片纸），观感代价最小。 */
#hxt-stats::before,#hxt-hint::before{inset:-13px -22px -15px -22px;border-radius:22px;
  background:var(--scrim-hud);filter:blur(20px)}

/* ---- 左上：标题 ---- */
#hxt-title{position:fixed;top:26px;left:28px;z-index:10;pointer-events:none;max-width:46vw}
#hxt-title h1{margin:0;font-size:clamp(21px,2.4vw,31px);font-weight:400;
  letter-spacing:.40em;text-indent:.40em;line-height:1.35;color:var(--ink)}
#hxt-title .hxt-sub{margin:6px 0 0;font-size:clamp(11px,1.05vw,13px);
  letter-spacing:.30em;text-indent:.30em;color:var(--ink-2);line-height:1.9}
#hxt-title .hxt-by{margin:12px 0 0;display:flex;align-items:center;gap:11px;
  font-size:11.5px;letter-spacing:.24em;color:var(--ink-2);opacity:.85}
#hxt-title .hxt-by i{display:block;width:26px;height:1px;background:var(--hair);flex:none}

/* ---- 右侧竖列：控制面板 + 原文 ---- */
#hxt-rail{position:fixed;top:22px;right:28px;bottom:92px;z-index:10;
  display:flex;flex-direction:column;align-items:flex-end;gap:22px;pointer-events:none}

#hxt-panel{width:172px;flex:none;pointer-events:auto;
  display:flex;flex-direction:column;gap:12px}
#hxt-panel .hxt-lab{font-size:10.5px;letter-spacing:.42em;text-indent:.42em;
  color:var(--ink-2);opacity:.72;margin-bottom:6px;padding-left:13px;
  font-family:var(--serif)}
#hxt-panel .hxt-rule{height:1px;background:var(--hair);width:100%}
.hxt-grp{width:100%}

.hxt-row{display:flex;align-items:center;gap:9px;width:100%;
  padding:5px 0 5px 11px;margin:0;background:none;color:var(--ink);
  border:0;border-left:2px solid transparent;
  font:inherit;font-size:14px;letter-spacing:.20em;cursor:pointer;
  text-align:left;opacity:.44;line-height:1.5}
.hxt-row:hover{opacity:.82}
.hxt-row.on{opacity:1}
.hxt-row .hxt-ic{display:flex;width:14px;height:14px;flex:none;opacity:.9}
.hxt-row .hxt-ic svg{display:block}
.hxt-tm.on{border-left-color:var(--ink)}

/* 开关：一根 1px 横线 + 一颗墨点 */
.hxt-tk{position:relative;margin-left:auto;width:30px;height:12px;display:block;flex:none}
.hxt-tk::before{content:"";position:absolute;left:0;right:0;top:50%;height:1px;
  background:var(--hair)}
.hxt-tk i{position:absolute;top:1px;left:0;width:10px;height:10px;border-radius:50%;
  border:1px solid var(--ink);background:transparent;opacity:.5}
/* 特异性必须压过上面的 #hxt-root *，否则 transform 过渡会被整块覆盖掉 */
#hxt-panel .hxt-tk i{transition:transform .32s ease,background-color .32s ease,
  opacity .32s ease,border-color .9s ease}
.hxt-row.on .hxt-tk i{transform:translateX(20px);background:var(--ink);opacity:1}

#hxt-orbit{display:flex;align-items:center;justify-content:center;gap:9px;width:100%;
  padding:9px 10px;border:1px solid var(--hair);border-radius:2px;background:transparent;
  color:var(--ink);font:inherit;font-size:13px;letter-spacing:.24em;text-indent:.24em;
  cursor:pointer;opacity:.7}
#hxt-orbit:hover{opacity:1;border-color:var(--ink)}
#hxt-orbit.on{opacity:1;border-color:var(--ink);background:var(--ink);color:var(--paper)}
/* 自由行走下 main 的 startOrbit() 会直接拒绝，按钮必须先自己说清「现在不可用」，
   否则点下去是零反馈：ui 先把它画成开、同一个任务里 main 再回调画成关，
   浏览器根本没机会渲染中间态，用户看到的是「点了，什么都没发生」。 */
#hxt-orbit[disabled]{opacity:.3;cursor:default;border-color:var(--hair)}
#hxt-orbit[disabled]:hover{opacity:.3;border-color:var(--hair)}

/* ---- 原文竖排 ---- */
#hxt-verse{flex:1 1 auto;min-height:0;writing-mode:vertical-rl;text-orientation:upright;
  font-size:clamp(12.5px,1.5vw,18px);letter-spacing:.30em;line-height:2.0;
  color:var(--ink);pointer-events:none}
#hxt-verse span{display:inline-block;opacity:0;transition:opacity 2.4s ease}
#hxt-verse span.on{opacity:.93}
#hxt-root.no-verse #hxt-verse{opacity:0}

/* ---- 底部中央：机位栏 ---- */
#hxt-dock{position:fixed;left:0;right:0;bottom:46px;z-index:10;
  display:flex;justify-content:center;pointer-events:none}
#hxt-dockwrap{display:flex;min-width:0;max-width:100%}
#hxt-presets{display:flex;align-items:center;max-width:100%;overflow-x:auto;
  scrollbar-width:none;pointer-events:auto;padding:0 12px;
  -webkit-overflow-scrolling:touch}
#hxt-presets::-webkit-scrollbar{display:none}
/* 滚动条被藏掉了，边缘又没有任何渐隐 —— 390px 下五项只看得见三项，
   「自由行走」整个在屏外，而触屏没有 F 键，等于进不去。
   渐隐只在真的还能往那个方向滚时才加（fade-l / fade-r 由 syncFades() 写）。 */
#hxt-presets.fade-r{-webkit-mask-image:linear-gradient(90deg,#000 0,#000 calc(100% - 26px),transparent 100%);
  mask-image:linear-gradient(90deg,#000 0,#000 calc(100% - 26px),transparent 100%)}
#hxt-presets.fade-l{-webkit-mask-image:linear-gradient(90deg,transparent 0,#000 26px,#000 100%);
  mask-image:linear-gradient(90deg,transparent 0,#000 26px,#000 100%)}
#hxt-presets.fade-l.fade-r{
  -webkit-mask-image:linear-gradient(90deg,transparent 0,#000 26px,#000 calc(100% - 26px),transparent 100%);
  mask-image:linear-gradient(90deg,transparent 0,#000 26px,#000 calc(100% - 26px),transparent 100%)}
.hxt-pv{position:relative;flex:none;padding:7px 15px 9px;border:0;background:none;
  color:var(--ink);font:inherit;font-size:15px;letter-spacing:.26em;text-indent:.26em;
  cursor:pointer;white-space:nowrap;opacity:.42;line-height:1.6}
.hxt-pv:hover{opacity:.8}
.hxt-pv.on{opacity:1}
.hxt-pv.on::after{content:"";position:absolute;left:15px;right:19px;bottom:2px;
  height:1px;background:var(--ink)}
.hxt-sep{flex:none;color:var(--ink);opacity:.24;font-size:12px;user-select:none}

/* ---- 左下：数据条 ---- */
/* 数据条 / 提示都用 --ink 而不是 --ink-2：12px 的小字要过 WCAG 的 4.5:1，
   而 --ink-2 对任何可接受的底都到不了（暮雪 --ink-2 的理论上限只有 4.9:1，
   还要底亮到 239 才拿得到）。层级交给字号（12px / 11.5px）和无衬线字面去分，
   不靠把墨调淡 —— 调淡的代价是在暗画面上直接读不到。 */
#hxt-stats{position:fixed;left:28px;bottom:18px;z-index:10;pointer-events:none;
  font-family:var(--sans);font-size:12px;letter-spacing:.08em;line-height:1.6;
  color:var(--ink);font-variant-numeric:tabular-nums;white-space:nowrap}
#hxt-stats b{font-weight:600;color:var(--ink)}
#hxt-root.no-hud #hxt-stats{opacity:0}

/* ---- 右下：操作提示 ---- */
#hxt-hint{position:fixed;right:28px;bottom:18px;z-index:10;pointer-events:none;
  font-family:var(--sans);font-size:11.5px;letter-spacing:.10em;line-height:1.6;
  color:var(--ink);text-align:right;max-width:44vw}

/* ---- 过渡中锁 UI ----
   #hxt-presets 自己写了 pointer-events:auto，会把 #hxt-dock 的 none 顶回来，
   于是「变暗 = 锁住」这个视觉承诺对鼠标点击是假的（实测过渡中机位按钮照样可点）。
   键盘那一半在 onKeyDown 里补（state.busy 直接 return）。 */
#hxt-root.is-busy #hxt-panel,
#hxt-root.is-busy #hxt-dock{opacity:.35;pointer-events:none;transition:opacity .3s ease}
#hxt-root.is-busy #hxt-presets,
#hxt-root.is-busy #hxt-dockwrap{pointer-events:none}

/* ---- 键盘焦点 ---- 
   .hxt-row 常态 opacity 只有 .44，纯键盘 Tab 过去时浏览器默认焦点环几乎看不清。 */
#hxt-root :focus-visible{outline:1px solid var(--ink);outline-offset:3px;opacity:1}

/* ---- 触屏摇杆（纯装饰，事件归 cameras.js） ---- */
#hxt-touch{position:fixed;inset:0;z-index:8;pointer-events:none;display:none}
#hxt-root.is-coarse.is-free #hxt-touch{display:block}
#hxt-stick{position:absolute;left:26px;bottom:calc(26px + env(safe-area-inset-bottom,0px));
  width:118px;height:118px;
  border:1px solid var(--hair);border-radius:50%;opacity:.42;
  transition:opacity .25s ease}
#hxt-stick.on{opacity:1}
#hxt-knob{position:absolute;left:50%;top:50%;width:46px;height:46px;margin:-23px 0 0 -23px;
  border-radius:50%;background:var(--hair);border:1px solid var(--hair)}

/* ---- 入场闸门 ---- */
#hxt-gate{position:fixed;inset:0;z-index:20;pointer-events:auto;
  display:flex;align-items:center;justify-content:center;
  background:var(--gate);transition:opacity .9s ease}
#hxt-gate.gone{opacity:0;pointer-events:none}
.hxt-gate-in{display:flex;flex-direction:column;align-items:center;gap:20px;
  padding:0 24px;text-align:center}
.hxt-gate-in h2{margin:0;font-size:clamp(26px,5vw,42px);font-weight:400;
  letter-spacing:.5em;text-indent:.5em;color:var(--ink)}
.hxt-gate-rule{width:52px;height:1px;background:var(--hair)}
.hxt-quote{margin:0;font-size:clamp(13px,1.5vw,16px);letter-spacing:.26em;
  text-indent:.26em;line-height:2.1;color:var(--ink);opacity:.82;max-width:30em}
.hxt-quote em{display:block;margin-top:10px;font-style:normal;font-size:11.5px;
  letter-spacing:.24em;color:var(--ink-2);opacity:.9}
.hxt-tip{margin:0;font-family:var(--sans);font-size:12px;letter-spacing:.14em;
  line-height:2;color:var(--ink-2);min-height:2em}
#hxt-enter{font:inherit;font-family:var(--serif);font-size:14px;letter-spacing:.28em;
  text-indent:.28em;color:var(--ink);background:transparent;border:1px solid var(--hair);
  border-radius:2px;padding:11px 30px;cursor:pointer;
  transition:background-color .25s ease,color .25s ease,border-color .25s ease,opacity .3s ease}
#hxt-enter:hover:not([disabled]){background:var(--ink);color:var(--paper);border-color:var(--ink)}
#hxt-enter[disabled]{opacity:.34;cursor:default}

/* ---- 抽屉把手：仅窄屏出现 ---- */
#hxt-tab{display:none;position:fixed;top:16px;right:16px;z-index:12;pointer-events:auto;
  border:1px solid var(--hair);border-radius:2px;background:transparent;color:var(--ink);
  font:inherit;font-family:var(--serif);font-size:12px;letter-spacing:.22em;
  text-indent:.22em;padding:7px 13px;cursor:pointer;opacity:.8}
#hxt-tab:hover{opacity:1}

/* 矮窗（笔记本 720p）：原文收一档，宁可排成两列也不要挤到机位栏 */
@media (min-width:721px) and (max-height:840px){
  #hxt-verse{font-size:clamp(12px,1.35vw,16px);letter-spacing:.28em;line-height:1.92}
  #hxt-title .hxt-by{margin-top:9px}
}

/* ---- 窄屏：面板收起为底部抽屉 ---- */
@media (max-width:720px){
  #hxt-title{top:18px;left:18px;max-width:58vw}
  #hxt-stats{display:none}
  #hxt-hint{display:none}
  #hxt-verse{font-size:clamp(12px,3.4vw,15px);letter-spacing:.30em}
  /* env() 让开 iPhone 的 home indicator（34px 手势条）。
     index.html 的 viewport 已经带了 viewport-fit=cover，取得到值。 */
  #hxt-dock{bottom:calc(24px + env(safe-area-inset-bottom,0px))}
  /* 触摸目标：原来 38px，iOS HIG 与 WCAG 2.5.5 的下限都是 44px */
  .hxt-pv{font-size:14px;padding:12px 12px 13px}
  .hxt-pv.on::after{left:12px;right:16px;bottom:6px}
}
@media (max-width:620px){
  #hxt-tab{display:block}
  #hxt-rail{top:14px;right:16px;bottom:auto;display:block}
  #hxt-verse{display:block;margin-top:46px;max-height:56vh;height:auto}
  #hxt-panel{position:fixed;left:0;right:0;bottom:0;top:auto;width:auto;
    padding:20px 20px calc(20px + env(safe-area-inset-bottom,0px));
    background:var(--wash);border-top:1px solid var(--hair);
    display:grid;grid-template-columns:1fr 1fr;gap:12px 22px;align-items:start;
    transform:translateY(102%);transition:transform .42s cubic-bezier(.4,0,.2,1)}
  #hxt-panel::before{display:none}          /* 抽屉本身已经是实底 --wash，不叠 */
  #hxt-panel .hxt-rule{display:none}
  #hxt-orbit{grid-column:1/-1;margin-top:2px;padding:13px 10px}   /* 42px → 46px */
  #hxt-root.drawer-open #hxt-panel{transform:none}
  #hxt-dock{transition:transform .42s cubic-bezier(.4,0,.2,1),opacity .3s ease}
  #hxt-root.drawer-open #hxt-dock{
    transform:translateY(calc(-1 * var(--hxt-drawer-h,0px) - 10px))}
  #hxt-presets{padding:0 16px}
  /* 时辰 / 开关行：31px → 45px */
  .hxt-row{padding:12px 0 12px 11px}
  /* 自由行走 + 触屏：机位栏让开左下角的摇杆 */
  #hxt-root.is-coarse.is-free #hxt-dock{left:158px;justify-content:flex-end;
    bottom:calc(30px + env(safe-area-inset-bottom,0px))}
  #hxt-root.is-coarse.is-free #hxt-presets{padding-right:16px}
}
@media (max-width:420px){
  #hxt-title h1{font-size:19px;letter-spacing:.30em;text-indent:.30em}
  #hxt-title .hxt-sub{letter-spacing:.20em;text-indent:.20em}
  /* 五项全部放进 390px：收字距、收左右内边距，纵向 padding 保持 44px 触摸目标；
     分隔点在这一档隐掉（挤不下，而且渐隐已经在说明「还能滚」）。 */
  .hxt-sep{display:none}
  .hxt-pv{font-size:13px;letter-spacing:.07em;text-indent:.07em;padding:12px 7px 13px}
  .hxt-pv.on::after{left:7px;right:8px}
  #hxt-presets{padding:0 10px}
}
@media (prefers-reduced-motion:reduce){
  #hxt-root *,#hxt-gate,#hxt-panel .hxt-tk i,#hxt-verse span{
    transition-duration:.01ms!important}
}
`;

/* ---------- 小工具 ---------- */

function el(tag, id, cls) {
  const n = document.createElement(tag);
  if (id) n.id = id;
  if (cls) n.className = cls;
  return n;
}

function safe(fn, ...args) {
  if (typeof fn !== 'function') return;
  try { fn(...args); } catch (err) { console.error('[ui] callback error:', err); }
}

/* ==========================================================================
   createUI
   ========================================================================== */

export function createUI(opts = {}) {
  const { onTime, onPreset, onFree, onToggle, onEnter } = opts || {};

  const host = document.body || document.documentElement;

  /* ---------- 注入 CSS ---------- */
  const style = el('style', 'hxt-style');
  style.textContent = CSS;
  document.head.appendChild(style);

  if (!document.body.dataset.time) document.body.dataset.time = 'dawn';

  /* ---------- 骨架 ---------- */
  const root = el('div', 'hxt-root');

  /* 左上标题 */
  const title = el('header', 'hxt-title', 'hxt-shade hxt-scrim');
  title.innerHTML =
    '<h1>湖心亭看雪</h1>' +
    '<p class="hxt-sub">程序化生成的雪湖 · 一亭一舟一长堤</p>' +
    '<p class="hxt-by"><i></i>张岱　明崇祯五年</p>';

  /* 右侧竖列 */
  const rail   = el('div', 'hxt-rail');
  const panel  = el('section', 'hxt-panel', 'hxt-shade hxt-scrim');

  const grpTime = el('div', null, 'hxt-grp');
  const labTime = el('div', null, 'hxt-lab'); labTime.textContent = '时辰';
  const timesBox = el('div', 'hxt-times');
  grpTime.appendChild(labTime); grpTime.appendChild(timesBox);

  const rule1 = el('div', null, 'hxt-rule');

  const grpView = el('div', null, 'hxt-grp');
  const labView = el('div', null, 'hxt-lab'); labView.textContent = '景致';
  const swBox = el('div', 'hxt-switches');
  grpView.appendChild(labView); grpView.appendChild(swBox);

  const rule2 = el('div', null, 'hxt-rule');

  const orbitBtn = el('button', 'hxt-orbit');
  orbitBtn.type = 'button';
  orbitBtn.setAttribute('aria-pressed', 'false');
  orbitBtn.innerHTML = '<span class="hxt-ic">' + ICONS.orbit + '</span><span>自动环绕</span>';

  panel.appendChild(grpTime); panel.appendChild(rule1);
  panel.appendChild(grpView); panel.appendChild(rule2);
  panel.appendChild(orbitBtn);

  const verse = el('div', 'hxt-verse', 'hxt-shade hxt-scrim');
  const verseSpans = VERSE.map(([text]) => {
    const s = document.createElement('span');
    s.textContent = text;
    verse.appendChild(s);
    return s;
  });

  rail.appendChild(panel);
  rail.appendChild(verse);

  /* 底部机位栏 */
  const dock = el('nav', 'hxt-dock');
  dock.setAttribute('aria-label', '机位');
  const dockWrap = el('div', 'hxt-dockwrap', 'hxt-scrim');
  const presetsBox = el('div', 'hxt-presets');
  dockWrap.appendChild(presetsBox);
  dock.appendChild(dockWrap);

  /* 左下数据条 */
  const stats = el('div', 'hxt-stats', 'hxt-shade hxt-scrim');
  stats.innerHTML =
    '距亭 <b data-f="steps">–</b> 步　·　<b data-f="fps">–</b> fps　·　' +
    '<b data-f="tris">–</b> 面　·　<b data-f="calls">–</b> draw calls' +
    '<span data-f="deg" hidden>　·　bloom ½</span>';
  const statFields = {
    steps: stats.querySelector('[data-f="steps"]'),
    fps:   stats.querySelector('[data-f="fps"]'),
    tris:  stats.querySelector('[data-f="tris"]'),
    calls: stats.querySelector('[data-f="calls"]'),
    deg:   stats.querySelector('[data-f="deg"]')
  };

  /* 右下操作提示 */
  const hint = el('div', 'hxt-hint', 'hxt-shade hxt-scrim');

  /* 抽屉把手 */
  const tab = el('button', 'hxt-tab');
  tab.type = 'button';
  tab.textContent = '时辰';
  tab.setAttribute('aria-expanded', 'false');

  /* 触屏摇杆（纯渲染） */
  const touch = el('div', 'hxt-touch');
  const stick = el('div', 'hxt-stick');
  const knob  = el('div', 'hxt-knob');
  stick.appendChild(knob);
  touch.appendChild(stick);

  /* 入场闸门 */
  const gate = el('div', 'hxt-gate');
  const gateIn = el('div', null, 'hxt-gate-in');
  gateIn.innerHTML =
    '<h2>湖心亭看雪</h2>' +
    '<div class="hxt-gate-rule"></div>' +
    '<p class="hxt-quote">雾凇沆砀，天与云与山与水，上下一白。' +
    '<em>崇祯五年十二月，余住西湖</em></p>';
  const gateTip = el('p', null, 'hxt-tip');
  gateTip.textContent = '载入材质中…';
  const gateBtn = el('button', 'hxt-enter');
  gateBtn.type = 'button';
  gateBtn.disabled = true;
  gateBtn.textContent = '入　雪';
  gateIn.appendChild(gateTip);
  gateIn.appendChild(gateBtn);
  gate.appendChild(gateIn);

  root.classList.add('gated');
  root.appendChild(title);
  root.appendChild(rail);
  root.appendChild(dock);
  root.appendChild(stats);
  root.appendChild(hint);
  root.appendChild(tab);
  root.appendChild(touch);
  root.appendChild(gate);
  host.appendChild(root);

  /* ---------- 状态 ---------- */
  const state = {
    times:   DEFAULT_TIMES.slice(),
    presets: DEFAULT_PRESETS.slice(),
    time:    'dawn',
    preset:  'vista',
    lastPreset: 'vista',        // 最近一个非 free 机位（Esc 归位用）
    free:    false,
    busy:    null,              // null = 未初始化，保证首次一定写一次
    ready:   false,
    gateGone:false,
    chrome:  true,
    verseOn: true,
    hudOn:   true,
    drawer:  false,
    toggles: { lantern: true, snow: true, orbit: false },
    verseMask: -1,
    reducedMotion: !!(window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches),
    stickActive: null,
    knobDirty: false,
    lastDistance: null,
    readyHint: ''
  };

  const coarseMQ = window.matchMedia ? window.matchMedia('(hover: none)') : null;
  let coarse = !!(coarseMQ && coarseMQ.matches);
  root.classList.toggle('is-coarse', coarse);

  /* ---------- 提示文案 ---------- */
  function hintText() {
    if (coarse) {
      return state.free
        ? '左下摇杆行走　·　右半屏拖动转视角'
        : '点选下方机位　·　自由行走可漫游';
    }
    return state.free
      /* 指针锁定时第一次 Esc 被浏览器吃掉用来解锁指针，第二次才到这里 ——
         标准行为，但提示语得说出来，否则读起来像「Esc 没反应」。 */
      ? 'W A S D 行走　·　Shift 快走　·　拖动转视角　·　Esc 松开鼠标 / 再按一次归位'
      : '点选机位　·　F 自由行走　·　1 2 3 换时辰　·　[ ] 上下机位';
  }
  /* 右下提示随模式变化；setReady 的 hint 只用于闸门那一行 */
  function syncHint() {
    hint.textContent = hintText();
  }

  /* ---------- 渲染：时辰 ---------- */
  const timeBtns = new Map();
  function renderTimes() {
    timeBtns.clear();
    timesBox.textContent = '';
    state.times.forEach(t => {
      if (!t || !t.id) return;
      const b = el('button', null, 'hxt-row hxt-tm');
      b.type = 'button';
      b.dataset.id = t.id;
      b.setAttribute('aria-pressed', String(t.id === state.time));
      const ic = el('span', null, 'hxt-ic');
      ic.innerHTML = ICONS[t.id] || '';
      const lb = document.createElement('span');
      lb.textContent = t.label || t.id;
      b.appendChild(ic); b.appendChild(lb);
      b.addEventListener('click', () => {
        setActiveTime(t.id);
        safe(onTime, t.id);
        if (state.drawer) setDrawer(false);
      });
      timesBox.appendChild(b);
      timeBtns.set(t.id, b);
    });
    paintTimes();
  }
  function paintTimes() {
    timeBtns.forEach((b, id) => {
      const on = id === state.time;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }

  /* ---------- 渲染：开关 ---------- */
  const swBtns = new Map();
  function renderSwitches() {
    swBtns.clear();
    swBox.textContent = '';
    [['lantern', '亭中灯火'], ['snow', '落　　雪']].forEach(([key, label]) => {
      const b = el('button', null, 'hxt-row hxt-sw');
      b.type = 'button';
      b.dataset.key = key;
      const lb = document.createElement('span');
      lb.textContent = label;
      const tk = el('span', null, 'hxt-tk');
      tk.appendChild(document.createElement('i'));
      b.appendChild(lb); b.appendChild(tk);
      b.addEventListener('click', () => {
        setToggle(key, !state.toggles[key]);
        safe(onToggle, key, state.toggles[key]);
      });
      swBox.appendChild(b);
      swBtns.set(key, b);
    });
    paintToggles();
  }
  function paintToggles() {
    swBtns.forEach((b, key) => {
      const on = !!state.toggles[key];
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    const orbit = !!state.toggles.orbit;
    orbitBtn.classList.toggle('on', orbit);
    orbitBtn.setAttribute('aria-pressed', String(orbit));
  }

  orbitBtn.addEventListener('click', () => {
    if (orbitBtn.disabled) return;
    setToggle('orbit', !state.toggles.orbit);
    safe(onToggle, 'orbit', state.toggles.orbit);
  });

  /* 自由行走下 main 的 startOrbit() 会直接拒绝 —— 与其让按钮零反馈，不如置灰。
     state.free 有两条写入路径（setFree 与 setActivePreset('free')），都要过这里。 */
  function syncOrbitEnabled() {
    const off = !!state.free || !!state.reducedMotion;
    if (orbitBtn.disabled !== off) orbitBtn.disabled = off;
    orbitBtn.setAttribute('aria-disabled', String(off));
    orbitBtn.title = state.reducedMotion
      ? '系统已开启「减弱动态效果」，自动环绕已停用'
      : (off ? '退出自由行走后可用' : '');
  }

  /* ---------- 渲染：机位 ---------- */
  const presetBtns = new Map();
  function renderPresets() {
    presetBtns.clear();
    presetsBox.textContent = '';
    const list = state.presets.filter(p => p && p.id);
    list.forEach((p, i) => {
      if (i > 0) {
        const sep = el('span', null, 'hxt-sep');
        sep.textContent = '·';
        presetsBox.appendChild(sep);
      }
      const b = el('button', null, 'hxt-pv');
      b.type = 'button';
      b.dataset.id = p.id;
      b.textContent = p.label || p.id;
      const isFree = p.free === true || p.id === 'free';
      b.addEventListener('click', () => {
        if (isFree) {
          setFree(true);
          safe(onFree, true);
        } else {
          setActivePreset(p.id);
          safe(onPreset, p.id);
        }
        if (state.drawer) setDrawer(false);
      });
      presetsBox.appendChild(b);
      presetBtns.set(p.id, b);
    });
    paintPresets();
  }
  function paintPresets() {
    const active = state.free ? 'free' : state.preset;
    presetBtns.forEach((b, id) => {
      const on = id === active;
      b.classList.toggle('on', on);
      b.setAttribute('aria-current', on ? 'true' : 'false');
    });
    centerActivePreset();
  }

  /* 机位栏两端的渐隐：只在那个方向真的还能滚时才加。
     静态的两端渐隐会在滚不动时也画一道虚边，等于撒谎。 */
  function syncFades() {
    const box = presetsBox;
    const max = box.scrollWidth - box.clientWidth;
    const can = max > 1;
    box.classList.toggle('fade-l', can && box.scrollLeft > 1);
    box.classList.toggle('fade-r', can && box.scrollLeft < max - 1);
  }

  /* 窄屏机位栏可横滑：把激活项居中，不用 scrollIntoView（那会连带滚整页） */
  function centerActivePreset() {
    const b = presetBtns.get(state.free ? 'free' : state.preset);
    if (!b) { syncFades(); return; }
    const box = presetsBox;
    if (box.scrollWidth <= box.clientWidth + 1) { syncFades(); return; }
    const want = b.offsetLeft - (box.clientWidth - b.offsetWidth) / 2;
    const max = box.scrollWidth - box.clientWidth;
    box.scrollLeft = Math.max(0, Math.min(max, want));
    syncFades();
  }

  /* 非 free 机位的 id 列表，供 [ ] 循环 */
  function walkablePresets() {
    return state.presets
      .filter(p => p && p.id && p.free !== true && p.id !== 'free')
      .map(p => p.id);
  }

  /* ---------- 抽屉 ---------- */
  function measureDrawer() {
    // 抽屉是 fixed 元素，机位栏要靠 CSS 变量让位，不能写死高度
    root.style.setProperty('--hxt-drawer-h', panel.offsetHeight + 'px');
  }
  function setDrawer(on) {
    on = !!on;
    if (on === state.drawer) return;
    state.drawer = on;
    if (on) measureDrawer();
    root.classList.toggle('drawer-open', on);
    tab.textContent = on ? '收起' : '时辰';
    tab.setAttribute('aria-expanded', String(on));
  }
  tab.addEventListener('click', () => setDrawer(!state.drawer));

  function onResize() {
    if (state.drawer) measureDrawer();
    centerActivePreset();
  }
  window.addEventListener('resize', onResize);
  presetsBox.addEventListener('scroll', syncFades, { passive: true });

  /* ---------- 闸门 ---------- */
  function dismissGate() {
    if (state.gateGone) return false;
    state.gateGone = true;
    gate.classList.add('gone');
    root.classList.remove('gated');
    return true;
  }
  gateBtn.addEventListener('click', () => {
    if (gateBtn.disabled) return;
    if (dismissGate()) safe(onEnter);
  });

  /* ---------- 契约方法 ---------- */

  function setStats(o) {
    const s = o || {};
    let steps = s.steps;
    if (steps == null && state.lastDistance != null) {
      steps = state.lastDistance / STEP_METERS;
    }
    statFields.steps.textContent = fmt(steps, 0);
    statFields.fps.textContent   = fmt(s.fps, 0);
    statFields.tris.textContent  = fmt(s.tris, 0, true);
    statFields.calls.textContent = fmt(s.calls, 0);
    /* bloom 降到半分辨率是静默发生的，不说一声就没人知道画面为什么变糊。
       原来是 console.info 一行 —— 那是调试输出，挪到数据条上才是给用户看的。 */
    if (statFields.deg) statFields.deg.hidden = !s.bloomHalf;
  }
  function fmt(v, digits, group) {
    if (v == null || typeof v !== 'number' || !isFinite(v)) return '–';
    const n = digits ? Number(v.toFixed(digits)) : Math.round(v);
    return group ? n.toLocaleString('en-US') : String(n);
  }

  function setVerse(distance) {
    if (typeof distance !== 'number' || !isFinite(distance)) return;
    state.lastDistance = distance;
    let mask = 0;
    for (let i = 0; i < VERSE.length; i++) {
      if (distance < VERSE[i][1]) mask |= (1 << i);
    }
    if (mask === state.verseMask) return;
    state.verseMask = mask;
    for (let i = 0; i < verseSpans.length; i++) {
      verseSpans[i].classList.toggle('on', (mask & (1 << i)) !== 0);
    }
  }

  function setActiveTime(id) {
    if (!id) return;
    state.time = id;
    document.body.dataset.time = id;
    paintTimes();
  }

  function setActivePreset(id) {
    if (!id) return;
    if (id === 'free') {
      state.free = true;
    } else {
      state.preset = id;
      state.lastPreset = id;
      state.free = false;
    }
    root.classList.toggle('is-free', state.free);
    syncOrbitEnabled();
    paintPresets();
    syncHint();
  }

  function setReady(hintStr) {
    state.ready = true;
    state.readyHint = typeof hintStr === 'string' ? hintStr : '';
    gateBtn.disabled = false;
    gateTip.textContent = state.readyHint || (coarse
      ? '左下摇杆行走　·　右半屏拖动转视角'
      : '点击进入　·　W A S D 行走　·　鼠标转视角　·　Shift 快走');
    syncHint();
  }

  function setFree(on) {
    on = !!on;
    if (on === state.free) { paintPresets(); return; }
    state.free = on;
    if (on) {
      state.lastPreset = state.preset || state.lastPreset;
    }
    root.classList.toggle('is-free', on);
    if (!on) {
      // 退出自由：旋钮归位，避免残留位移
      state.stickActive = null;
      stick.classList.remove('on');
      if (state.knobDirty) { knob.style.transform = ''; state.knobDirty = false; }
    }
    syncOrbitEnabled();
    paintPresets();
    syncHint();
  }

  function setBusy(on) {
    on = !!on;
    if (on === state.busy) return;      // 每帧调用，值没变直接 return
    state.busy = on;
    root.classList.toggle('is-busy', on);
  }

  function setTimes(list) {
    if (!Array.isArray(list) || !list.length) return;
    state.times = list.map(t => ({ id: t.id, label: t.label }));
    renderTimes();
  }

  function setPresets(list) {
    if (!Array.isArray(list) || !list.length) return;
    state.presets = list.map(p => ({ id: p.id, label: p.label, free: p.free === true }));
    renderPresets();
  }

  function setStick(x, y, active) {
    active = !!active;
    if (active !== state.stickActive) {
      state.stickActive = active;
      stick.classList.toggle('on', active);
    }
    if (!active) {
      if (state.knobDirty) { knob.style.transform = ''; state.knobDirty = false; }
      return;
    }
    const px = (typeof x === 'number' && isFinite(x) ? x : 0) * 36;
    const py = (typeof y === 'number' && isFinite(y) ? y : 0) * 36;
    knob.style.transform = 'translate(' + px.toFixed(1) + 'px,' + py.toFixed(1) + 'px)';
    state.knobDirty = true;
  }

  /* ---------- 扩展方法（超集，见文件末） ---------- */

  function setChrome(on) {
    on = !!on;
    if (on === state.chrome) return;
    state.chrome = on;
    root.classList.toggle('is-hidden', !on);
    if (!on) setDrawer(false);
  }

  function setToggle(key, on) {
    if (!key || !(key in state.toggles)) return;
    on = !!on;
    if (state.toggles[key] === on) return;
    state.toggles[key] = on;
    paintToggles();
  }

  /* 内部：原文 / 数据 的本地显隐（V / H 键） */
  function applyVerseVisible(on) {
    state.verseOn = !!on;
    root.classList.toggle('no-verse', !state.verseOn);
  }
  function applyHudVisible(on) {
    state.hudOn = !!on;
    root.classList.toggle('no-hud', !state.hudOn);
  }

  /* ---------- 快捷键（CONTRACT §2.4） ---------- */
  function onKeyDown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.repeat) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    // 闸门未落幕时不劫持按键（让 Enter / 空格走按钮本身）
    if (!state.gateGone) return;
    /* 过渡中一律不受理：鼠标拖动与触摸本来就被 cameras.js 拦住了，
       键盘不拦的话「变暗 = 锁住」这个视觉承诺只兑现一半
       （实测过渡中按 ] 会改目标机位、按 F 会把过渡直接打断）。 */
    if (state.busy) return;

    const code = e.code;
    const key  = (e.key || '').toLowerCase();

    if (code === 'Digit1' || key === '1') { pickTime(0); e.preventDefault(); return; }
    if (code === 'Digit2' || key === '2') { pickTime(1); e.preventDefault(); return; }
    if (code === 'Digit3' || key === '3') { pickTime(2); e.preventDefault(); return; }

    if (code === 'BracketLeft')  { cyclePreset(-1); e.preventDefault(); return; }
    if (code === 'BracketRight') { cyclePreset( 1); e.preventDefault(); return; }

    if (code === 'KeyF') {
      if (!state.free) { setFree(true); safe(onFree, true); }
      e.preventDefault(); return;
    }
    if (code === 'Escape') {
      if (state.free) {
        setFree(false);
        safe(onFree, false);
        const back = state.lastPreset || walkablePresets()[0];
        if (back) { setActivePreset(back); safe(onPreset, back); }
      }
      e.preventDefault(); return;
    }
    if (code === 'KeyV') {
      applyVerseVisible(!state.verseOn);
      safe(onToggle, 'verse', state.verseOn);
      e.preventDefault(); return;
    }
    if (code === 'KeyH') {
      applyHudVisible(!state.hudOn);
      safe(onToggle, 'hud', state.hudOn);
      e.preventDefault(); return;
    }
    if (code === 'KeyC') {
      setChrome(!state.chrome);
      safe(onToggle, 'chrome', state.chrome);
      e.preventDefault(); return;
    }
  }

  function pickTime(i) {
    const t = state.times[i];
    if (!t || !t.id) return;
    setActiveTime(t.id);
    safe(onTime, t.id);
  }

  function cyclePreset(dir) {
    const ids = walkablePresets();
    if (!ids.length) return;
    const cur = state.free ? (state.lastPreset || ids[0]) : state.preset;
    let i = ids.indexOf(cur);
    if (i < 0) i = 0;
    else i = (i + dir + ids.length) % ids.length;
    const id = ids[i];
    if (state.free) { setFree(false); safe(onFree, false); }
    setActivePreset(id);
    safe(onPreset, id);
  }

  window.addEventListener('keydown', onKeyDown);

  /* 粗指针（触屏）状态跟随系统变化 */
  function onCoarseChange(ev) {
    coarse = !!(ev && 'matches' in ev ? ev.matches : coarseMQ && coarseMQ.matches);
    root.classList.toggle('is-coarse', coarse);
    syncHint();
  }
  if (coarseMQ) {
    if (coarseMQ.addEventListener) coarseMQ.addEventListener('change', onCoarseChange);
    else if (coarseMQ.addListener) coarseMQ.addListener(onCoarseChange);
  }

  /* ---------- 初始渲染 ---------- */
  renderTimes();
  renderSwitches();
  renderPresets();
  syncOrbitEnabled();
  setActiveTime(state.time);
  paintPresets();
  syncHint();
  setStats({});

  /* ---------- dispose ---------- */
  function dispose() {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('resize', onResize);
    if (coarseMQ) {
      if (coarseMQ.removeEventListener) coarseMQ.removeEventListener('change', onCoarseChange);
      else if (coarseMQ.removeListener) coarseMQ.removeListener(onCoarseChange);
    }
    if (root.parentNode) root.parentNode.removeChild(root);
    if (style.parentNode) style.parentNode.removeChild(style);
  }

  return {
    /* 契约必须 */
    setStats, setVerse, setActiveTime, setActivePreset,
    setReady, setFree, setBusy, setTimes, setPresets, setStick, dispose,
    /* 超集扩展 */
    setChrome, setToggle, dismissGate,
    /* 系统「减弱动态效果」开关：main 据此把机位过渡改成瞬移、拒绝自动环绕。
       CSS 的 prefers-reduced-motion 块只压得住 DOM 过渡，压不住 2.2 秒的相机飞行，
       而对前庭敏感的人来说，会动的恰恰是相机那一部分。 */
    prefersReducedMotion: () => !!state.reducedMotion
  };
}

/* ==========================================================================
   超集扩展说明（整合者接线用，契约里没有，但不影响契约内的任何调用）

   setChrome(on)
     一次性显隐全部界面（含闸门）。?shot=1 的「ui 全部隐藏」用它：
        if (shot) { ui.setChrome(false); }
     `C` 键内部也走它，并同时回调 onToggle('chrome', on)。

   dismissGate()
     不点按钮直接落幕（?shot=1 / 调试用）。闸门未落幕时界面是隐藏的，
     所以「跳过闸门但保留界面」必须调它，不能只靠 setChrome。
     返回 true 表示这次确实落幕了（不会重复触发 onEnter，它也不调 onEnter）。

   setToggle(key, on)   key ∈ 'lantern' | 'snow' | 'orbit'
     只改 UI 上的开关外观，不触发回调。main.js 需要反向同步时用
     （例如点了机位后自动关掉环绕：ui.setToggle('orbit', false)）。

   新增的三个 onToggle key（契约里 key 只有 verse/hud/chrome）：
     onToggle('lantern', on)  亭中灯火
     onToggle('snow',    on)  落雪
     onToggle('orbit',   on)  自动环绕
   main.js 若不接，点了只是 UI 动一下，场景无反应；接法见交付说明的 risks。
   ========================================================================== */
