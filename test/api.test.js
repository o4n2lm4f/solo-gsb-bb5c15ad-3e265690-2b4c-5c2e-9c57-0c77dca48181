'use strict';

/**
 * HTTP 接口测试：/api/analyze 接受含关键帧半径 r 的场景并返回规整后的场景；
 * /api/sample 返回的样例携带关键帧半径。使用 server 导出的 express app，零额外依赖。
 */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const app = require('../server/index.js');

const server = app.listen(0);
after(() => server.close());
const PORT = server.address().port;

function postAnalyze(body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1',
      port: PORT,
      path: '/api/analyze',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(buf || '{}') }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function getJson(path) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port: PORT, path }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(buf || '{}') }));
    }).on('error', reject);
  });
}

const baseScene = (aKeys) => ({
  duration: 10,
  performers: [
    {
      id: 'a', name: '甲', radius: 10,
      keys: aKeys || [{ t: 0, x: 70, y: 0, r: 10 }, { t: 4, x: 70, y: 0, r: 50 }]
    },
    {
      id: 'b', name: '乙', radius: 10,
      keys: [{ t: 0, x: 0, y: 0 }, { t: 10, x: 100, y: 0 }]
    }
  ]
});

test('POST /api/analyze：接受关键帧 r 并按可变半径解析（首碰 t=2.5）', async () => {
  const r = await postAnalyze(baseScene());
  assert.equal(r.status, 200);
  assert.equal(r.json.pairCount, 1);
  const pair = r.json.pairs[0];
  assert.equal(pair.collision, true);
  assert.ok(Math.abs(pair.firstContact - 2.5) < 1e-6);
  assert.ok(Math.abs(pair.radiusSumMin - 20) < 1e-9);
  assert.ok(Math.abs(pair.radiusSumMax - 60) < 1e-9);
});

test('POST /api/analyze：返回最小安全余量 minMargin/minMarginT，pairs 按余量升序', async () => {
  const r = await postAnalyze(baseScene());
  assert.equal(r.status, 200);
  const pair = r.json.pairs[0];
  // 甲静止 x=70（r 10→50），乙 r=10 从 0→100：
  // t=7 时距离为 0、半径和恒 60 → 最小安全余量 = −60 @ t=7
  assert.ok(Math.abs(pair.minMargin - (-60)) < 1e-6, `minMargin 应为 -60，实际 ${pair.minMargin}`);
  assert.ok(Math.abs(pair.minMarginT - 7) < 1e-6, `minMarginT 应为 7，实际 ${pair.minMarginT}`);
  // 场景级字段与首对一致
  assert.ok(Math.abs(r.json.minMargin - pair.minMargin) < 1e-12);
  assert.ok(Math.abs(r.json.minMarginT - pair.minMarginT) < 1e-12);
  assert.deepEqual(r.json.minMarginPair, [pair.aId, pair.bId]);
  // 升序
  for (let i = 1; i < r.json.pairs.length; i++) {
    assert.ok(r.json.pairs[i].minMargin >= r.json.pairs[i - 1].minMargin);
  }
});

test('POST /api/analyze：多对场景 pairs 严格按最小安全余量升序', async () => {
  const s = await getJson('/api/sample');
  const r = await postAnalyze({ duration: s.json.duration, performers: s.json.performers });
  assert.equal(r.status, 200);
  assert.equal(r.json.pairCount, 6);
  r.json.pairs.forEach((p) => {
    assert.ok(typeof p.minMargin === 'number' && isFinite(p.minMargin), '每对都带有限 minMargin');
    assert.ok(typeof p.minMarginT === 'number' && isFinite(p.minMarginT), '每对都带有限 minMarginT');
    assert.equal(p.collision, p.minMargin <= 1e-9, '余量 ≤ 0 ⟺ 碰撞');
  });
  for (let i = 1; i < r.json.pairs.length; i++) {
    assert.ok(
      r.json.pairs[i].minMargin >= r.json.pairs[i - 1].minMargin - 1e-12,
      'pairs 按余量升序'
    );
  }
  assert.ok(Math.abs(r.json.minMargin - r.json.pairs[0].minMargin) < 1e-12);
});

