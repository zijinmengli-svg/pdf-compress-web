"use strict";
// 纯函数：在体积预算内搜索"最高清"的(分辨率,质量)配置。无 I/O，调用方注入 async probe。
// 分辨率优先：保住分辨率，优先用质量换体积；全分辨率下质量降到地板仍超目标才降分辨率。

const COMPRESS = {
  QF_BEST: 0.02,   // 最高 JPEG 质量（体积最大）
  QF_FLOOR: 0.4,   // 最低可接受质量(~q70)；低于此宁可降分辨率
  QF_WORST: 3.0,   // 绝对最低质量，仅尽力而为兜底用
  RES_CEIL: 600,   // 分辨率上限(DPI)：保原生、收极端高清图
  RES_FLOOR: 72,   // 最低下采样分辨率
  RES_LADDER: [600, 450, 300, 220, 150, 100, 72], // 自高到低尝试的分辨率 cap
  DOWNSAMPLE_THRESHOLD: 1.0, // gs 阈值：让 cap 真正生效、绝不上采样
};

// 定分辨率 cap，找"质量最高(qf 最小)且体积 ≤ target"的配置。
// probe(qf, resCap) -> Promise<number|null>（字节数，失败/无效返回 null）。
// qfLo=最高质量，qfHi=最低可接受质量。返回 { qf, resCap, bytes }(≤target) 或 null(连 qfHi 都超)。
async function qfBracket(probe, resCap, qfLo, qfHi, target, maxIters = 5) {
  const hi = await probe(qfHi, resCap);
  if (hi == null || hi > target) return null;            // 连最低可接受质量都超目标
  let best = { qf: qfHi, resCap, bytes: hi };            // 已知 ≤ target 的兜底
  const lo = await probe(qfLo, resCap);
  if (lo != null && lo <= target) return { qf: qfLo, resCap, bytes: lo }; // 最高质量已达标
  let over = { qf: qfLo, bytes: (lo == null ? Infinity : lo) };
  for (let i = 0; i < maxIters; i++) {
    if (best.qf - over.qf < 0.01) break;                 // 区间足够小
    const p = Math.log(over.bytes / best.bytes) / Math.log(best.qf / over.qf);
    let q = (!isFinite(p) || p <= 0)
      ? (over.qf + best.qf) / 2                           // 退化 → 二分
      : over.qf * Math.pow(over.bytes / target, 1 / p);  // 幂律预测命中目标
    const margin = (best.qf - over.qf) * 0.05;           // 强制步进、严格夹在括内
    q = Math.min(best.qf - margin, Math.max(over.qf + margin, q));
    const r = await probe(q, resCap);
    if (r != null && r <= target) best = { qf: q, resCap, bytes: r };
    else over = { qf: q, bytes: (r == null ? over.bytes : r) };
  }
  return best;
}

// 分辨率优先：沿分辨率阶梯自高到低，第一个"质量地板内可塞进目标"的 cap 即用之搜质量贴目标。
// 全程返回 { qf, resCap, bytes }(≤target) 或 null（任何分辨率都塞不下 → 调用方栅格化）。
async function searchBestConfig(probe, target, opts = COMPRESS) {
  const { QF_BEST, QF_FLOOR, QF_WORST, RES_LADDER, RES_FLOOR } = opts;
  for (const cap of RES_LADDER) {
    const floorBytes = await probe(QF_FLOOR, cap);       // 该分辨率下最低可接受质量
    if (floorBytes != null && floorBytes <= target) {
      const r = await qfBracket(probe, cap, QF_BEST, QF_FLOOR, target);
      if (r) return r;                                   // 能塞进目标的最高分辨率
    }
  }
  // 任何分辨率的质量地板都超目标 → 在最低分辨率放开质量尽力而为。
  return await qfBracket(probe, RES_FLOOR, QF_BEST, QF_WORST, target);
}

module.exports = { COMPRESS, qfBracket, searchBestConfig };
