'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../public/core.js');

const T = 12;

function approx(actual, expected, tol = 1e-6, label) {
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `${label || '值'} 期望 ${expected}，实际 ${actual}`
  );
}

test('正面相撞：两人相向匀速，在 t=6 接触', () => {
  const a = { id: 'a', radius: 0, keys: [{ t: 0, x: 0, y: 0 }, { t: 12, x: 120, y: 0 }] };
  const b = { id: 'b', radius: 0, keys: [{ t: 0, x: 120, y: 0 }, { t: 12, x: 0, y: 0 }] };
  const r = core.analyzePair(a, b, T);
  assert.equal(r.collision, true);
  assert.equal(r.intervals.length, 1);
  approx(r.intervals[0][0], 6, 1e-7, '进入碰撞');
  approx(r.intervals[0][1], 6, 1e-7, '离开碰撞');
  approx(r.firstContact, 6, 1e-7);
  approx(r.minDistance, 0, 1e-7);
  approx(r.minDistanceT, 6, 1e-7);
});

test('半径产生有限宽度的碰撞区间（非点接触）', () => {
  const a = { id: 'a', radius: 10, keys: [{ t: 0, x: 0, y: 0 }, { t: 10, x: 100, y: 0 }] };
  const b = { id: 'b', radius: 10, keys: [{ t: 0, x: 100, y: 0 }, { t: 10, x: 0, y: 0 }] };
  const r = core.analyzePair(a, b, T);
  assert.equal(r.collision, true);
  // 相对速度 20/s，半径和 20 -> |100-20t|<=20 -> t∈[4,6]
  approx(r.intervals[0][0], 4, 1e-7);
  approx(r.intervals[0][1], 6, 1e-7);
});

test('相切：最近距离恰好等于半径和，区间退化为单点也算碰撞', () => {
  // A 水平经过 y=10，B 静止原点；rSum=10 -> 恰在 t=5 相切
  const a = { id: 'a', radius: 0, keys: [{ t: 0, x: 0, y: 10 }, { t: 10, x: 100, y: 10 }] };
  const b = { id: 'b', radius: 10, keys: [{ t: 0, x: 50, y: 0 }] };
  const r = core.analyzePair(a, b, T);
  assert.equal(r.collision, true);
  approx(r.intervals[0][0], 5, 1e-6);
  approx(r.intervals[0][1], 5, 1e-6);
  approx(r.minDistance, 10, 1e-6);
});

test('错峰交叉：路径相交但不同时到达，不得误报', () => {
  // A 水平匀速，t=5 经过交点 (50,0)；B 竖直疾行，t≈1 经过交点后远离
  const a = { id: 'a', radius: 2, keys: [{ t: 0, x: 0, y: 0 }, { t: 10, x: 100, y: 0 }] };
  const b = { id: 'b', radius: 2, keys: [{ t: 0, x: 50, y: -100 }, { t: 2, x: 50, y: 100 }] };
  const r = core.analyzePair(a, b, T);
  assert.equal(r.collision, false);
  assert.deepEqual(r.intervals, []);
  assert.equal(r.firstContact, null);
  // 几何路径交点距离为 0 但时刻错开，全程最近距离仍远大于半径和 4
  assert.ok(r.minDistance > 30, `最近距离应 >30，实际 ${r.minDistance}`);
});

test('相对静止持续重叠：v=0 退化解覆盖整段', () => {
  const a = { id: 'a', radius: 30, keys: [{ t: 0, x: 0, y: 0 }, { t: 12, x: 120, y: 0 }] };
  // B 同速平行，间距恒为 40 <= 半径和 50
  const b = { id: 'b', radius: 20, keys: [{ t: 0, x: 0, y: 40 }, { t: 12, x: 120, y: 40 }] };
  const r = core.analyzePair(a, b, T);
  assert.equal(r.collision, true);
  assert.equal(r.intervals.length, 1);
  approx(r.intervals[0][0], 0, 1e-7);
  approx(r.intervals[0][1], 12, 1e-7);
  approx(r.minDistance, 40, 1e-7);
});

test('跨关键帧的碰撞区间在边界处正确合并', () => {
  // A 匀速直线（单段），B 用两个共线关键帧人为切成两段，结果应一致
  const a = { id: 'a', radius: 10, keys: [{ t: 0, x: 0, y: 0 }, { t: 10, x: 100, y: 0 }] };
  const b1 = { id: 'b', radius: 10, keys: [{ t: 0, x: 100, y: 0 }, { t: 5, x: 50, y: 0 }, { t: 10, x: 0, y: 0 }] };
  const b2 = { id: 'b', radius: 10, keys: [{ t: 0, x: 100, y: 0 }, { t: 10, x: 0, y: 0 }] };
  const r1 = core.analyzePair(a, b1, T);
  const r2 = core.analyzePair(a, b2, T);
  assert.equal(r1.intervals.length, r2.intervals.length);
  approx(r1.intervals[0][0], r2.intervals[0][0]);
  approx(r1.intervals[0][1], r2.intervals[0][1]);
});

