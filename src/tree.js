/**
 * 枯树 —— 递归分枝生成（L-system 的几何版本）
 *
 * 这个文件存在的意义是回答一个问题：亭子是规则的所以能用公式，那不规则的怎么办？
 *
 * 树是「看起来最没有公式」的东西之一。但它不是无规律，只是规律不在闭式公式里，
 * 而在**递归规则**里：一根枝干分成几根更短更细的枝干，每根再照同样的规则分下去。
 * 商业软件 SpeedTree 做的就是这件事。
 *
 * 真正让它像树而不像分形玩具的，是三个叠加在递归上的偏置：
 *   1. 向光性  —— 枝条整体朝上弯（越细越明显）
 *   2. 重力    —— 末梢下垂（越细越明显，和 1 打架，打出来的就是那条 S 形）
 *   3. 噪声    —— 每一段都歪一点，破坏完美对称
 * 去掉任意一条，出来的就是圣诞树或者血管，不是树。
 *
 * 输出：一个合并好的 BufferGeometry（整棵树 1 个 draw call），
 * 顶点色里烤了积雪——朝上的面偏白，朝下的面保持树皮色。
 */

/** 可复现的伪随机（不能用 Math.random，否则每次刷新树都在变） */
function makeRng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;  s >>>= 0;
    return s / 4294967296;
  };
}

export function makeBareTree(THREE, opts = {}) {
  const {
    seed        = 1,
    height      = 4.2,    // 主干长度
    radius      = 0.15,   // 主干根部半径
    depth       = 7,      // 递归层数
    splitMin    = 2,      // 每个节点分出几根
    splitMax    = 3,
    spread      = 0.62,   // 分枝张角（弧度）
    lenRatio    = 0.76,   // 子枝长度比
    radRatio    = 0.68,   // 子枝半径比
    phototropism= 0.16,   // 向光性：朝上弯
    gravity     = 0.22,   // 重力：末梢下垂
    gnarl       = 0.30,   // 噪声扰动
    segPerBranch= 4,      // 每根枝分几段（>1 才能弯）
    radialSeg   = 5,      // 横截面边数（枯枝很细，5 边足够）
    minRadius   = 0.008,
    snowBias    = 0.75,   // 积雪：朝上面的白化强度
    barkColor   = [0.085, 0.072, 0.062],
    snowColor   = [0.82,  0.86,  0.90],
  } = opts;

  const rnd = makeRng(seed);
  const rr = (a, b) => a + rnd() * (b - a);

  const pos = [], nrm = [], col = [], idx = [];
  const UP = new THREE.Vector3(0, 1, 0);

  // 沿一段枝干铺一圈顶点。right/fwd 构成横截面的正交基，
  // 逐段传递（parallel transport）而不是每段重算，否则截面会绕轴乱转。
  function emitRing(p, dir, right, rad, radialSeg) {
    const base = pos.length / 3;
    const fwd = new THREE.Vector3().crossVectors(dir, right).normalize();
    for (let i = 0; i < radialSeg; i++) {
      const a = (i / radialSeg) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const n = new THREE.Vector3()
        .addScaledVector(right, ca)
        .addScaledVector(fwd, sa)
        .normalize();
      pos.push(p.x + n.x * rad, p.y + n.y * rad, p.z + n.z * rad);
      nrm.push(n.x, n.y, n.z);
      // 积雪烤进顶点色：法线朝上 => 白
      const up = Math.max(0, n.y);
      const t = Math.pow(up, 1.6) * snowBias;
      col.push(
        barkColor[0] + (snowColor[0] - barkColor[0]) * t,
        barkColor[1] + (snowColor[1] - barkColor[1]) * t,
        barkColor[2] + (snowColor[2] - barkColor[2]) * t
      );
    }
    return base;
  }

  function bridge(a, b, radialSeg) {          // 两圈之间连三角形
    for (let i = 0; i < radialSeg; i++) {
      const j = (i + 1) % radialSeg;
      idx.push(a + i, b + i, a + j);
      idx.push(a + j, b + i, b + j);
    }
  }

  function branch(p0, dir0, len, rad, level, right0) {
    const dir = dir0.clone().normalize();
    const right = right0.clone();
    let p = p0.clone();
    // 横截面边数按粗细自适应：主干 radialSeg 条棱，末梢降到 3。
    // 递归树的面数指数集中在最细的那一层，而一根 8mm 的枯枝没人看得出它是几边形。
    const rseg = Math.max(3, Math.round(radialSeg * Math.min(1, rad / (radius * 0.45))));
    // 末梢的段数也砍掉一半——它短到弯不出形状
    const nSeg = level > depth * 0.45 ? segPerBranch : Math.max(2, segPerBranch - 2);
    let prevRing = emitRing(p, dir, right, rad, rseg);

    const segLen = len / nSeg;
    const thin = 1 - level / depth;           // 0=主干 1=末梢

    for (let s = 0; s < nSeg; s++) {
      // 三个偏置叠加，这是「像树」的全部秘密
      dir.addScaledVector(UP, phototropism * thin * 0.5);          // 向光
      dir.y -= gravity * thin * thin * 0.5;                        // 重力（末梢更重）
      dir.x += (rnd() - 0.5) * gnarl * 0.5;                        // 扰动
      dir.z += (rnd() - 0.5) * gnarl * 0.5;
      dir.normalize();
      // 截面基向量跟着转，保持正交
      right.addScaledVector(dir, -right.dot(dir)).normalize();

      p.addScaledVector(dir, segLen);
      const r = rad * (1 - (s + 1) / nSeg * (1 - radRatio));
      const ring = emitRing(p, dir, right, Math.max(r, minRadius), rseg);
      bridge(prevRing, ring, rseg);
      prevRing = ring;
    }

    if (level <= 0 || rad * radRatio < minRadius) return;

    const n = Math.round(rr(splitMin, splitMax + 0.999));
    const roll = rnd() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      // 子枝方向 = 父方向绕一个随机轴转开 spread 角
      const a = roll + (i / n) * Math.PI * 2 + rr(-0.35, 0.35);
      const axis = new THREE.Vector3(Math.cos(a), 0, Math.sin(a))
        .addScaledVector(dir, -Math.cos(a) * dir.x - Math.sin(a) * dir.z)
        .normalize();
      const child = dir.clone()
        .applyAxisAngle(axis, spread * rr(0.6, 1.4))
        .normalize();
      const childRight = new THREE.Vector3()
        .crossVectors(child, UP).normalize();
      if (childRight.lengthSq() < 1e-6) childRight.set(1, 0, 0);
      branch(p, child, len * lenRatio * rr(0.82, 1.12),
             rad * radRatio * rr(0.86, 1.08), level - 1, childRight);
    }
  }

  branch(new THREE.Vector3(0, 0, 0), UP.clone(), height, radius, depth,
         new THREE.Vector3(1, 0, 0));

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal',   new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color',    new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** 树桩下的一小堆雪，让树和地面接得住（否则像插进去的） */
export function makeSnowMound(THREE, radius = 0.7, height = 0.16, seg = 14, seed = 9) {
  const rnd = makeRng(seed);
  const g = new THREE.CircleGeometry(radius, seg);
  const pa = g.attributes.position;
  for (let i = 1; i < pa.count; i++) {
    const k = 0.7 + rnd() * 0.55;
    pa.setX(i, pa.getX(i) * k);
    pa.setY(i, pa.getY(i) * k);
    pa.setZ(i, height * (0.35 + rnd() * 0.5));
  }
  pa.setZ(0, height);
  g.computeVertexNormals();
  return g;
}
