'use strict';

/**
 * 前端冒烟测试：jsdom + Canvas 2D 桩加载 core.js / app.js，
 * 模拟拖动画布走位点、增删表演者、改半径、时间轴跳转，
 * 断言重算结果与 DOM 同步。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const core = require('../public/core.js');

const PUBLIC = path.join(__dirname, '..', 'public');

function makeCtx() {
  const noop = () => {};
  const gradient = { addColorStop: noop };
  const target = {};
  return new Proxy(target, {
    get(t, prop) {
      switch (prop) {
        case 'createLinearGradient': return () => gradient;
        case 'measureText': return () => ({ width: 10 });
        default:
          if (prop in t) return t[prop];
          return typeof prop === 'string' ? noop : undefined;
      }
    },
    set(t, prop, val) { t[prop] = val; return true; }
  });
}

async function boot() {
  const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  const dom = new JSDOM(html, {
    url: 'http://localhost:3000/',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const { window } = dom;

  window.HTMLCanvasElement.prototype.getContext = () => makeCtx();
  window.HTMLCanvasElement.prototype.getBoundingClientRect = () => ({
    left: 0, top: 0, width: 1000, height: 600, right: 1000, bottom: 600, x: 0, y: 0
  });
  window.HTMLCanvasElement.prototype.setPointerCapture = () => {};
  window.HTMLElement.prototype.setPointerCapture = () => {};

  window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
  window.cancelAnimationFrame = (id) => clearTimeout(id);
  window.fetch = () => Promise.resolve({ json: () => Promise.resolve(core.builtinScene()) });

  const origGet = window.Element.prototype.getBoundingClientRect;
  window.Element.prototype.getBoundingClientRect = function () {
    if (this.id === 'timeline-lanes') {
      return { left: 14, top: 40, width: 972, height: 88, right: 986, bottom: 128, x: 14, y: 40 };
    }
    if (this.id === 'timeline') {
      return { left: 0, top: 0, width: 1000, height: 140, right: 1000, bottom: 140, x: 0, y: 0 };
    }
    if (this.tagName === 'CANVAS') {
      return { left: 0, top: 0, width: 1000, height: 600, right: 1000, bottom: 600, x: 0, y: 0 };
    }
    return origGet.call(this);
  };
  Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() { return this.id === 'timeline-lanes' ? 972 : 100; }
  });

  window.eval(fs.readFileSync(path.join(PUBLIC, 'core.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(PUBLIC, 'app.js'), 'utf8'));
  await new Promise((r) => setTimeout(r, 40));
  return dom;
}

test('启动：载入 4 人样例，摘要与 6 对结果正确渲染', async () => {
  const dom = await boot();
  const doc = dom.window.document;

  assert.equal(doc.querySelectorAll('.performer-item').length, 4);
  assert.equal(doc.querySelectorAll('.pair-row').length, 6);
  assert.match(doc.getElementById('sum-first').textContent, /2\.60\s*s/);
  assert.match(doc.getElementById('sum-min').textContent, /0\.00/);
  assert.match(doc.getElementById('sum-first-who').textContent, /丙[\s\S]*丁/);
  assert.ok(doc.querySelectorAll('.tl-danger').length >= 2, '时间轴应渲染危险区间条');
  assert.equal(doc.querySelectorAll('.tl-key').length, 10, '4 人共 10 个关键帧时刻柄');

  // 碰撞对排在前、安全对在后
  assert.ok(doc.querySelectorAll('.pair-row.danger').length >= 2);
  dom.window.close();
});

test('拖动画布走位点后立即重算：把乙两帧移到 x=300，错峰消除甲乙碰撞', async () => {
  const dom = await boot();
  const { window } = dom;
  const doc = window.document;
  const canvas = doc.getElementById('stage');

  function pointer(type, x, y) {
    const ev = new window.MouseEvent(type, {
      bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0
    });
    canvas.dispatchEvent(ev);
  }
  // p2 初始选中者是 p1；先点中 p2 首帧 (500,40) 并拖到 (300,40)
  pointer('pointerdown', 500, 40);
  pointer('pointermove', 300, 40);
  pointer('pointerup', 300, 40);
  // 末帧 (500,560) -> (300,560)
  pointer('pointerdown', 500, 560);
  pointer('pointermove', 300, 560);
  pointer('pointerup', 300, 560);
  await new Promise((r) => setTimeout(r, 10));

  // 乙沿 x=300 纵走：路径仍几何交叉，但到达 (300,300) 时 t≈3.98，
  // 甲此时只走到 x≈329，错峰约 101.75 单位 —— 解析判定安全
  const rows = [...doc.querySelectorAll('.pair-row')].map((r) => r.textContent);
  const jiaYi = rows.find((t) => t.includes('甲') && t.includes('乙'));
  assert.match(jiaYi, /安全/);
  assert.match(jiaYi, /101\.75/);
  dom.window.close();
});

test('增加表演者与修改半径：8 人上限、C(n,2) 对实时更新', async () => {
  const dom = await boot();
  const { window } = dom;
  const doc = window.document;

  doc.getElementById('btn-add').click();
  assert.equal(doc.querySelectorAll('.performer-item').length, 5);
  assert.equal(doc.querySelectorAll('.pair-row').length, 10);

  for (let i = 0; i < 3; i++) doc.getElementById('btn-add').click();
  assert.equal(doc.querySelectorAll('.performer-item').length, 8);
  assert.equal(doc.getElementById('btn-add').disabled, true);
  assert.equal(doc.querySelectorAll('.pair-row').length, 28);

  // 改半径（当前选中的是新加的第 8 人）
  const rInput = doc.querySelector('.performer-item.selected .performer-radius');
  rInput.value = '100';
  rInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(doc.querySelectorAll('.pair-row').length, 28);
  // 半径 100 与最近路径几乎必然碰撞：危险对数量增加
  assert.ok(doc.querySelectorAll('.pair-row.danger').length >= 3);
  dom.window.close();
});

test('时间轴点击跳转 & 人数下限 2', async () => {
  const dom = await boot();
  const { window } = dom;
  const doc = window.document;

  const tl = doc.getElementById('timeline');
  const rect = doc.getElementById('timeline-lanes').getBoundingClientRect();
  tl.dispatchEvent(new window.MouseEvent('click', {
    bubbles: true, clientX: rect.left + 972 * 0.5, clientY: rect.top + 5
  }));
  const tv = Number(doc.getElementById('time-input').value);
  assert.ok(Math.abs(tv - 6) < 0.15, `播放时刻应≈6，实际 ${tv}`);

  const dels = doc.querySelectorAll('.performer-del');
  dels[3].click();
  dels[2].click();
  assert.equal(doc.querySelectorAll('.performer-item').length, 2);
  assert.equal(doc.querySelectorAll('.pair-row').length, 1);

  doc.querySelector('.performer-del').click();
  assert.equal(doc.querySelectorAll('.performer-item').length, 2, '必须保留至少 2 人');
  dom.window.close();
});

test('修改总时长后关键帧截断并重算', async () => {
  const dom = await boot();
  const { window } = dom;
  const doc = window.document;

  const dInput = doc.getElementById('duration-input');
  dInput.value = '5';
  dInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 10));

  assert.equal(doc.getElementById('duration-readout').textContent, '5.0');
  // 原样例 t>5 的帧被截断：p1 剩 1 帧(0)，p2 剩 1 帧(0)，p3 剩 2 帧(0,4)，p4 剩 2 帧(0,4)
  assert.equal(doc.querySelectorAll('.tl-key').length, 6);
  // 仍有结果输出
  assert.equal(doc.querySelectorAll('.pair-row').length, 6);
  dom.window.close();
});

test('选中关键帧可编辑安全半径：设置、实时碰撞、清除后继承', async () => {
  const dom = await boot();
  const { window } = dom;
  const doc = window.document;
  const canvas = doc.getElementById('stage');

  function pointer(type, x, y) {
    canvas.dispatchEvent(new window.MouseEvent(type, {
      bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0
    }));
  }

  const editor = doc.getElementById('key-editor');
  const rInput = doc.getElementById('ke-radius');
  const clearBtn = doc.getElementById('ke-clear');

  // 未选中关键帧：编辑器隐藏
  assert.equal(editor.hidden, true);

  // 选中甲首帧 (60,300)
  pointer('pointerdown', 60, 300);
  pointer('pointerup', 60, 300);
  assert.equal(editor.hidden, false, '选中关键帧后出现半径编辑条');
  assert.match(doc.getElementById('ke-info').textContent, /甲/);
  assert.equal(rInput.placeholder, '20', '占位符为继承半径 20');
  assert.equal(clearBtn.disabled, true, '继承状态下清除按钮禁用');

  // 初始甲×丙安全（错峰）；把甲首帧半径设为 150，张开后在 t≈2 前即覆盖丙
  rInput.value = '150';
  rInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(clearBtn.disabled, false);

  let rows = [...doc.querySelectorAll('.pair-row')].map((r) => r.textContent);
  let jiaBing = rows.find((t) => t.includes('甲') && t.includes('丙'));
  assert.match(jiaBing, /碰撞/, '甲首帧张开 150 后应与丙产生碰撞区间');
  assert.match(jiaBing, /半径和 80～170/, '半径和范围应反映关键帧半径');

  // 对应时间轴时刻柄出现自定义半径标记（样例中丙 t=8 帧自带 1 个）
  assert.ok(doc.querySelectorAll('.tl-key.custom').length >= 2, '时间轴标记自定义半径帧');

  // 清除半径恢复继承，碰撞消失；自定义标记数回到样例自带的 1 个
  clearBtn.click();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(clearBtn.disabled, true);
  assert.equal(doc.querySelectorAll('.tl-key.custom').length, 1);
  rows = [...doc.querySelectorAll('.pair-row')].map((r) => r.textContent);
  jiaBing = rows.find((t) => t.includes('甲') && t.includes('丙'));
  assert.match(jiaBing, /安全/, '恢复继承后甲丙重新安全');
  dom.window.close();
});

test('播放时当前安全半径随关键帧插值实时呈现（stateAt）', async () => {
  const dom = await boot();
  const { window } = dom;
  const doc = window.document;
  const canvas = doc.getElementById('stage');

  function pointer(type, x, y) {
    canvas.dispatchEvent(new window.MouseEvent(type, {
      bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0
    }));
  }

  // 选中丙 t=8 帧 (940,540)（样例自带 r=60）并确认编辑器读回 60
  pointer('pointerdown', 940, 540);
  pointer('pointerup', 940, 540);
  assert.equal(doc.getElementById('ke-radius').value, '60', '样例关键帧半径应读回 60');

  // 引擎层插值：t=6 位于丙 4->8 帧之间，半径 20->60 线性 -> 40
  const st = window.CollisionCore.stateAt(
    [{ t: 4, x: 500, y: 60 }, { t: 8, x: 940, y: 540, r: 60 }], 6, 20);
  assert.ok(Math.abs(st.r - 40) < 1e-9, `t=6 插值半径应为 40，实际 ${st.r}`);
  dom.window.close();
});

test('最小安全余量：摘要展示、逐对升序、点击余量时刻跳转播放头', async () => {
  const dom = await boot();
  const { window } = dom;
  const doc = window.document;

  const analysis = core.analyzeScene(core.builtinScene());

  // 摘要：全局最小安全余量与当事人
  const sumMargin = doc.getElementById('sum-margin').textContent;
  assert.ok(
    sumMargin.includes(analysis.minMargin.toFixed(2)),
    `摘要最小余量「${sumMargin}」应含 ${analysis.minMargin.toFixed(2)}`
  );
  assert.match(doc.getElementById('sum-margin-who').textContent, /@\s*-?[\d.]+\s*s/);

  // 逐对列表：按最小安全余量升序，与引擎/API 同一顺序
  const rows = [...doc.querySelectorAll('.pair-row')];
  assert.equal(rows.length, 6);
  rows.forEach((row, i) => {
    const pair = analysis.pairs[i];
    assert.ok(
      row.textContent.includes(pair.aName) && row.textContent.includes(pair.bName),
      `第 ${i} 行应为 ${pair.aName}×${pair.bName}（余量 ${pair.minMargin.toFixed(2)}）`
    );
    assert.ok(row.textContent.includes('最小余量'), '每行展示最小安全余量');
    assert.ok(row.querySelector('.t-jump'), '每行余量时刻可点击');
    if (i > 0) {
      assert.ok(pair.minMargin >= analysis.pairs[i - 1].minMargin - 1e-12, '余量升序');
    }
  });

  // 点击首对（余量最小）的余量时刻：播放头跳转到该时刻并刷新画布
  const first = analysis.pairs[0];
  rows[0].querySelector('.t-jump').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const tv = Number(doc.getElementById('time-input').value);
  assert.ok(
    Math.abs(tv - first.minMarginT) < 0.01,
    `播放头应跳到 ${first.minMarginT}，实际 ${tv}`
  );
  assert.ok(doc.getElementById('playhead').style.left, '播放头位置已刷新');

  // 点击摘要余量行：跳转到全局最小余量时刻
  doc.getElementById('time-input').value = '0';
  doc.getElementById('sum-margin-row').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const tv2 = Number(doc.getElementById('time-input').value);
  assert.ok(
    Math.abs(tv2 - analysis.minMarginT) < 0.01,
    `摘要点击应跳到 ${analysis.minMarginT}，实际 ${tv2}`
  );
  dom.window.close();
});