test('关键帧之外保持静止（开场即贴近静止者）', () => {
  const a = { id: 'a', radius: 15, keys: [{ t: 3, x: 0, y: 0 }, { t: 9, x: 100, y: 0 }] };
  const b = { id: 'b', radius: 15, keys: [{ t: 0, x: 5, y: 0 }] };
  const r = core.analyzePair(a, b, T);
  // 0..3 期间 A 静止在 (0,0)，与 B 相距 5 <= 30，必然碰撞
  assert.equal(r.collision, true);
  approx(r.intervals[0][0], 0, 1e-7);
});

test('analyzeScene：4 人产生 6 对，首次碰撞与全局最小间距正确', () => {
  const scene = core.builtinScene();
  const r = core.analyzeScene(scene);
  assert.equal(r.pairCount, 6);
  const colliding = r.pairs.filter((p) => p.collision);
  const names = colliding.map((p) => `${p.aId}-${p.bId}`).sort();
  assert.deepEqual(names, ['p1-p2', 'p3-p4']);

  const p12 = r.pairs.find((p) => p.aId === 'p1' && p.bId === 'p2');
  approx(p12.firstContact, 5.53, 0.02, '甲乙首碰时刻');
  approx(p12.minDistance, 0, 1e-6, '甲乙最小间距');
  approx(p12.minDistanceT, 6, 1e-6, '甲乙最小间距时刻');
  approx(p12.intervals[0][0], 5.53, 0.02);
  approx(p12.intervals[0][1], 6.47, 0.02);

  const p34 = r.pairs.find((p) => p.aId === 'p3' && p.bId === 'p4');
  assert.equal(p34.collision, true);
  approx(p34.firstContact, 2.60, 0.02, '丙丁首碰时刻');
  approx(p34.lastRelease, 12, 1e-6, '丙丁持续到收场');
  assert.ok(p34.minDistance < 40, '丙丁最近间距应小于半径和 40');

  // 几何相交但错峰的组合不得误报
  for (const id of ['p1-p3', 'p2-p3', 'p1-p4', 'p2-p4']) {
    const [x, y] = id.split('-');
    const p = r.pairs.find((q) => q.aId === x && q.bId === y);
    assert.equal(p.collision, false, `${id} 不应碰撞`);
  }

  approx(r.firstContact, p34.firstContact, 1e-6);
  approx(r.minDistance, 0, 1e-6);
});

test('positionAt 线性插值与端点静止', () => {
  const keys = core.normalizeKeys([{ t: 2, x: 0, y: 0 }, { t: 6, x: 40, y: 20 }]);
  assert.deepEqual(core.positionAt(keys, 0), { x: 0, y: 0 });
  const mid = core.positionAt(keys, 4);
  approx(mid.x, 20, 1e-9);
  approx(mid.y, 10, 1e-9);
  assert.deepEqual(core.positionAt(keys, 9), { x: 40, y: 20 });
});

test('radiusAt：缺省继承表演者半径，相邻关键帧线性插值，首尾之外保持端点值', () => {
  const keys = core.normalizeKeys([
    { t: 0, x: 0, y: 0 },          // 缺省 -> 继承 20
    { t: 4, x: 0, y: 0, r: 60 },
    { t: 8, x: 0, y: 0, r: 40 }
  ], 20);
  approx(core.radiusAt(keys, -1, 20), 20, 1e-9, '首帧之前保持首帧（继承）值');
  approx(core.radiusAt(keys, 0, 20), 20, 1e-9);
  approx(core.radiusAt(keys, 2, 20), 40, 1e-9, '段内线性插值');
  approx(core.radiusAt(keys, 4, 20), 60, 1e-9);
  approx(core.radiusAt(keys, 6, 20), 50, 1e-9);
  approx(core.radiusAt(keys, 8, 20), 40, 1e-9);
  approx(core.radiusAt(keys, 12, 20), 40, 1e-9, '末帧之后保持末帧值');

  const st = core.stateAt([{ t: 0, x: 10, y: 0 }, { t: 10, x: 90, y: 0, r: 40 }], 5, 20);
  approx(st.x, 50, 1e-9);
  approx(st.r, 30, 1e-9, 'stateAt 同步插值位置与半径');
});

test('可变半径：张开道具提前进入碰撞（半径和线性增大，解析二次式）', () => {
  // B 沿 x 轴匀速从 0 走到 100（r=10）；A 静止在 x=70，
  // t∈[0,4] 安全半径 10→50，之后保持 50
  const a = {
    id: 'a', radius: 10,
    keys: [{ t: 0, x: 70, y: 0, r: 10 }, { t: 4, x: 70, y: 0, r: 50 }]
  };
  const b = { id: 'b', radius: 10, keys: [{ t: 0, x: 0, y: 0 }, { t: 10, x: 100, y: 0 }] };
  const r = core.analyzePair(a, b, 10);
  assert.equal(r.collision, true);
  // 张开段：间距 70-10t，半径和 20+10t → 相等时 70-10t=20+10t → t=2.5
  approx(r.firstContact, 2.5, 1e-7, '张开导致首碰 t=2.5');
  // t≥4 后半径和恒 60、间距持续缩小；穿过中心后在 70-10t=-60 → t=13 才脱离（窗外）
  approx(r.lastRelease, 10, 1e-7, '窗内始终重叠到收场');
  // 几何最小间距仍为 0（半径无关）
  approx(r.minDistance, 0, 1e-7);
  // 半径和极值：20（起始）～60
  approx(r.radiusSumMin, 20, 1e-9);
  approx(r.radiusSumMax, 60, 1e-9);
});