test('POST /api/analyze：返回的 scene 中缺省 r 被解析为继承值，显式 r 原样保留', async () => {
  const r = await postAnalyze(baseScene());
  assert.equal(r.status, 200);
  assert.ok(r.json.scene, '响应包含规整后的 scene');
  const [a, b] = r.json.scene.performers;
  assert.equal(a.keys[0].r, 10);
  assert.equal(a.keys[1].r, 50);
  // 乙的关键帧未设置 r -> 全部解析为其当前半径 10
  assert.deepEqual(b.keys.map((k) => k.r), [10, 10]);
});

test('POST /api/analyze：固定半径旧数据（无 r 字段）继续兼容', async () => {
  const old = {
    duration: 10,
    performers: [
      { name: 'a', radius: 10, keys: [{ t: 0, x: 0, y: 0 }, { t: 10, x: 100, y: 0 }] },
      { name: 'b', radius: 10, keys: [{ t: 0, x: 100, y: 0 }, { t: 10, x: 0, y: 0 }] }
    ]
  };
  const r = await postAnalyze(old);
  assert.equal(r.status, 200);
  const pair = r.json.pairs[0];
  assert.ok(Math.abs(pair.intervals[0][0] - 4) < 1e-7);
  assert.ok(Math.abs(pair.intervals[0][1] - 6) < 1e-7);
});

test('POST /api/analyze：非法关键帧半径被拒绝', async () => {
  const bad = baseScene([{ t: 0, x: 70, y: 0, r: -5 }]);
  const r = await postAnalyze(bad);
  assert.equal(r.status, 400);
  assert.match(r.json.error, /安全半径/);
});

test('GET /api/sample：样例含关键帧半径且可直接回传分析', async () => {
  const s = await getJson('/api/sample');
  assert.equal(s.status, 200);
  const p3 = s.json.performers.find((p) => p.id === 'p3');
  assert.equal(p3.keys[2].r, 60);
  const r = await postAnalyze({ duration: s.json.duration, performers: s.json.performers });
  assert.equal(r.status, 200);
  assert.equal(r.json.pairCount, 6);
});

test('GET /healthz 正常', async () => {
  const r = await getJson('/healthz');
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
});

// ---------- 舞台禁入矩形 obstacles / obstacleConflicts ----------

const obstacleScene = () => ({
  duration: 10,
  performers: [
    { id: 'a', name: '甲', radius: 10, keys: [{ t: 0, x: 0, y: 150 }, { t: 10, x: 300, y: 150 }] },
    { id: 'b', name: '乙', radius: 10, keys: [{ t: 0, x: 0, y: 450 }, { t: 10, x: 300, y: 450 }] }
  ],
  obstacles: [
    { id: 'ob1', name: '布景A', x: 100, y: 100, width: 100, height: 100 }, // 甲 t∈[3,7]
    { x: 60, y: 400, width: 60, height: 100 }                              // 乙 t∈[5/3,13/3]，缺省 id/name
  ]
});

