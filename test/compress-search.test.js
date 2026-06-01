"use strict";
const assert = require("assert");
const { COMPRESS, qfBracket, searchBestConfig } = require("../lib/compress-search");

// 合成体积模型：体积随 qf 减小而增大(∝ qf^-0.5)、随有效分辨率^2 增大；
// 有效分辨率 = min(cap, nativeDpi) —— 模拟"绝不上采样"。
function makeOracle({ base, nativeDpi, refDpi = 150, gamma = 0.5, quantize = 0 }) {
  return async (qf, cap) => {
    const effDpi = Math.min(cap, nativeDpi);
    let bytes = base * Math.pow(effDpi / refDpi, 2) * Math.pow(qf, -gamma);
    if (quantize > 0) bytes = Math.round(bytes / quantize) * quantize; // 模拟 JPEG 量化台阶
    return Math.round(bytes);
  };
}

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log("PASS - " + name); passed++; }
  catch (e) { console.log("FAIL - " + name + " :: " + e.message); failed++; }
}

(async () => {
  // qfBracket：低清文件(native 130)，目标 20e6，全分辨率(cap 600→eff 130)下质量地板可达标。
  await test("qfBracket 命中目标内、贴下沿、保住分辨率", async () => {
    const probe = makeOracle({ base: 6e6, nativeDpi: 130 });
    const target = 20e6;
    const r = await qfBracket(probe, 600, COMPRESS.QF_BEST, COMPRESS.QF_FLOOR, target);
    assert.ok(r, "应返回配置");
    assert.strictEqual(r.resCap, 600, "分辨率 cap 应保持 600（不下采样）");
    assert.ok(r.bytes <= target, `不得超目标: ${r.bytes} <= ${target}`);
    assert.ok(r.bytes >= target * 0.8, `应贴近目标下沿: ${r.bytes} >= ${target * 0.8}`);
    assert.ok(r.qf > COMPRESS.QF_BEST && r.qf < COMPRESS.QF_FLOOR, "qf 应落在区间内");
  });

  // qfBracket：最高质量已达标(有余量) → 直接返回最高质量，不注水。
  await test("qfBracket 最高质量已达标则返回最高质量", async () => {
    const probe = makeOracle({ base: 6e6, nativeDpi: 130 });
    const r = await qfBracket(probe, 600, COMPRESS.QF_BEST, COMPRESS.QF_FLOOR, 40e6);
    assert.ok(r, "应返回配置");
    assert.strictEqual(r.qf, COMPRESS.QF_BEST, "最高质量已 ≤ 目标，应返回最高质量");
    assert.ok(r.bytes <= 40e6);
  });

  // qfBracket：连质量地板都超目标 → null。
  await test("qfBracket 地板仍超目标返回 null", async () => {
    const probe = makeOracle({ base: 6e6, nativeDpi: 600 }); // 高清，cap600 体积大
    const r = await qfBracket(probe, 600, COMPRESS.QF_BEST, COMPRESS.QF_FLOOR, 8e6);
    assert.strictEqual(r, null, "全分辨率地板都塞不进 → null");
  });

  // qfBracket：量化台阶下也绝不返回超目标结果（修边界 bug）。
  await test("qfBracket 量化台阶下仍 ≤ 目标", async () => {
    const probe = makeOracle({ base: 6e6, nativeDpi: 130, quantize: 2e6 });
    const target = 20e6;
    const r = await qfBracket(probe, 600, COMPRESS.QF_BEST, COMPRESS.QF_FLOOR, target);
    assert.ok(r, "应返回配置");
    assert.ok(r.bytes <= target, `量化下也不得超目标: ${r.bytes} <= ${target}`);
  });

  // searchBestConfig：低清文件全分辨率达标 → 保住 600 cap。
  await test("searchBestConfig 低清文件保住全分辨率", async () => {
    const probe = makeOracle({ base: 6e6, nativeDpi: 130 });
    const r = await searchBestConfig(probe, 20e6, COMPRESS);
    assert.ok(r, "应返回配置");
    assert.strictEqual(r.resCap, 600, "低清文件应保 600 cap");
    assert.ok(r.bytes <= 20e6);
  });

  // searchBestConfig：高清文件全分辨率塞不下 → 沿阶梯下降取最高可行 cap。
  await test("searchBestConfig 高清文件取最高可行分辨率", async () => {
    const probe = makeOracle({ base: 6e6, nativeDpi: 600 });
    const r = await searchBestConfig(probe, 8e6, COMPRESS);
    assert.ok(r, "应返回配置");
    assert.strictEqual(r.resCap, 100, "应取能塞进目标的最高 cap(=100)");
    assert.ok(r.bytes <= 8e6, `不得超目标: ${r.bytes}`);
  });

  // searchBestConfig：物理不可达(目标过小) → null（交由调用方栅格化）。
  await test("searchBestConfig 不可达返回 null", async () => {
    const probe = makeOracle({ base: 6e6, nativeDpi: 600 });
    const r = await searchBestConfig(probe, 5e5, COMPRESS);
    assert.strictEqual(r, null, "目标过小、连兜底都超 → null");
  });

  console.log(`\nSUMMARY: ${passed}/${passed + failed} passed`);
  process.exit(failed === 0 ? 0 : 1);
})();