test('可变半径：单帧张开再收拢，碰撞区间在同段精确起止（两点根）', () => {
  // B 从 100 走到 0（r=10）；A 静止原点，半径在 t∈[2,6] 由 10 线性升到 90
  const a = {
    id: 'a', radius: 10,
    keys: [{ t: 2, x: 0, y: 0, r: 10 }, { t: 6, x: 0, y: 0, r: 90 }]
  };
  const b = { id: 'b', radius: 10, keys: [{ t: 0, x: 100, y: 0 }, { t: 10, x: 0, y: 0 }] };
  const r = core.analyzePair(a, b, 10);
  assert.equal(r.collision, true);
  // 张开段 t∈[2,6]：间距 100-10t，rA=20t-30，半径和 20t-20
  //   相等：100-10t=20t-20 → t=4 接触
  approx(r.intervals[0][0], 4, 1e-7, '张开段接触 t=4');
  // t≥6 后半径和恒 100，间距继续缩小；脱离需 100-10t=-100 → t=20（窗外）
  approx(r.intervals[r.intervals.length - 1][1], 10, 1e-7);
});

test('可变半径：相对静止下仅靠张开道具产生精确进入时刻', () => {
  // 两人完全静止，相距 30；A 半径 10 在 t∈[2,6] 线性升到 50，B 恒 10
  const a = {
    id: 'a', radius: 10,
    keys: [{ t: 0, x: 0, y: 0, r: 10 }, { t: 2, x: 0, y: 0, r: 10 }, { t: 6, x: 0, y: 0, r: 50 }]
  };
  const b = { id: 'b', radius: 10, keys: [{ t: 0, x: 30, y: 0 }] };
  const r = core.analyzePair(a, b, 8);
  assert.equal(r.collision, true);
  // 半径和 = 20 + 10(t-2) = 10t（t∈[2,6]），等于 30 时 t=3
  approx(r.firstContact, 3, 1e-7);
  approx(r.intervals[0][0], 3, 1e-7);
  // t≥6 半径和 60 > 30，持续碰撞到窗末
  approx(r.lastRelease, 8, 1e-7);
  // 最小几何间距不受半径影响：恒为 30
  approx(r.minDistance, 30, 1e-7);
});

test('半径快速张开（二次式首项系数为负）：先碰后随合拢脱离', () => {
  // 一人匀速离开但半径张开更快：|v|² - d² < 0 分支
  // B 从 x=0 以 10/s 向 +x（r=0）；A 静止 x=0，r: 0→80 在 t∈[0,4]
  const a = {
    id: 'a', radius: 0,
    keys: [{ t: 0, x: 0, y: 0, r: 0 }, { t: 4, x: 0, y: 0, r: 80 }]
  };
  const b = { id: 'b', radius: 0, keys: [{ t: 0, x: 0, y: 0 }, { t: 8, x: 80, y: 0 }] };
  const r = core.analyzePair(a, b, 8);
  // t∈[0,4]：间距 10t，半径和 20t → 10t ≤ 20t 恒成立（t=0 重合）
  // t∈[4,8]：间距 10t，半径和恒 80 → 10t ≤ 80 → t ≤ 8（t=8 相切脱离）
  assert.equal(r.collision, true);
  approx(r.firstContact, 0, 1e-7);
  approx(r.lastRelease, 8, 1e-7, 't=8 恰好相切');
});

test('未设置关键帧半径时与固定半径结果完全一致（向后兼容）', () => {
  const a1 = { id: 'a', radius: 10, keys: [{ t: 0, x: 0, y: 0 }, { t: 10, x: 100, y: 0 }] };
  const a2 = {
    id: 'a', radius: 10,
    keys: [{ t: 0, x: 0, y: 0, r: 10 }, { t: 10, x: 100, y: 0, r: 10 }]
  };
  const b = { id: 'b', radius: 10, keys: [{ t: 0, x: 100, y: 0 }, { t: 10, x: 0, y: 0 }] };
  const r1 = core.analyzePair(a1, b, T);
  const r2 = core.analyzePair(a2, b, T);
  assert.equal(r1.intervals.length, r2.intervals.length);
  approx(r1.intervals[0][0], r2.intervals[0][0]);
  approx(r1.intervals[0][1], r2.intervals[0][1]);
  approx(r1.minDistance, r2.minDistance);
  approx(r2.radiusSumMin, 20, 1e-9);
  approx(r2.radiusSumMax, 20, 1e-9);
});

