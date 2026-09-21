'use strict';

const path = require('path');
const express = require('express');
const core = require('../public/core.js');

const app = express();
app.use(express.json({ limit: '256kb' }));

app.use(express.static(path.join(__dirname, '..', 'public'), {
  etag: true,
  maxAge: 0
}));

app.get('/healthz', (_req, res) => {
  res.json({ ok: true });
});

/** 内置交叉样例（含关键帧安全半径），前端启动时加载 */
app.get('/api/sample', (_req, res) => {
  res.json(core.builtinScene());
});

/**
 * 把入参场景规整为 API 出参形式：每个关键帧都带显式半径 r
 * （缺省继承的帧解析为表演者当前 radius），便于集成方直接消费。
 */
function resolveScene(duration, performers) {
  return {
    duration: duration,
    performers: performers.map((p) => {
      const base = Math.max(0, Number(p.radius) || 0);
      const ks = core.normalizeKeys(p.keys, base);
      return {
        id: p.id,
        name: p.name,
        color: p.color,
        radius: base,
        keys: ks.map((k) => ({
          t: k.t,
          x: k.x,
          y: k.y,
          r: k.r === null ? base : k.r
        }))
      };
    })
  };
}

/**
 * 场景碰撞分析（与前端同一份解析引擎，便于集成/校验）。
 * body: { duration, performers:[{name?,radius,keys:[{t,x,y,r?}]}] }
 * 关键帧 r 为可选安全半径（开伞/展开道具），缺省继承表演者 radius。
 * 每对返回精确碰撞区间与最小安全余量 minMargin/minMarginT
 * （distance(t)-(rA+rB) 的连续全局最小值及发生时刻），pairs 按余量升序；
 * 场景级另附 minMargin/minMarginT/minMarginPair。
 */
app.post('/api/analyze', (req, res) => {
  try {
    const scene = req.body || {};
    const duration = Number(scene.duration);
    const performers = Array.isArray(scene.performers) ? scene.performers : [];

    if (!(duration > 0) || !isFinite(duration)) {
      return res.status(400).json({ error: 'duration 必须为正数（秒）' });
    }
    if (performers.length < 2 || performers.length > 8) {
      return res.status(400).json({ error: '表演者人数需为 2～8 人' });
    }

    performers.forEach((p, idx) => {
      if (!Array.isArray(p.keys) || p.keys.length === 0) {
        throw new Error(`第 ${idx + 1} 人至少需要 1 个走位点`);
      }
      if (!(Number(p.radius) >= 0) || !isFinite(Number(p.radius))) {
        throw new Error(`第 ${idx + 1} 人身体半径需为非负数`);
      }
      p.keys.forEach((k, ki) => {
        ['t', 'x', 'y'].forEach((f) => {
          if (!isFinite(Number(k[f]))) {
            throw new Error(`第 ${idx + 1} 人存在非法走位点（${f} 非数字）`);
          }
        });
        if (Number(k.t) < 0 || Number(k.t) > duration) {
          throw new Error(`第 ${idx + 1} 人存在超出 [0, ${duration}] 的时刻`);
        }
        if (k.r !== undefined && k.r !== null && k.r !== '') {
          if (!isFinite(Number(k.r)) || Number(k.r) < 0) {
            throw new Error(`第 ${idx + 1} 人第 ${ki + 1} 个关键帧安全半径需为非负数`);
          }
        }
      });
    });

    const result = core.analyzeScene({ duration, performers });
    res.json(Object.assign({ scene: resolveScene(duration, performers) }, result));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 兜底返回首页（仅根路径；其余静态资源缺失正常 404）
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

if (require.main === module) {
  app.listen(PORT, HOST, () => {
    console.log(`走位轨迹碰撞排练台已启动: http://localhost:${PORT}`);
  });
}

module.exports = app;