test('POST /api/analyze：返回规整 obstacles 与按首次进入排序的 obstacleConflicts', async () => {
  const r = await postAnalyze(obstacleScene());
  assert.equal(r.status, 200);

  // 规整后的 obstacles：缺省 id/name 自动生成，数值化
  assert.equal(r.json.obstacles.length, 2);
  assert.deepEqual(r.json.obstacles[0], { id: 'ob1', name: '布景A', x: 100, y: 100, width: 100, height: 100 });
  assert.equal(r.json.obstacles[1].id, 'ob2');
  assert.equal(r.json.obstacles[1].name, '障碍2');
  // scene 中同步规整，可直接回传
  assert.deepEqual(r.json.scene.obstacles, r.json.obstacles);

  // obstacleConflicts：仅侵入组合，按首次进入时刻升序
  assert.equal(r.json.obstacleConflicts.length, 2);
  const [c1, c2] = r.json.obstacleConflicts;
  assert.equal(c1.performerId, 'b');
  assert.equal(c1.obstacleId, 'ob2');
  assert.equal(c1.performerName, '乙');
  assert.ok(Math.abs(c1.firstEntry - 5 / 3) < 1e-6, `乙首次进入应≈1.6667，实际 ${c1.firstEntry}`);
  assert.equal(c2.performerId, 'a');
  assert.equal(c2.obstacleId, 'ob1');
  assert.ok(Math.abs(c2.firstEntry - 3) < 1e-6);
  assert.equal(c2.intervals.length, 1);
  assert.ok(Math.abs(c2.intervals[0][0] - 3) < 1e-6);
  assert.ok(Math.abs(c2.intervals[0][1] - 7) < 1e-6);
  assert.ok(Math.abs(c2.lastExit - 7) < 1e-6);
  assert.ok(c1.firstEntry <= c2.firstEntry, '按首次进入升序');
});

test('POST /api/analyze：旧请求无 obstacles 时 obstacleConflicts 为空（兼容）', async () => {
  const r = await postAnalyze(baseScene());
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.obstacles, []);
  assert.deepEqual(r.json.obstacleConflicts, []);
  assert.deepEqual(r.json.scene.obstacles, []);
  // 原有字段不受影响
  assert.equal(r.json.pairCount, 1);
  assert.ok(Math.abs(r.json.pairs[0].firstContact - 2.5) < 1e-6);
});

test('POST /api/analyze：非法禁入矩形被拒绝', async () => {
  const negWidth = Object.assign(obstacleScene(), {
    obstacles: [{ x: 0, y: 0, width: -5, height: 10 }]
  });
  let r = await postAnalyze(negWidth);
  assert.equal(r.status, 400);
  assert.match(r.json.error, /非负/);

  const badX = Object.assign(obstacleScene(), {
    obstacles: [{ x: 'oops', y: 0, width: 5, height: 10 }]
  });
  r = await postAnalyze(badX);
  assert.equal(r.status, 400);
  assert.match(r.json.error, /非数字/);

  const notArray = Object.assign(obstacleScene(), { obstacles: 'junk' });
  r = await postAnalyze(notArray);
  assert.equal(r.status, 400);
  assert.match(r.json.error, /obstacles/);
});

test('POST /api/analyze：禁入分析覆盖矩形内起步与可变半径（连续解析）', async () => {
  const body = {
    duration: 10,
    performers: [
      { id: 'a', name: '甲', radius: 0, keys: [{ t: 0, x: 150, y: 150 }] },              // 矩形内起步
      { id: 'b', name: '乙', radius: 0, keys: [{ t: 0, x: 0, y: 0, r: 0 }, { t: 6, x: 0, y: 0, r: 60 }] } // 半径张开
    ],
    obstacles: [{ id: 'ob1', x: 100, y: 100, width: 100, height: 100 }, { id: 'ob2', x: 50, y: -10, width: 50, height: 20 }]
  };
  const r = await postAnalyze(body);
  assert.equal(r.status, 200);
  const inside = r.json.obstacleConflicts.find((c) => c.performerId === 'a');
  assert.ok(Math.abs(inside.firstEntry - 0) < 1e-9, '矩形内起步首次进入为 0');
  const grow = r.json.obstacleConflicts.find((c) => c.performerId === 'b' && c.obstacleId === 'ob2');
  assert.ok(Math.abs(grow.firstEntry - 5) < 1e-6, '半径张开到 50 时进入');
  // 甲 静止于 ob1 内 -> 整段 [0,10]
  assert.ok(Math.abs(inside.intervals[0][1] - 10) < 1e-9);
});