test('收拢道具在半径线性减小段精确脱离碰撞', () => {
  // 两人完全静止，相距 30；A 半径在 t∈[2,6] 由 50 线性收到 10，B 恒 10
  const a = {
    id: 'a', radius: 10,
    keys: [{ t: 0, x: 0, y: 0, r: 50 }, { t: 2, x: 0, y: 0, r: 50 }, { t: 6, x: 0, y: 0, r: 10 }]
  };
  const b = { id: 'b', radius: 10, keys: [{ t: 0, x: 30, y: 0 }] };
  const r = core.analyzePair(a, b, 8);
  assert.equal(r.collision, true);
  // t<2 半径和 60 ≥ 30 全程碰撞；收拢段半径和 = 60-10(t-2) = 80-10t
  // 等于 30 时 t=5 脱离，之后半径和 20 < 30 安全
  assert.equal(r.intervals.length, 1);
  approx(r.intervals[0][0], 0, 1e-7);
  approx(r.intervals[0][1], 5, 1e-7);
});

test('跨关键帧半径分段：张开段进入与关键帧处相切合并', () => {
  // A 静止原点；t∈[0,4] r 10→50，t∈[4,8] r 50→10；B 以 10/s 从 100 走向 0（r=10）
  const a = {
    id: 'a', radius: 10,
    keys: [
      { t: 0, x: 0, y: 0, r: 10 },
      { t: 4, x: 0, y: 0, r: 50 },
      { t: 8, x: 0, y: 0, r: 10 }
    ]
  };
  const b = { id: 'b', radius: 10, keys: [{ t: 0, x: 100, y: 0 }, { t: 10, x: 0, y: 0 }] };
  const r = core.analyzePair(a, b, 10);
  assert.equal(r.collision, true);
  // 张开段：间距 100-10t，半径和 20+10t，相等时 t=4（恰在关键帧处相切进入）
  // 合拢段半径和 100-10t，与间距恒等，整段重叠；t≥8 后半径和 20、间距继续缩小，
  // 在 t∈[8,10] 内间距 ≤20 → 直到 t=10。两段在 t=4 相接，合并为单一区间
  assert.equal(r.intervals.length, 1, '段边界相接区间应合并为一段');
  approx(r.intervals[0][0], 4, 1e-6);
  approx(r.intervals[0][1], 10, 1e-6);
});

test('内置样例含关键帧半径且不改变原有碰撞结论', () => {
  const s = core.builtinScene();
  const p3 = s.performers.find((p) => p.id === 'p3');
  assert.equal(p3.keys[2].r, 60, '丙 t=8 帧携带展开半径 60');
  const r = core.analyzeScene(s);
  const p13 = r.pairs.find((p) => p.aId === 'p1' && p.bId === 'p3');
  const p23 = r.pairs.find((p) => p.aId === 'p2' && p.bId === 'p3');
  assert.equal(p13.collision, false, '展开后与甲仍安全');
  assert.equal(p23.collision, false, '展开后与乙仍安全');
  const p34 = r.pairs.find((p) => p.aId === 'p3' && p.bId === 'p4');
  assert.equal(p34.collision, true);
  approx(p34.firstContact, 2.60, 0.02);
});

// ---------- 最小安全余量 minMargin = min_t (distance(t) - (rA+rB)) ----------

test('最小安全余量：相对静止且半径恒定，余量恒为 dist − 半径和', () => {
  // 两人同速平行，间距恒 40，半径和恒 50 → 余量恒 −10（相对静止退化）
  const a = { id: 'a', radius: 30, keys: [{ t: 0, x: 0, y: 0 }, { t: 12, x: 120, y: 0 }] };
  const b = { id: 'b', radius: 20, keys: [{ t: 0, x: 0, y: 40 }, { t: 12, x: 120, y: 40 }] };
  const r = core.analyzePair(a, b, T);
  approx(r.minMargin, -10, 1e-7, '余量 = 40 − 50');
  assert.ok(r.minMarginT >= 0 && r.minMarginT <= 12, '发生时刻在窗内');
  assert.equal(r.collision, true, '余量 ≤ 0 ⟺ 碰撞');
});

test('最小安全余量：距离为零的正面相撞，余量 = −半径和 @ 相遇时刻', () => {
  const a = { id: 'a', radius: 10, keys: [{ t: 0, x: 0, y: 0 }, { t: 12, x: 120, y: 0 }] };
  const b = { id: 'b', radius: 10, keys: [{ t: 0, x: 120, y: 0 }, { t: 12, x: 0, y: 0 }] };
  const r = core.analyzePair(a, b, T);
  approx(r.minMargin, -20, 1e-7, 't=6 距离为 0，余量 = −20');
  approx(r.minMarginT, 6, 1e-7);
});

