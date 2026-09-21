/**
 * 碰撞解析引擎（浏览器 / Node 通用，零依赖）
 *
 * 模型：每位表演者的运动是由关键帧定义的分段直线函数 p(t)。
 * 相邻关键帧之间位置随时间线性插值；关键帧之外（全局起止之间）保持静止。
 *
 * 关键帧可携带可选安全半径 r（表现开伞、展开道具等占用范围变化）：
 *  - 未设置（缺省/null）时继承表演者当前身体半径；
 *  - 相邻关键帧之间半径与位置同步线性插值；首尾之外保持端点值。
 *
 * 对任意两人 A、B，在两人各自同一段分段线性区间内，相对位置与半径和
 * 都是时间 t 的一次函数：
 *
 *     r(t) = pA(t) - pB(t) = u + v t
 *     R(t) = RA(t) + RB(t) = c + d t          （c、d 为常数，R(t) ≥ 0）
 *
 * 碰撞条件 |r(t)| ≤ R(t) 平方后是关于 t 的一般二次不等式：
 *
 *     (|v|² - d²) t² + 2(u·v - c d) t + |u|² - c² ≤ 0
 *
 * 二次项系数可正可负（半径快速张开时为负），统一按求根公式精确求解并
 * 钳制到重叠时间窗；再合并跨段相邻区间。全程没有任何离散帧抽样——
 * 解出的就是碰撞发生的精确时间区间。
 *
 * 此外对每一对连续求"最小安全余量"及其发生时刻：
 *
 *     m(t) = |r(t)| - R(t) = sqrt(q(t)) - (c + d t)，q(t) = |u + v t|²
 *
 * sqrt(q) 是凸函数、R 是线性函数，故 m 在段内恒为凸函数：全局最小只可能
 * 落在段端点，或 |v| > |d| 时唯一的驻点
 *
 *     t* = (-u·v + d·sqrt((|u|²|v|² - (u·v)²) / (|v|² - d²))) / |v|²
 *
 * 退化情形由同一公式/分支覆盖：相对静止（v = 0）或半径变化比相对运动快
 * （|v| ≤ |d|）时 m 单调，最小在端点；相对轨迹过原点（|u×v| = 0，距离
 * 可为零）时驻点即 |r| = 0 的尖点。同样全程解析，不做任何时间采样。
 *
 * 舞台禁入矩形：场景可含 obstacles（轴对齐矩形）。把表演者按实时安全半径
 * 视为圆，圆心进入"矩形 ⊕ 半径 R(t) 圆盘"（圆角矩形膨胀边界）即侵入。
 * 每段内该条件分解为：上下/左右边条带（关于 t 的线性不等式组，半径随时间
 * 线性变化时仍是线性的）与四个角点圆盘（|p(t) − corner| ≤ R(t)，与双人
 * 碰撞同型的一般二次不等式），并集即本段精确进入/离开区间；跨关键帧合并，
 * 覆盖矩形内起步、仅角点相切（零长度区间）、半径随时间变化等情形，
 * 全程无帧抽样。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CollisionCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var EPS = 1e-9;          // 数值零容差
  var MERGE_EPS = 1e-6;    // 区间合并间隙（秒）

  function clamp(x, lo, hi) {
    return Math.min(hi, Math.max(lo, x));
  }

  /**
   * 规整关键帧：按 t 排序、去除重复时刻（保留后者）。
   * 可选安全半径 r：非有限值（缺省/null/NaN）归一化为 null，表示继承
   * 表演者当前半径；有限值钳为非负数。
   * baseRadius: 调用方提供的继承半径（仅做规范化，不写入缺省帧）。
   * 返回 [{t, x, y, r}, ...]（r 为非负数或 null）
   */
  function normalizeKeys(keys, baseRadius) {
    var list = (keys || [])
      .map(function (k) {
        var kr = k.r;
        var hasR = kr !== null && kr !== undefined && kr !== '' && isFinite(Number(kr));
        return {
          t: Number(k.t),
          x: Number(k.x),
          y: Number(k.y),
          r: hasR ? Math.max(0, Number(kr)) : null
        };
      })
      .filter(function (k) {
        return isFinite(k.t) && isFinite(k.x) && isFinite(k.y);
      })
      .sort(function (a, b) {
        return a.t - b.t;
      });

    var out = [];
    list.forEach(function (k) {
      if (out.length && Math.abs(out[out.length - 1].t - k.t) < EPS) {
        out[out.length - 1] = k;
      } else {
        out.push(k);
      }
    });
    return out;
  }

  /** 取关键帧在时刻 t 的生效安全半径（缺省帧继承 baseRadius，段内线性插值，首尾之外保持端点值）。 */
  function radiusAt(keys, t, baseRadius) {
    var rb = Math.max(0, Number(baseRadius) || 0);
    if (!keys.length) return rb;

    function kr(k) {
      return k.r === null || k.r === undefined ? rb : k.r;
    }

    var first = keys[0];
    var last = keys[keys.length - 1];
    if (t <= first.t) return kr(first);
    if (t >= last.t) return kr(last);
    for (var i = 0; i < keys.length - 1; i++) {
      var a = keys[i];
      var b = keys[i + 1];
      if (t >= a.t && t <= b.t) {
        var f = (t - a.t) / (b.t - a.t);
        return kr(a) + (kr(b) - kr(a)) * f;
      }
    }
    return kr(last);
  }

  /** 时刻 t 在已规整关键帧上的精确位置（段外保持静止）。 */
  function positionAt(keys, t) {
    if (!keys.length) return { x: 0, y: 0 };
    if (t <= keys[0].t) return { x: keys[0].x, y: keys[0].y };
    var last = keys[keys.length - 1];
    if (t >= last.t) return { x: last.x, y: last.y };
    for (var i = 0; i < keys.length - 1; i++) {
      var a = keys[i];
      var b = keys[i + 1];
      if (t >= a.t && t <= b.t) {
        var f = (t - a.t) / (b.t - a.t);
        return {
          x: a.x + (b.x - a.x) * f,
          y: a.y + (b.y - a.y) * f
        };
      }
    }
    return { x: last.x, y: last.y };
  }

  /** 一次取得时刻 t 的位置与生效半径（避免前端重复规整关键帧）。 */
  function stateAt(keys, t, baseRadius) {
    var ks = normalizeKeys(keys, baseRadius);
    var pos = positionAt(ks, t);
    return { x: pos.x, y: pos.y, r: radiusAt(ks, t, baseRadius) };
  }

  /**
   * 把表演者在 [0, duration] 上展开为活动段。
   * 每段位置与半径都是时间的一次函数：
   *     p(t) = (x0 + vx*t, y0 + vy*t)
   *     R(t) = r0 + vr*t
   * t ∈ [t0, t1]。关键帧之外位置静止，半径保持端点值。
   * baseRadius 为表演者当前身体半径，缺省关键帧半径继承它。
   */
  function buildSegments(keys, duration, baseRadius) {
    var rb = Math.max(0, Number(baseRadius) || 0);
    var ks = normalizeKeys(keys, rb);
    var durationNum = Number(duration);
    if (!(durationNum > 0)) {
      throw new Error('duration 必须为正数');
    }
    var T = durationNum;
    var segs = [];

    function effectiveR(k) {
      return k.r === null || k.r === undefined ? rb : k.r;
    }

    function addLinear(t0, t1, p0, p1, r0v, r1v) {
      if (t1 - t0 < EPS) return;
      var dt = t1 - t0;
      var vx = (p1.x - p0.x) / dt;
      var vy = (p1.y - p0.y) / dt;
      var vr = (r1v - r0v) / dt;
      // 以绝对时刻表示 p(t) = x0 + vx*t，故 x0 是 t=0 截距（p0 - v*t0）
      segs.push({
        t0: t0,
        t1: t1,
        x0: p0.x - vx * t0,
        y0: p0.y - vy * t0,
        vx: vx,
        vy: vy,
        r0: r0v - vr * t0,
        vr: vr
      });
    }

    if (ks.length === 0) {
      addLinear(0, T, { x: 0, y: 0 }, { x: 0, y: 0 }, rb, rb);
      return segs;
    }

    var first = ks[0];
    var last = ks[ks.length - 1];

    // 首帧之前：静止在首帧位置，半径保持首帧值
    if (first.t > 0) {
      addLinear(0, Math.min(first.t, T), first, first, effectiveR(first), effectiveR(first));
    }
    // 关键帧之间：位置直线运动，半径同步线性插值
    for (var i = 0; i < ks.length - 1; i++) {
      var a = ks[i];
      var b = ks[i + 1];
      var t0 = Math.max(0, a.t);
      var t1 = Math.min(T, b.t);
      if (t1 > t0) addLinear(t0, t1, a, b, effectiveR(a), effectiveR(b));
    }
    // 末帧之后：静止在末帧位置，半径保持末帧值
    if (last.t < T) {
      addLinear(Math.max(0, last.t), T, last, last, effectiveR(last), effectiveR(last));
    }
    if (!segs.length) {
      // 只有一个关键帧且恰好在边界等退化情况
      addLinear(0, T, first, first, effectiveR(first), effectiveR(first));
    }
    return segs;
  }

  function mergeIntervals(intervals) {
    if (!intervals.length) return [];
    var sorted = intervals
      .filter(function (iv) {
        return iv[1] >= iv[0];
      })
      .sort(function (a, b) {
        return a[0] - b[0];
      });
    var out = [sorted[0].slice()];
    for (var i = 1; i < sorted.length; i++) {
      var cur = sorted[i];
      var top = out[out.length - 1];
      if (cur[0] <= top[1] + MERGE_EPS) {
        top[1] = Math.max(top[1], cur[1]);
      } else {
        out.push(cur.slice());
      }
    }
    return out;
  }

  /**
   * 精确求解一般二次不等式 A t² + B t + C ≤ 0 在 [lo, hi] 内的解集。
   * A 可正可负可为零（半径快速张开时 A = |v|² - d² 可能为负）。
   * 返回零、一或两个区间（A<0 时解集向两端开口，钳制后最多两段）。
   * 相切（重根）记为零长度区间。
   */
  function solveQuadraticLE(A, B, C, lo, hi) {
    if (Math.abs(A) < EPS) {
      // 退化为一次（或常数）不等式 B t + C ≤ 0
      if (Math.abs(B) < EPS) {
        if (C <= EPS) return [[lo, hi]];
        return [];
      }
      var root = -C / B;
      if (B > 0) {
        // t ≤ root
        if (root < lo - EPS) return [];
        return [[lo, Math.min(hi, root)]];
      }
      // B < 0：t ≥ root
      if (root > hi + EPS) return [];
      return [[Math.max(lo, root), hi]];
    }

    var disc = B * B - 4 * A * C;
    if (disc < -EPS) {
      // 无实根：全程同号
      if (A < 0) return [[lo, hi]]; // 开口向下、顶点仍 < 0？由 disc<0 知恒负
      return [];                    // 开口向上，恒正
    }
    if (disc < 0) disc = 0;
    var sq = Math.sqrt(disc);
    var t1 = (-B - sq) / (2 * A);
    var t2 = (-B + sq) / (2 * A);
    if (t1 > t2) { var tmp = t1; t1 = t2; t2 = tmp; }

    if (A > 0) {
      // 开口向上：≤0 部分在两根之间
      var l = Math.max(lo, t1);
      var h = Math.min(hi, t2);
      if (h >= l - EPS) return [[l, h]];
      return [];
    }
    // 开口向下：≤0 部分在两根之外 → 钳制后最多两段
    var out = [];
    if (lo <= t1 + EPS) out.push([lo, Math.min(hi, t1)]);
    if (hi >= t2 - EPS) out.push([Math.max(lo, t2), hi]);
    return out;
  }

  /**
   * 两人在同一时间窗 [lo, hi] 内各自线性运动、半径各自线性变化，
   * 精确求碰撞时间区间。同时更新最小几何间距、半径和极值与
   * 最小安全余量（m(t) = |r(t)| - R(t)）追踪对象。
   */
  function analyzeOverlap(sA, sB, lo, hi, minRef, rangeRef, marginRef) {
    // 相对运动 r(t) = u + v t
    var ux = sA.x0 - sB.x0;
    var uy = sA.y0 - sB.y0;
    var vx = sA.vx - sB.vx;
    var vy = sA.vy - sB.vy;

    // 半径和 R(t) = c + d t（段内插值，恒非负）
    var c = sA.r0 + sB.r0;
    var d = sA.vr + sB.vr;

    // 半径和极值（线性：在端点取极值）
    var rLo = c + d * lo;
    var rHi = c + d * hi;
    if (rLo < rangeRef.min) rangeRef.min = rLo;
    if (rHi < rangeRef.min) rangeRef.min = rHi;
    if (rLo > rangeRef.max) rangeRef.max = rLo;
    if (rHi > rangeRef.max) rangeRef.max = rHi;

    var v2 = vx * vx + vy * vy;
    var u2 = ux * ux + uy * uy;
    var uv = ux * vx + uy * vy;

    // —— 最小几何间距（抛物线 |r(t)|^2 的顶点/端点比较，与半径无关）——
    var tDist;
    if (v2 < EPS) {
      tDist = lo; // 相对静止，距离恒定，任取端点
    } else {
      var tv = -uv / v2;
      tDist = clamp(tv, lo, hi);
    }
    var dxm = ux + vx * tDist;
    var dym = uy + vy * tDist;
    var dm = Math.sqrt(dxm * dxm + dym * dym);
    if (dm < minRef.dist) {
      minRef.dist = dm;
      minRef.t = tDist;
    }

    // —— 最小安全余量 m(t) = |r(t)| - R(t)：凸函数，候选点只有端点与唯一驻点 ——
    // 驻点存在条件 |v| > |d|（否则 m 单调，端点取最小）；
    // cross2 = |u×v|² = 0 时驻点即距离为零的尖点，同一公式覆盖。
    var dd = d * d;
    var mcands = [lo, hi];
    if (v2 - dd > EPS) {
      var cross2 = u2 * v2 - uv * uv;
      if (cross2 < 0) cross2 = 0; // 浮点误差钳制（理论值 ≥ 0）
      var ts = (-uv + d * Math.sqrt(cross2 / (v2 - dd))) / v2;
      if (ts > lo && ts < hi) mcands.push(ts);
    }
    for (var ci = 0; ci < mcands.length; ci++) {
      var tm = mcands[ci];
      var mx = ux + vx * tm;
      var my = uy + vy * tm;
      var mg = Math.sqrt(mx * mx + my * my) - (c + d * tm);
      if (mg < marginRef.margin) {
        marginRef.margin = mg;
        marginRef.t = tm;
      }
    }

    // —— 碰撞区间 |r(t)| ≤ R(t) 的解析解 ——
    // |u + v t|² ≤ (c + d t)² ⇔ A t² + B t + C ≤ 0
    var A = v2 - d * d;
    var B = 2 * (uv - c * d);
    var C = u2 - c * c;

    var hits = solveQuadraticLE(A, B, C, lo, hi);
    // 钳制端点到实际窗（开口向下分支已钳制，这里统一保证精度）
    for (var i = 0; i < hits.length; i++) {
      hits[i][0] = clamp(hits[i][0], lo, hi);
      hits[i][1] = clamp(hits[i][1], lo, hi);
    }
    return hits;
  }

  /**
   * 分析一对表演者。
   * performer: { id?, name?, radius, keys:[{t,x,y,r?}...] }
   * 关键帧 r 缺省时继承表演者 radius。
   * 返回 {
   *   aId,bId,aName,bName, radiusSum, radiusSumMin, radiusSumMax,
   *   intervals:[[t0,t1],...],     // 合并后的精确碰撞区间
   *   minDistance, minDistanceT,   // 最小几何间距（与半径无关）及时刻
   *   minMargin, minMarginT,       // 最小安全余量 distance-(rA+rB) 及发生时刻
   *   firstContact,                // 首次碰撞时刻（无则 null）
   *   lastRelease
   * }
   */
  function analyzePair(pa, pb, duration) {
    var rA = Math.max(0, Number(pa.radius) || 0);
    var rB = Math.max(0, Number(pb.radius) || 0);
    var rSumBase = rA + rB;

    var segsA = buildSegments(pa.keys, duration, rA);
    var segsB = buildSegments(pb.keys, duration, rB);

    var raw = [];
    var minRef = { dist: Infinity, t: 0 };
    var rangeRef = { min: Infinity, max: -Infinity };
    var marginRef = { margin: Infinity, t: 0 };

    var i = 0;
    var j = 0;
    while (i < segsA.length && j < segsB.length) {
      var a = segsA[i];
      var b = segsB[j];
      var lo = Math.max(a.t0, b.t0);
      var hi = Math.min(a.t1, b.t1);
      if (hi - lo > EPS) {
        var found = analyzeOverlap(a, b, lo, hi, minRef, rangeRef, marginRef);
        for (var k = 0; k < found.length; k++) raw.push(found[k]);
      }
      if (a.t1 < b.t1 - EPS) i++;
      else if (b.t1 < a.t1 - EPS) j++;
      else { i++; j++; }
    }

    var intervals = mergeIntervals(raw);
    if (!isFinite(minRef.dist)) {
      minRef = { dist: 0, t: 0 };
    }
    if (!isFinite(rangeRef.min)) {
      rangeRef = { min: rSumBase, max: rSumBase };
    }
    if (!isFinite(marginRef.margin)) {
      // 不可达（buildSegments 恒覆盖 [0, duration]），兜底保持字段有限
      marginRef = { margin: -rSumBase, t: 0 };
    }

    return {
      aId: pa.id,
      bId: pb.id,
      aName: pa.name || pa.id,
      bName: pb.name || pb.id,
      radiusSum: rSumBase,
      radiusSumMin: rangeRef.min,
      radiusSumMax: rangeRef.max,
      intervals: intervals,
      minDistance: minRef.dist,
      minDistanceT: minRef.t,
      minMargin: marginRef.margin,
      minMarginT: marginRef.t,
      firstContact: intervals.length ? intervals[0][0] : null,
      lastRelease: intervals.length ? intervals[intervals.length - 1][1] : null,
      collision: intervals.length > 0
    };
  }

  /* ================= 舞台禁入矩形（轴对齐障碍）连续侵入分析 ================= */

  /**
   * 规整障碍矩形：x/y 必须有限（非法条目丢弃），宽高钳为非负，
   * 缺省 id/name 自动生成。返回 [{id, name, x, y, width, height}, ...]
   */
  function normalizeObstacles(obstacles) {
    return (obstacles || [])
      .map(function (o, i) {
        o = o || {};
        return {
          id: o.id !== undefined && o.id !== null && o.id !== '' ? String(o.id) : 'ob' + (i + 1),
          name: o.name !== undefined && o.name !== null && o.name !== '' ? String(o.name) : '障碍' + (i + 1),
          x: Number(o.x),
          y: Number(o.y),
          width: Number(o.width),
          height: Number(o.height)
        };
      })
      .filter(function (o) {
        return isFinite(o.x) && isFinite(o.y);
      })
      .map(function (o) {
        if (!isFinite(o.width) || o.width < 0) o.width = 0;
        if (!isFinite(o.height) || o.height < 0) o.height = 0;
        return o;
      });
  }

  /** 线性不等式 a + b·t ≥ 0 在 [lo, hi] 上的解区间（空集返回 null）。 */
  function solveLinearGE(a, b, lo, hi) {
    if (Math.abs(b) < EPS) {
      return a >= -EPS ? [lo, hi] : null;
    }
    var root = -a / b;
    if (b > 0) {
      // t ≥ root
      if (root > hi + EPS) return null;
      return [Math.max(lo, root), hi];
    }
    // t ≤ root
    if (root < lo - EPS) return null;
    return [lo, Math.min(hi, root)];
  }

  /** 两个单区间求交（容差内相接视为相交，退化为零长度区间）。 */
  function intersectInterval1(a, b) {
    if (!a || !b) return null;
    var l = Math.max(a[0], b[0]);
    var h = Math.min(a[1], b[1]);
    if (h >= l - EPS) return [l, Math.max(l, h)];
    return null;
  }

  /**
   * 单个线性段（位置 p(t) = (x0+vx·t, y0+vy·t)、半径 R(t) = r0+vr·t 均为
   * t 的一次函数）与轴对齐矩形膨胀边界的连续进入/离开区间。
   *
   * 侵入 ⟺ 圆心进入"矩形 ⊕ 半径 R(t) 圆盘"（圆角矩形），分解为：
   *   上下边条带：px ∈ [ox, ox+w] 且 py ∈ [oy−R, oy+h+R]  —— 线性不等式组
   *   左右边条带：py ∈ [oy, oy+h] 且 px ∈ [ox−R, ox+w+R]  —— 线性不等式组
   *   四个角点圆盘：|p(t) − corner| ≤ R(t)                —— 一般二次不等式
   * （半径随时间线性变化时，条带条件关于 t 仍是线性的；角点条件与双人碰撞
   * 同型，复用 solveQuadraticLE。）三者并集即本段全部侵入区间；
   * 矩形内起步（条带整段成立）与仅角点相切（零长度区间）都被自然覆盖。
   */
  function segmentRectIntrusion(seg, rect, lo, hi) {
    var ox = rect.x;
    var oy = rect.y;
    var ow = rect.width;
    var oh = rect.height;
    var x0 = seg.x0;
    var y0 = seg.y0;
    var vx = seg.vx;
    var vy = seg.vy;
    var r0 = seg.r0;
    var vr = seg.vr;
    var out = [];

    // 条带：conds 为 [a, b] 列表，全部满足 a + b·t ≥ 0 的 t 区间
    function strip(conds) {
      var cur = [lo, hi];
      for (var i = 0; i < conds.length; i++) {
        cur = intersectInterval1(cur, solveLinearGE(conds[i][0], conds[i][1], lo, hi));
        if (!cur) return;
      }
      out.push(cur);
    }

    // 上下边条带（含矩形本体竖列）：px 在矩形 x 范围内，py 距矩形 ≤ R
    strip([
      [x0 - ox, vx],                 // px ≥ ox
      [ox + ow - x0, -vx],           // px ≤ ox + w
      [y0 + r0 - oy, vy + vr],       // py + R ≥ oy
      [oy + oh + r0 - y0, vr - vy]   // py − R ≤ oy + h
    ]);
    // 左右边条带：py 在矩形 y 范围内，px 距矩形 ≤ R
    strip([
      [y0 - oy, vy],                 // py ≥ oy
      [oy + oh - y0, -vy],           // py ≤ oy + h
      [x0 + r0 - ox, vx + vr],       // px + R ≥ ox
      [ox + ow + r0 - x0, vr - vx]   // px − R ≤ ox + w
    ]);

    // 四角点圆盘：|u + v·t| ≤ R(t) —— 与双人碰撞同型的一般二次不等式
    var corners = [
      [ox, oy], [ox + ow, oy], [ox, oy + oh], [ox + ow, oy + oh]
    ];
    for (var ci = 0; ci < 4; ci++) {
      var ux = x0 - corners[ci][0];
      var uy = y0 - corners[ci][1];
      var A = vx * vx + vy * vy - vr * vr;
      var B = 2 * (ux * vx + uy * vy - r0 * vr);
      var C = ux * ux + uy * uy - r0 * r0;
      var hits = solveQuadraticLE(A, B, C, lo, hi);
      for (var k = 0; k < hits.length; k++) out.push(hits[k]);
    }
    return out;
  }

  /**
   * 表演者（按实时安全半径视为圆）与单个障碍矩形的连续侵入分析。
   * 返回 {
   *   performerId, performerName, obstacleId, obstacleName,
   *   intervals: [[t0,t1],...],   // 合并后的精确进入/离开区间（跨关键帧已合并）
   *   firstEntry, lastExit,       // 首次进入 / 最后离开时刻（无侵入为 null）
   *   intrusion                   // 是否存在侵入
   * }
   */
  function analyzeObstacleIntrusion(performer, obstacle, duration) {
    var ob = normalizeObstacles([obstacle])[0];
    var rb = Math.max(0, Number(performer.radius) || 0);
    var empty = {
      performerId: performer.id,
      performerName: performer.name || performer.id,
      obstacleId: ob ? ob.id : undefined,
      obstacleName: ob ? ob.name : undefined,
      intervals: [],
      firstEntry: null,
      lastExit: null,
      intrusion: false
    };
    if (!ob) return empty; // 非法障碍（坐标非有限数）已被规整丢弃
    var segs = buildSegments(performer.keys, duration, rb);
    var raw = [];
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      var hits = segmentRectIntrusion(s, ob, s.t0, s.t1);
      for (var k = 0; k < hits.length; k++) raw.push(hits[k]);
    }
    var intervals = mergeIntervals(raw);
    return {
      performerId: performer.id,
      performerName: performer.name || performer.id,
      obstacleId: ob.id,
      obstacleName: ob.name,
      intervals: intervals,
      firstEntry: intervals.length ? intervals[0][0] : null,
      lastExit: intervals.length ? intervals[intervals.length - 1][1] : null,
      intrusion: intervals.length > 0
    };
  }

  /**
   * 全场景禁入分析：枚举所有 表演者 × 障碍 组合，仅保留存在侵入的组合，
   * 按首次进入时刻升序（并列时按障碍、表演者 id 字典序，保证确定性）。
   */
  function analyzeObstacles(performers, obstacles, duration) {
    var out = [];
    (obstacles || []).forEach(function (ob) {
      (performers || []).forEach(function (p) {
        var r = analyzeObstacleIntrusion(p, ob, duration);
        if (r.intrusion) out.push(r);
      });
    });
    out.sort(function (a, b) {
      var d = a.firstEntry - b.firstEntry;
      if (d) return d;
      var ao = String(a.obstacleId);
      var bo = String(b.obstacleId);
      if (ao !== bo) return ao < bo ? -1 : 1;
      var ap = String(a.performerId);
      var bp = String(b.performerId);
      if (ap !== bp) return ap < bp ? -1 : 1;
      return 0;
    });
    return out;
  }

  /**
   * 分析整个场景：枚举全部 C(n,2) 双人组合。
   * scene: { duration, performers:[performer...], obstacles?:[obstacle...] }
   * pairs 按最小安全余量升序（余量越小越危险，碰撞对自然排在安全对之前）。
   * obstacleConflicts 按首次进入时刻升序（仅含存在侵入的 表演者×障碍 组合）。
   */
  function analyzeScene(scene) {
    var duration = Number(scene.duration);
    if (!(duration > 0)) throw new Error('duration 必须为正数');
    var ps = scene.performers || [];
    var pairs = [];
    for (var i = 0; i < ps.length; i++) {
      for (var j = i + 1; j < ps.length; j++) {
        pairs.push(analyzePair(ps[i], ps[j], duration));
      }
    }

    var collisions = pairs.filter(function (p) {
      return p.collision;
    });
    var firstPair = null;
    collisions.forEach(function (p) {
      if (!firstPair || p.firstContact < firstPair.firstContact) firstPair = p;
    });
    var closestPair = null;
    pairs.forEach(function (p) {
      if (!closestPair || p.minDistance < closestPair.minDistance) closestPair = p;
    });
    var marginPair = null;
    pairs.forEach(function (p) {
      if (!marginPair || p.minMargin < marginPair.minMargin) marginPair = p;
    });

    // 统一按最小安全余量升序返回（前端逐对列表与 /api/analyze 同一顺序）
    pairs.sort(function (a, b) {
      return a.minMargin - b.minMargin;
    });

    // 舞台禁入矩形：规整 obstacles 并求全部侵入冲突（按首次进入升序）；
    // 旧场景无 obstacles 字段时得到空数组，保持兼容
    var obstacles = normalizeObstacles(scene.obstacles);
    var obstacleConflicts = analyzeObstacles(ps, obstacles, duration);

    return {
      duration: duration,
      pairCount: pairs.length,
      pairs: pairs,
      obstacles: obstacles,
      obstacleConflicts: obstacleConflicts,
      firstContact: firstPair ? firstPair.firstContact : null,
      firstContactPair: firstPair
        ? [firstPair.aId, firstPair.bId]
        : null,
      minDistance: closestPair ? closestPair.minDistance : null,
      minDistanceT: closestPair ? closestPair.minDistanceT : null,
      minDistancePair: closestPair
        ? [closestPair.aId, closestPair.bId]
        : null,
      minMargin: marginPair ? marginPair.minMargin : null,
      minMarginT: marginPair ? marginPair.minMarginT : null,
      minMarginPair: marginPair
        ? [marginPair.aId, marginPair.bId]
        : null
    };
  }

  /** 查询某表演者在时刻 t 是否处于某碰撞区间内（供画布高亮）。 */
  function isPerformerInCollision(pair, performerId, t) {
    if (!pair || !pair.collision) return false;
    if (pair.aId !== performerId && pair.bId !== performerId) return false;
    for (var i = 0; i < pair.intervals.length; i++) {
      var iv = pair.intervals[i];
      if (t + EPS >= iv[0] && t - EPS <= iv[1]) return true;
    }
    return false;
  }

  /**
   * 内置交叉样例（4 人，时长 12s，世界 1000×600）：
   *  - 甲（水平横穿）与乙（竖直纵穿）路径十字交叉，在 t=6 同时到达交点 -> 相撞
   *  - 丙为错峰折线，几何路径与甲/乙相交但到达时刻错开 -> 不撞；
   *    t=8 关键帧安全半径 20→60，表现到位后展开道具（占用范围线性张开），
   *    张开段与各路径仍保持安全间距
   *  - 丁起初与丙分离，约 t=2.6 起追上丙并保持贴近 -> 持续碰撞（相对静止退化段）
   *  - 舞台右下置一禁入矩形"布景平台"：丙（约 t=5.50 经角点圆盘进入）、
   *    丁（约 t=5.64 经边条带进入）、甲（约 t=8.45 正面横穿）先后侵入
   */
  function builtinScene() {
    return {
      duration: 12,
      world: { width: 1000, height: 600 },
      obstacles: [
        { id: 'ob1', name: '布景平台', x: 700, y: 240, width: 120, height: 80 }
      ],
      performers: [
        {
          id: 'p1',
          name: '甲·横贯',
          color: '#ef4444',
          radius: 20,
          keys: [
            { t: 0, x: 60, y: 300 },
            { t: 12, x: 940, y: 300 }
          ]
        },
        {
          id: 'p2',
          name: '乙·纵穿',
          color: '#38bdf8',
          radius: 20,
          keys: [
            { t: 0, x: 500, y: 40 },
            { t: 12, x: 500, y: 560 }
          ]
        },
        {
          id: 'p3',
          name: '丙·错峰展伞',
          color: '#22c55e',
          radius: 20,
          keys: [
            { t: 0, x: 60, y: 540 },
            { t: 4, x: 500, y: 60 },
            { t: 8, x: 940, y: 540, r: 60 }
          ]
        },
        {
          id: 'p4',
          name: '丁·跟进',
          color: '#facc15',
          radius: 20,
          keys: [
            { t: 0, x: 160, y: 540 },
            { t: 4, x: 500, y: 90 },
            { t: 8, x: 940, y: 570 }
          ]
        }
      ]
    };
  }

  return {
    EPS: EPS,
    normalizeKeys: normalizeKeys,
    positionAt: positionAt,
    radiusAt: radiusAt,
    stateAt: stateAt,
    buildSegments: buildSegments,
    solveQuadraticLE: solveQuadraticLE,
    analyzePair: analyzePair,
    normalizeObstacles: normalizeObstacles,
    analyzeObstacleIntrusion: analyzeObstacleIntrusion,
    analyzeObstacles: analyzeObstacles,
    analyzeScene: analyzeScene,
    isPerformerInCollision: isPerformerInCollision,
    builtinScene: builtinScene
  };
});