test('最小安全余量：安全对余量为正，等于最近间距 − 半径和（半径恒定）', () => {
  // A 沿 y=30 水平经过，B 静止原点；rSum=20 → 余量 = 30 − 20 = 10 @ t=5
  const a = { id: 'a', radius: 10, keys: [{ t: 0, x: 0, y: 30 }, { t: 10, x: 100, y: 30 }] };
  const b = { id: 'b', radius: 10, keys: [{ t: 0, x: 50, y: 0 }] };
  const r = core.analyzePair(a, b, T);
  assert.equal(r.collision, false);
  approx(r.minMargin, 10, 1e-6);
  approx(r.minMarginT, 5, 1e-6);
});

test('最小安全余量：可变半径下驻点落在段内（凸函数唯一驻点，非采样）', () => {
  // A 静止原点，r: 0→8 于 t∈[0,4]（半径和变化率 d=+2）；
  // B 以 10/s 从 (-30,40) 走到 (10,40)，r=0
  const a = { id: 'a', radius: 0, keys: [{ t: 0, x: 0, y: 0, r: 0 }, { t: 4, x: 0, y: 0, r: 8 }] };
  const b = { id: 'b', radius: 0, keys: [{ t: 0, x: -30, y: 40 }, { t: 4, x: 10, y: 40 }] };
  const r = core.analyzePair(a, b, 4);
  // u=(-30,40), v=(10,0)：v2=100, uv=-300, cross2=2500*100-300²=160000
  // t* = (300 + 2·√(160000/96))/100 ≈ 3.8165 ∈ (0,4)
  const ts = (300 + 2 * Math.sqrt(160000 / 96)) / 100;
  const expect = Math.hypot(-30 + 10 * ts, 40) - 2 * ts;
  approx(r.minMarginT, ts, 1e-7, '驻点时刻');
  approx(r.minMargin, expect, 1e-7, '驻点处余量');
  approx(r.minMargin, 33.19, 0.01);
  assert.equal(r.collision, false, '余量 > 0 ⟺ 安全');
});

test('最小安全余量：相对静止 + 半径张开，余量线性递减在端点取最小', () => {
  // 两人完全静止相距 30；A 半径 t∈[2,6] 由 10 升到 50，B 恒 10
  const a = {
    id: 'a', radius: 10,
    keys: [{ t: 0, x: 0, y: 0, r: 10 }, { t: 2, x: 0, y: 0, r: 10 }, { t: 6, x: 0, y: 0, r: 50 }]
  };
  const b = { id: 'b', radius: 10, keys: [{ t: 0, x: 30, y: 0 }] };
  const r = core.analyzePair(a, b, 8);
  // t≥6 半径和恒 60 → 余量恒 30−60 = −30（平台段）
  approx(r.minMargin, -30, 1e-7);
  assert.ok(r.minMarginT >= 6 - 1e-9 && r.minMarginT <= 8, '最小余量出现在张开后的平台段');
});

test('最小安全余量：距离为零且相对静止（两人全程重合）', () => {
  const a = { id: 'a', radius: 10, keys: [{ t: 0, x: 5, y: 5 }] };
  const b = { id: 'b', radius: 15, keys: [{ t: 0, x: 5, y: 5 }] };
  const r = core.analyzePair(a, b, 8);
  approx(r.minDistance, 0, 1e-9);
  approx(r.minMargin, -25, 1e-9, '余量恒为 −(10+15)');
  assert.equal(r.collision, true);
});

test('最小安全余量：与细采样对照且与碰撞判定一致（实现本身不采样）', () => {
  const scenes = [
    core.builtinScene(),
    {
      duration: 10,
      performers: [
        { id: 'a', radius: 10, keys: [{ t: 0, x: 70, y: 0, r: 10 }, { t: 4, x: 70, y: 0, r: 50 }] },
        { id: 'b', radius: 10, keys: [{ t: 0, x: 0, y: 0 }, { t: 10, x: 100, y: 0 }] }
      ]
    },
    {
      duration: 8,
      performers: [
        { id: 'a', radius: 0, keys: [{ t: 0, x: 0, y: 0, r: 0 }, { t: 4, x: 0, y: 0, r: 80 }] },
        { id: 'b', radius: 0, keys: [{ t: 0, x: 0, y: 0 }, { t: 8, x: 80, y: 0 }] }
      ]
    },
    {
      duration: 12,
      performers: [
        { id: 'a', radius: 5, keys: [{ t: 1, x: 0, y: 0 }, { t: 5, x: 200, y: 100 }, { t: 11, x: 40, y: 300 }] },
        { id: 'b', radius: 25, keys: [{ t: 0, x: 300, y: 200, r: 40 }, { t: 12, x: 100, y: 100, r: 5 }] }
      ]
    }
  ];
  scenes.forEach((scene, si) => {
    const r = core.analyzeScene(scene);
    r.pairs.forEach((pair) => {
      const pa = scene.performers.find((p) => p.id === pair.aId);
      const pb = scene.performers.find((p) => p.id === pair.bId);
      let best = Infinity;
      for (let i = 0; i <= 20000; i++) {
        const t = (scene.duration * i) / 20000;
        const sa = core.stateAt(pa.keys, t, pa.radius);
        const sb = core.stateAt(pb.keys, t, pb.radius);
        const m = Math.hypot(sa.x - sb.x, sa.y - sb.y) - sa.r - sb.r;
        if (m < best) best = m;
      }
      assert.ok(
        pair.minMargin <= best + 1e-9,
        `场景${si} 对 ${pair.aId}-${pair.bId}：解析余量 ${pair.minMargin} 不应大于采样最小值 ${best}`
      );
      approx(pair.minMargin, best, 2e-2, `场景${si} 对 ${pair.aId}-${pair.bId} 解析余量≈采样最小值`);
      assert.equal(
        pair.collision, pair.minMargin <= 1e-9,
        `场景${si} 对 ${pair.aId}-${pair.bId}：余量 ≤ 0 ⟺ 碰撞`
      );
    });
  });
});

test('analyzeScene：pairs 按最小安全余量升序，场景级 minMargin 与首对一致', () => {
  const r = core.analyzeScene(core.builtinScene());
  for (let i = 1; i < r.pairs.length; i++) {
    assert.ok(
      r.pairs[i].minMargin >= r.pairs[i - 1].minMargin - 1e-12,
      `第 ${i} 对余量 ${r.pairs[i].minMargin} 应 ≥ 前一对 ${r.pairs[i - 1].minMargin}`
    );
  }
  approx(r.minMargin, r.pairs[0].minMargin, 1e-12, '场景级最小余量 = 首对余量');
  approx(r.minMarginT, r.pairs[0].minMarginT, 1e-12);
  assert.deepEqual(r.minMarginPair, [r.pairs[0].aId, r.pairs[0].bId]);
  // 碰撞对余量 ≤ 0 < 安全对余量，故碰撞对全部排在安全对之前
  const firstSafe = r.pairs.findIndex((p) => !p.collision);
  assert.ok(r.pairs.slice(0, firstSafe === -1 ? r.pairs.length : firstSafe).every((p) => p.collision));
});

// ---------- 舞台禁入矩形：圆（实时安全半径）vs 轴对齐矩形膨胀边界 ----------

const RECT = { id: 'ob1', name: '布景', x: 100, y: 100, width: 100, height: 100 };

test('禁入矩形：水平穿越膨胀边界，进入/离开时刻精确（边条带）', () => {
  // y=150 横穿矩形 y 范围；r=10 -> px ∈ [90, 210] 时侵入，速度 30/s -> t ∈ [3, 7]
  const p = { id: 'a', radius: 10, keys: [{ t: 0, x: 0, y: 150 }, { t: 10, x: 300, y: 150 }] };
  const r = core.analyzeObstacleIntrusion(p, RECT, 10);
  assert.equal(r.intrusion, true);
  assert.equal(r.intervals.length, 1);
  approx(r.intervals[0][0], 3, 1e-7, '进入时刻');
  approx(r.intervals[0][1], 7, 1e-7, '离开时刻');
  approx(r.firstEntry, 3, 1e-7);
  approx(r.lastExit, 7, 1e-7);
});

test('禁入矩形：从矩形内部起步，首次进入为 t=0', () => {
  const p = { id: 'a', radius: 0, keys: [{ t: 0, x: 150, y: 150 }] };
  const r = core.analyzeObstacleIntrusion(p, RECT, 10);
  assert.equal(r.intrusion, true);
  assert.equal(r.intervals.length, 1);
  approx(r.firstEntry, 0, 1e-9, '矩形内起步 -> t=0 即侵入');
  approx(r.intervals[0][1], 10, 1e-9, '静止不动 -> 整段侵入');
});

test('禁入矩形：仅角点相切，退化为零长度区间也算侵入', () => {
  // 圆心沿 3x+4y=-50 方向 (4,-3) 运动，t=5 时距角点 (0,0) 恰为半径 10；
  // 路径不进入任何边条带 -> 唯一接触是角点圆盘的零长度区间
  const rect = { id: 'ob1', x: 0, y: 0, width: 100, height: 100 };
  const p = { id: 'a', radius: 10, keys: [{ t: 0, x: -26, y: 7 }, { t: 10, x: 14, y: -23 }] };
  const r = core.analyzeObstacleIntrusion(p, rect, 10);
  assert.equal(r.intrusion, true, '角点相切应记为侵入');
  assert.equal(r.intervals.length, 1);
  approx(r.intervals[0][0], 5, 1e-6, '相切时刻');
  approx(r.intervals[0][1], 5, 1e-6, '零长度区间');
  approx(r.firstEntry, 5, 1e-6);
  approx(r.lastExit, 5, 1e-6);
});

test('禁入矩形：半径随时间张开，仅靠半径增大在精确时刻进入', () => {
  // 圆心静止原点，距矩形左边 50；r: 0→60 于 t∈[0,6]（之后保持 60）
  // R(t)=10t ≥ 50 -> t=5 进入，之后一直保持
  const rect = { id: 'ob1', x: 50, y: -10, width: 50, height: 20 };
  const p = { id: 'a', radius: 0, keys: [{ t: 0, x: 0, y: 0, r: 0 }, { t: 6, x: 0, y: 0, r: 60 }] };
  const r = core.analyzeObstacleIntrusion(p, rect, 10);
  assert.equal(r.intervals.length, 1);
  approx(r.firstEntry, 5, 1e-7, '张开到 50 时进入');
  approx(r.lastExit, 10, 1e-7, '之后半径保持 60，持续到收场');
});

test('禁入矩形：半径随时间收拢，在精确时刻离开', () => {
  // 同上但 r: 60→0：R(t)=60-10t ≥ 50 -> t ≤ 1，起步即在膨胀边界内
  const rect = { id: 'ob1', x: 50, y: -10, width: 50, height: 20 };
  const p = { id: 'a', radius: 0, keys: [{ t: 0, x: 0, y: 0, r: 60 }, { t: 6, x: 0, y: 0, r: 0 }] };
  const r = core.analyzeObstacleIntrusion(p, rect, 10);
  assert.equal(r.intervals.length, 1);
  approx(r.intervals[0][0], 0, 1e-7, '起步即侵入');
  approx(r.intervals[0][1], 1, 1e-7, '收拢到 50 时离开');
});

test('禁入矩形：跨关键帧的相邻侵入区间合并为一段', () => {
  // 与"水平穿越"相同轨迹，但在矩形正中央 t=5 处人为加关键帧
  const p = {
    id: 'a', radius: 10,
    keys: [{ t: 0, x: 0, y: 150 }, { t: 5, x: 150, y: 150 }, { t: 10, x: 300, y: 150 }]
  };
  const r = core.analyzeObstacleIntrusion(p, RECT, 10);
  assert.equal(r.intervals.length, 1, '跨关键帧应合并为单一区间');
  approx(r.intervals[0][0], 3, 1e-6);
  approx(r.intervals[0][1], 7, 1e-6);
});

test('禁入矩形：对角接近时经角点圆盘先于边条带进入', () => {
  // 圆心沿 y=x 对角线逼近角点 (0,0)，R=20√2：
  // 角点圆盘 |p(t)| ≤ R -> t ∈ [8,12]；边条带需 px≥0 -> t≥10，并集 [8,20]
  const rect = { id: 'ob1', x: 0, y: 0, width: 100, height: 100 };
  const p = {
    id: 'a', radius: 20 * Math.sqrt(2),
    keys: [{ t: 0, x: -100, y: -100 }, { t: 20, x: 100, y: 100 }]
  };
  const r = core.analyzeObstacleIntrusion(p, rect, 20);
  assert.equal(r.intervals.length, 1, '角点区间与边条带区间应合并');
  approx(r.firstEntry, 8, 1e-6, '角点圆盘提前进入');
  approx(r.lastExit, 20, 1e-6);
});

test('禁入矩形：零半径点穿过矩形内部（边条带退化）', () => {
  const rect = { id: 'ob1', x: 20, y: 20, width: 40, height: 40 };
  const p = { id: 'a', radius: 0, keys: [{ t: 0, x: 0, y: 0 }, { t: 10, x: 100, y: 100 }] };
  const r = core.analyzeObstacleIntrusion(p, rect, 10);
  assert.equal(r.intervals.length, 1);
  approx(r.intervals[0][0], 2, 1e-7);
  approx(r.intervals[0][1], 6, 1e-7);
});

test('禁入矩形：不相交的组合无侵入（intervals 为空）', () => {
  const p = { id: 'a', radius: 10, keys: [{ t: 0, x: 0, y: 0 }, { t: 10, x: 50, y: 0 }] };
  const r = core.analyzeObstacleIntrusion(p, RECT, 10);
  assert.equal(r.intrusion, false);
  assert.deepEqual(r.intervals, []);
  assert.equal(r.firstEntry, null);
  assert.equal(r.lastExit, null);
});

test('analyzeObstacles：仅保留侵入组合并按首次进入时刻升序', () => {
  const performers = [
    { id: 'a', name: '甲', radius: 10, keys: [{ t: 0, x: 0, y: 150 }, { t: 10, x: 300, y: 150 }] },
    { id: 'b', name: '乙', radius: 10, keys: [{ t: 0, x: 0, y: 450 }, { t: 10, x: 300, y: 450 }] }
  ];
  const obstacles = [
    { id: 'ob1', x: 100, y: 100, width: 100, height: 100 },  // 甲 t∈[3,7]
    { id: 'ob2', x: 60, y: 400, width: 60, height: 100 }     // 乙 t∈[5/3,13/3]
  ];
  const out = core.analyzeObstacles(performers, obstacles, 10);
  assert.equal(out.length, 2, '不相交组合不出现');
  assert.equal(out[0].performerId, 'b', '乙 5/3≈1.67 先进入');
  assert.equal(out[0].obstacleId, 'ob2');
  approx(out[0].firstEntry, 5 / 3, 1e-6);
  assert.equal(out[1].performerId, 'a');
  approx(out[1].firstEntry, 3, 1e-6);
  assert.ok(out[0].firstEntry <= out[1].firstEntry, '按首次进入升序');
});

test('normalizeObstacles：缺省 id/name 生成、负宽高钳零、非法坐标条目丢弃', () => {
  const list = core.normalizeObstacles([
    { x: 10, y: 20, width: 30, height: 40 },
    { id: 'keep', name: '台子', x: 0, y: 0, width: -5, height: 10 },
    { x: 'bad', y: 0, width: 10, height: 10 }
  ]);
  assert.equal(list.length, 2);
  assert.equal(list[0].id, 'ob1');
  assert.equal(list[0].name, '障碍1');
  assert.deepEqual([list[0].x, list[0].y, list[0].width, list[0].height], [10, 20, 30, 40]);
  assert.equal(list[1].id, 'keep');
  assert.equal(list[1].name, '台子');
  assert.equal(list[1].width, 0, '负宽钳为 0');
  assert.equal(list[1].height, 10);
});

test('analyzeScene：无 obstacles 的旧场景返回空禁入结果（向后兼容）', () => {
  const r = core.analyzeScene({
    duration: 10,
    performers: [
      { id: 'a', radius: 10, keys: [{ t: 0, x: 0, y: 0 }, { t: 10, x: 100, y: 0 }] },
      { id: 'b', radius: 10, keys: [{ t: 0, x: 100, y: 0 }, { t: 10, x: 0, y: 0 }] }
    ]
  });
  assert.deepEqual(r.obstacles, []);
  assert.deepEqual(r.obstacleConflicts, []);
  assert.equal(r.pairCount, 1, '原有双人分析不受影响');
});

test('内置样例：丙/丁/甲 先后侵入布景平台，按首次进入升序', () => {
  const r = core.analyzeScene(core.builtinScene());
  assert.equal(r.obstacles.length, 1);
  const cs = r.obstacleConflicts;
  assert.equal(cs.length, 3);
  assert.equal(cs[0].performerId, 'p3', '丙 t≈5.50 经角点圆盘首先进入');
  approx(cs[0].firstEntry, 5.5, 1e-6);
  approx(cs[0].lastExit, 6.5455, 1e-3);
  assert.equal(cs[1].performerId, 'p4', '丁 t≈5.64 经边条带进入');
  approx(cs[1].firstEntry, 5.6364, 1e-3);
  assert.equal(cs[2].performerId, 'p1', '甲 t≈8.45 正面横穿');
  approx(cs[2].firstEntry, 8.4545, 1e-3);
  approx(cs[2].lastExit, 10.6364, 1e-3);
});

test('禁入分析：与细采样对照（实现本身不采样）', () => {
  const scenes = [
    core.builtinScene(),
    {
      duration: 10,
      performers: [
        { id: 'a', radius: 0, keys: [{ t: 0, x: 0, y: 0, r: 0 }, { t: 6, x: 0, y: 0, r: 60 }] },
        { id: 'b', radius: 10, keys: [{ t: 0, x: -26, y: 157 }, { t: 10, x: 314, y: 127 }] }
      ],
      obstacles: [{ id: 'ob1', x: 50, y: -10, width: 50, height: 20 }]
    },
    {
      duration: 20,
      performers: [
        { id: 'a', radius: 20 * Math.sqrt(2), keys: [{ t: 0, x: -100, y: -100 }, { t: 20, x: 100, y: 100 }] },
        { id: 'b', radius: 5, keys: [{ t: 2, x: 300, y: 500 }, { t: 18, x: -50, y: 100, r: 40 }] }
      ],
      obstacles: [
        { id: 'ob1', x: 0, y: 0, width: 100, height: 100 },
        { id: 'ob2', x: 150, y: 350, width: 80, height: 60 }
      ]
    }
  ];
  scenes.forEach((scene, si) => {
    const r = core.analyzeScene(scene);
    scene.performers.forEach((p) => {
      core.normalizeObstacles(scene.obstacles).forEach((ob) => {
        const c = r.obstacleConflicts.find(
          (x) => x.performerId === p.id && x.obstacleId === ob.id
        );
        const intervals = c ? c.intervals : [];
        // 细采样：圆心到矩形距离 ≤ 实时半径 即侵入
        const N = 20000;
        const step = scene.duration / N;
        let sampled = 0;
        for (let i = 0; i <= N; i++) {
          const t = i * step;
          const st = core.stateAt(p.keys, t, p.radius);
          const dx = Math.max(ob.x - st.x, 0, st.x - (ob.x + ob.width));
          const dy = Math.max(ob.y - st.y, 0, st.y - (ob.y + ob.height));
          if (Math.hypot(dx, dy) <= st.r + 1e-9) sampled += step;
        }
        const analytic = intervals.reduce((s, iv) => s + (iv[1] - iv[0]), 0);
        assert.ok(
          Math.abs(analytic - sampled) <= 4 * step + 1e-9,
          `场景${si} ${p.id}×${ob.id}：解析侵入总时长 ${analytic} 应≈采样值 ${sampled}`
        );
      });
    });
  });
});
