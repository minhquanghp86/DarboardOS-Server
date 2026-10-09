// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

import { describe, expect, it } from "vitest";
import { DEFAULT_ADAPTIVE_CFG, decideAdaptive, initialAdaptiveState, adaptiveBudgetMs, updateLinkEstimate, bandwidthFloorMs, LINK_CONGESTED_BYTES, LINK_PROBE_UP, LINK_CAP_MAX } from "./adaptive.js";
import type { AdaptiveState, AdaptiveSample, LinkEstimate } from "./adaptive.js";

const cfg = { ...DEFAULT_ADAPTIVE_CFG };
const t0 = 1_000_000;

describe("GĐ3 - bộ điều khiển thích nghi", () => {
  // Suy ra tu cfg thay vi ma hoa cung, de viec chinh decodeBudgetRatio khong
  // lam hong test (da tung hong khi doi 0.5 -> 0.7).
  const budgetFor = (ms: number) => Math.max(20, Math.round(ms * cfg.decodeBudgetRatio));

  /** Nap du mau tot de kich hoat DUNG MOT buoc hoi phuc. */
  function feedGood(st: AdaptiveState, sample: AdaptiveSample, startAt: number) {
    let now = startAt;
    let out = st;
    for (let i = 0; i < cfg.goodStreakNeeded; i++) {
      now += cfg.cooldownMs + 5_000;
      out = decideAdaptive(sample, out, cfg, now).state;
    }
    return { state: out, now };
  }

  it("ngân sách decode = nhịp × tỉ lệ", () => {
    const st = initialAdaptiveState(60, 100, t0);
    expect(adaptiveBudgetMs(st, cfg)).toBe(budgetFor(100));
  });

  it("chưa có số đo -> không chỉnh gì", () => {
    const st = initialAdaptiveState(60, 100, t0);
    const r = decideAdaptive({ decodeMs: null, bytesPerSec: 0, frameErrors: 0 }, st, cfg, t0 + 60_000);
    expect(r.changed).toBe(false);
  });

  it("decode vượt ngân sách -> GIẢM quality một bước", () => {
    const st = initialAdaptiveState(60, 100, t0);
    const r = decideAdaptive({ decodeMs: 90, bytesPerSec: 1000, frameErrors: 0 }, st, cfg, t0 + 60_000);
    expect(r.changed).toBe(true);
    expect(r.state.quality).toBe(50);
    expect(r.state.minFrameIntervalMs).toBe(100);
  });

  it("trong thời gian trễ -> không chỉnh tiếp", () => {
    const st = { ...initialAdaptiveState(60, 100, t0), lastChangeAt: t0 + 60_000, quality: 50 };
    // 2s < cooldownDownMs (5s) -> vẫn trong thời gian trễ
    const r = decideAdaptive({ decodeMs: 90, bytesPerSec: 1000, frameErrors: 0 }, st, cfg, t0 + 60_000 + 2_000);
    expect(r.changed).toBe(false);
    expect(r.state.quality).toBe(50);
  });

  it("AIMD: hạ tải dùng trễ NGẮN, nâng lại dùng trễ DÀI", () => {
    // Cùng một mốc 6s: quá tải thì được phép hạ (trễ 5s), còn dư địa thì chưa
    // được phép nâng (trễ 20s). Hỏng phải lùi nhanh, hồi phục phải chậm.
    const st = { ...initialAdaptiveState(60, 100, t0), lastChangeAt: t0, quality: 50 };
    const down = decideAdaptive({ decodeMs: 90, bytesPerSec: 1000, frameErrors: 0 }, st, cfg, t0 + 6_000);
    expect(down.changed).toBe(true);
    expect(down.state.quality).toBe(40);

    const up = decideAdaptive({ decodeMs: 5, bytesPerSec: 1000, frameErrors: 0 }, st, cfg, t0 + 6_000);
    expect(up.changed).toBe(false);
  });

  it("AIMD: từ trần 33ms (30fps) chạm đáy 400ms trong 4 bước", () => {
    // Đây là lý do phải đổi sang giảm nhân. Với bước cộng 50ms thì mất 8 bước;
    // nhân với thời gian trễ là gần 3 phút thiết bị bị dội 30fps.
    let st = { ...initialAdaptiveState(40, 33, t0), quality: 40 }; // quality đã chạm sàn
    let now = t0;
    const seen: number[] = [];
    for (let i = 0; i < 6; i++) {
      now += 30_000;
      const r = decideAdaptive({ decodeMs: 500, bytesPerSec: 1000, frameErrors: 0 }, st, cfg, now);
      st = r.state;
      if (r.changed) seen.push(st.minFrameIntervalMs);
      if (st.minFrameIntervalMs >= cfg.maxIntervalMs) break;
    }
    // 33*2=66 nhung san "it nhat mot buoc" (33+50=83) lon hon nen thang o buoc
    // dau; tu do tro di he so nhan chiem uu the.
    expect(seen).toEqual([83, 166, 332, 400]);
    expect(seen.length).toBeLessThanOrEqual(4);
  });

  it("quá tải liên tục: giảm dần quality tới sàn rồi mới giãn nhịp", () => {
    let st = initialAdaptiveState(60, 100, t0);
    let now = t0;
    // 60 -> 50 -> 40 (chạm sàn)
    for (let i = 0; i < 2; i++) {
      now += 30_000;
      st = decideAdaptive({ decodeMs: 200, bytesPerSec: 1000, frameErrors: 0 }, st, cfg, now).state;
    }
    expect(st.quality).toBe(40);
    const budget0 = adaptiveBudgetMs(st, cfg);
    expect(budget0).toBe(budgetFor(100));
    now += 30_000;
    const r = decideAdaptive({ decodeMs: 200, bytesPerSec: 1000, frameErrors: 0 }, st, cfg, now);
    expect(r.changed).toBe(true);
    expect(r.state.quality).toBe(40);
    expect(r.state.minFrameIntervalMs).toBe(200); // AIMD: giãn nhịp 100 -> 200 (nhân 2)
  });

  it("hết quá tải -> RÚT nhịp về mức gốc trước, rồi mới nâng quality", () => {
    // Mô phỏng: tab 5 thẻ camera đã ép nhịp 100 -> 200ms, quality chạm sàn 40.
    // Sang tab nhẹ (decode rất thấp) thì phải hồi phục được về 100ms.
    let st = { ...initialAdaptiveState(60, 100, t0), quality: 40, minFrameIntervalMs: 200 };
    let now = t0;
    const light = { decodeMs: 5, bytesPerSec: 1000, frameErrors: 0 };

    // đủ mẫu tốt -> rút 200 -> 150
    ({ state: st, now } = feedGood(st, light, now));
    expect(st.minFrameIntervalMs).toBe(200 - cfg.intervalStepMs);
    expect(st.quality).toBe(40); // quality chưa đụng tới

    // đủ mẫu tốt nữa -> rút tiếp về 100 (mức gốc)
    ({ state: st, now } = feedGood(st, light, now));
    expect(st.minFrameIntervalMs).toBe(100);

    // Đã về gốc: KHÔNG vượt qua nữa, chuyển sang nâng quality
    ({ state: st, now } = feedGood(st, light, now));
    expect(st.minFrameIntervalMs).toBe(100);
    expect(st.quality).toBe(40 + cfg.qualityStepUp);
  });

  it("tồn đọng socket cao -> giãn nhịp NGAY cả khi chưa có số đo decode", () => {
    // Đúng lúc quá tải nặng thì gói FrameStats cũng không lọt về, nên decodeMs
    // là null. Trước đây vòng điều khiển bó tay đúng lúc cần nó nhất.
    const st = initialAdaptiveState(70, 100, t0);
    const r = decideAdaptive(
      { decodeMs: null, bytesPerSec: 1000, frameErrors: 0, backlogBytes: 200_000 },
      st, cfg, t0 + 60_000
    );
    expect(r.changed).toBe(true);
    expect(r.state.minFrameIntervalMs).toBe(200); // AIMD: nhân 2
    expect(r.state.quality).toBe(70); // giãn nhịp TRƯỚC, chưa đụng quality
  });

  it("tồn đọng còn cao -> KHÔNG hồi phục dù decode nhanh", () => {
    const st = { ...initialAdaptiveState(60, 100, t0), quality: 40, minFrameIntervalMs: 200 };
    const r = decideAdaptive(
      { decodeMs: 5, bytesPerSec: 1000, frameErrors: 0, backlogBytes: 60_000 },
      st, cfg, t0 + 60_000
    );
    expect(r.changed).toBe(false);
    expect(r.state.minFrameIntervalMs).toBe(200);
  });

  it("ngưỡng tránh nghẽn: KHÔNG rút lại xuống nhịp vừa gây quá tải", () => {
    // Đo thật (tab 5 thẻ camera, tỉ lệ ngân sách 0.7): hệ dao động vô hạn —
    //   50ms quá tải -> giãn 200ms -> rút 150/100/50 -> quá tải -> lặp
    // Dao động đó chiếm hết các lượt hồi phục nên quality kẹt ở sàn 40.
    let st = { ...initialAdaptiveState(80, 33, t0), quality: 40, minFrameIntervalMs: 50 };
    let now = t0 + 60_000;

    // Quá tải ở 50ms -> ghi nhớ ngưỡng và giãn ra
    const bad = decideAdaptive({ decodeMs: 200, bytesPerSec: 1000, frameErrors: 0 }, st, cfg, now);
    expect(bad.changed).toBe(true);
    st = bad.state;
    expect(st.probeFloorMs).toBe(50);
    const stretched = st.minFrameIntervalMs;
    expect(stretched).toBeGreaterThan(50);

    // Rất thoải mái -> hồi phục, NHƯNG trong khi ngưỡng còn hiệu lực thì không
    // được chạm lại 50ms. (Sau `probeRetryAfter` vòng, ngưỡng được nới để thử
    // lại — có chủ ý, nếu không thì một lần quá tải nhất thời sẽ khoá fps
    // vĩnh viễn. Nên chỉ kiểm trong cửa sổ trước khi nới.)
    const light = { decodeMs: 5, bytesPerSec: 1000, frameErrors: 0 };
    const qualityBefore = st.quality;
    for (let i = 0; i < cfg.probeRetryAfter - 1; i++) {
      now += cfg.cooldownMs + 5_000;
      st = decideAdaptive(light, st, cfg, now).state;
      expect(st.minFrameIntervalMs).toBeGreaterThan(50);
    }
    // Và lượt hồi phục phải tự nhường cho quality thay vì bị nhịp chiếm hết
    expect(st.quality).toBeGreaterThan(qualityBefore);
  });

  it("ngưỡng tránh nghẽn tự nới sau khi ổn định lâu (không khoá fps vĩnh viễn)", () => {
    let st: AdaptiveState = { ...initialAdaptiveState(80, 33, t0), quality: 80, minFrameIntervalMs: 100,
               probeFloorMs: 50, probeBlocked: 0 };
    let now = t0;
    const light = { decodeMs: 5, bytesPerSec: 1000, frameErrors: 0 };
    for (let i = 0; i < cfg.probeRetryAfter + 2; i++) {
      now += cfg.cooldownMs + 5_000;
      st = decideAdaptive(light, st, cfg, now).state;
    }
    // da noi (hoac bo han) nguong -> khong khoa cung o 100ms nua
    expect(st.probeFloorMs == null || st.probeFloorMs < 50).toBe(true);
  });

  it("đường truyền RÕ RÀNG khoẻ (tồn đọng ~0, dùng < 25% băng thông) -> bỏ ngưỡng cũ ~350 ms, ≤ 80 ms trong ~75 s (P4 07/10)", () => {
    // Do that: nguong hoc luc mang P4 nghen giu ~3 fps nhieu phut sau khi mang het nghen.
    let st: AdaptiveState = { ...initialAdaptiveState(40, 33, t0), quality: 40, minFrameIntervalMs: 400, probeFloorMs: 350, probeBlocked: 0 };
    let now = t0;
    const healthy = { decodeMs: 16, bytesPerSec: 120_000, recentBytesPerSec: 120_000, capacityBytesPerSec: 2_000_000, backlogBytes: 0, frameErrors: 0 };
    let reached = -1;
    for (let i = 1; i <= 24; i++) {  // nhip dieu tiet that 5 s -> 2 phut
      now += 5_000;
      st = decideAdaptive(healthy, st, cfg, now).state;
      if (reached < 0 && st.minFrameIntervalMs <= 80) reached = i * 5;
    }
    expect(st.probeFloorMs).toBeUndefined();
    expect(reached).toBeGreaterThan(0);
    expect(reached).toBeLessThanOrEqual(75);
  });

  it("thiếu số đo tồn đọng / băng thông -> GIỮ cách nới cũ (50 ms sau probeRetryAfter vòng)", () => {
    let st: AdaptiveState = { ...initialAdaptiveState(40, 33, t0), quality: 80, minFrameIntervalMs: 400, probeFloorMs: 350, probeBlocked: 0 };
    let now = t0;
    const light = { decodeMs: 5, bytesPerSec: 1000, frameErrors: 0 };
    for (let i = 0; i < cfg.probeRetryAfter; i++) { now += cfg.cooldownMs + 5_000; st = decideAdaptive(light, st, cfg, now).state; }
    expect(st.probeFloorMs).toBe(350 - cfg.intervalStepMs);
  });

  it("đang dùng gần hết băng thông (≥ 25%) -> KHÔNG coi là khoẻ, giữ cách nới cũ", () => {
    let st: AdaptiveState = { ...initialAdaptiveState(40, 33, t0), quality: 40, minFrameIntervalMs: 400, probeFloorMs: 350, probeBlocked: 0 };
    let now = t0;
    const busy = { decodeMs: 16, bytesPerSec: 600_000, recentBytesPerSec: 600_000, capacityBytesPerSec: 1_000_000, backlogBytes: 0, frameErrors: 0 };
    for (let i = 0; i < 3; i++) { now += cfg.cooldownMs + 5_000; st = decideAdaptive(busy, st, cfg, now).state; }
    expect(st.probeFloorMs).toBe(350);
  });

  it("nhịp giãn làm ngân sách rộng ra -> hết quá tải", () => {
    const st = { ...initialAdaptiveState(40, 150, t0) };
    // ngân sách = 75ms; decode 60ms -> không vượt -> ổn định
    const r = decideAdaptive({ decodeMs: 60, bytesPerSec: 1000, frameErrors: 0 }, st, cfg, t0 + 30_000);
    expect(r.changed).toBe(false);
    expect(r.reason).toBe("ổn định");
  });

  it("dư địa: cần đủ mẫu tốt LIÊN TIẾP mới TĂNG quality", () => {
    let st = initialAdaptiveState(40, 100, t0);
    let now = t0 + cfg.cooldownMs + 5_000;
    const good = { decodeMs: 10, bytesPerSec: 10_000, frameErrors: 0 };
    // các mẫu trước mẫu cuối cùng: chưa đủ chuỗi -> chưa đổi
    for (let i = 0; i < cfg.goodStreakNeeded - 1; i++) {
      const r = decideAdaptive(good, st, cfg, now);
      expect(r.changed).toBe(false);
      st = r.state;
      now += cfg.cooldownMs + 5_000;
    }
    const last = decideAdaptive(good, st, cfg, now);
    expect(last.changed).toBe(true);
    expect(last.state.quality).toBe(40 + cfg.qualityStepUp);
  });

  it("hồi phục quality từ sàn lên trần trong số bước hợp lý", () => {
    // Người dùng phản ánh: sau khi chuyển tab, quality bò từ 40 lên 80 mất ~4 phút.
    // Đây là ràng buộc chống hồi quy cho số BƯỚC (thời gian thật = bước × trễ).
    let st = { ...initialAdaptiveState(80, 100, t0), quality: cfg.minQuality };
    let now = t0;
    let steps = 0;
    const light = { decodeMs: 5, bytesPerSec: 1000, frameErrors: 0 };
    while (st.quality < 80 && steps < 50) {
      now += cfg.cooldownMs + 5_000;
      const r = decideAdaptive(light, st, cfg, now);
      st = r.state;
      if (r.changed) steps++;
    }
    expect(st.quality).toBe(80);
    expect(steps).toBeLessThanOrEqual(4);
  });

  it("mạng đã căng -> KHÔNG nâng chất lượng dù decode rất thấp", () => {
    let st = initialAdaptiveState(40, 100, t0);
    let now = t0 + 30_000;
    const heavy = { decodeMs: 5, bytesPerSec: cfg.maxBytesPerSec + 1, frameErrors: 0 };
    for (let i = 0; i < 5; i++) {
      const r = decideAdaptive(heavy, st, cfg, now);
      expect(r.changed).toBe(false);
      st = r.state;
      now += 30_000;
    }
    expect(st.quality).toBe(40);
  });

  it("không vượt quá chất lượng thiết bị yêu cầu (maxQuality)", () => {
    const cfgLow = { ...cfg, maxQuality: 60 };
    let st = initialAdaptiveState(55, 100, t0);
    let now = t0;
    for (let i = 0; i < 6; i++) {
      now += 30_000;
      st = decideAdaptive({ decodeMs: 5, bytesPerSec: 1000, frameErrors: 0 }, st, cfgLow, now).state;
    }
    expect(st.quality).toBeLessThanOrEqual(60);
    expect(st.quality).toBe(60);
  });
});

// (24/09/2026) Bo dieu tiet biet BANG THONG. Kich ban lay tu log that cua P4 phat YouTube:
// giai ma chi 30-40ms, khung ~52KB, nhung socket ton dong 270-600KB lap lai vi WiFi la
// nut that — bo dieu tiet cu rut nhip + tang quality cho toi khi nghen roi gian x2 len 400ms.
describe("GĐ3 - ước lượng đường truyền", () => {
  const C = LINK_CONGESTED_BYTES;

  it("đo băng thông CHỈ khi socket nghẽn suốt cửa sổ", () => {
    let l = updateLinkEstimate(undefined, 0, 0, 0, t0);
    // khong nghen: day 100KB/s, khong ton dong -> chua biet bang thong
    l = updateLinkEstimate(l, 500_000, 0, 10, t0 + 5_000);
    expect(l.capacityBytesPerSec).toBeUndefined();
    expect(l.recentBytesPerSec).toBe(100_000);
    expect(l.recentFrameBytes).toBe(50_000);
    // nghen ca dau lan cuoi: day 2MB nhung chi 1MB roi server trong 5s -> 200KB/s
    l = { ...l, lastBacklog: 2 * C };
    const sentBefore = l.lastSent;
    l = updateLinkEstimate(l, sentBefore + 1_000_000, 2 * C, 30, t0 + 10_000);
    expect(l.capacityBytesPerSec).toBe(200_000);
  });

  it("ngoài lúc nghẽn, xả nhanh hơn ước lượng -> NÂNG ước lượng", () => {
    const l0 = { lastAt: t0, lastSent: 0, lastBacklog: 0, lastFrames: 0, capacityBytesPerSec: 100_000 };
    const l = updateLinkEstimate(l0, 1_500_000, 0, 10, t0 + 5_000);
    expect(l.capacityBytesPerSec).toBe(300_000);
  });

  it("không nghẽn -> ước lượng TỰ NÂNG dần (một lần đo lúc WiFi kém không khoá fps vĩnh viễn)", () => {
    // Kich ban that: do 230KB/s luc WiFi kem; san nhip giu tai o ~215KB/s < 230 nen
    // neu khong tu nang thi duong truyen khong bao gio co dip chung minh no chiu duoc 564KB/s.
    let l: LinkEstimate = { lastAt: t0, lastSent: 0, lastBacklog: 0, lastFrames: 0, capacityBytesPerSec: 230_000 };
    let now = t0;
    for (let i = 0; i < 20; i++) {
      now += 5_000;
      l = updateLinkEstimate(l, l.lastSent + 1_075_000, 0, l.lastFrames + 12, now);   // 215KB/s
    }
    expect(l.capacityBytesPerSec).toBeGreaterThan(230_000 * 2.5);
    // nghen lai thi do lai ngay con so that
    const congested = { ...l, lastBacklog: 2 * LINK_CONGESTED_BYTES };
    const l2 = updateLinkEstimate(congested, congested.lastSent + 1_150_000, 2 * LINK_CONGESTED_BYTES, congested.lastFrames + 12, now + 5_000);
    expect(l2.capacityBytesPerSec).toBeLessThan(l.capacityBytesPerSec! * 0.75);
    expect(LINK_PROBE_UP).toBeGreaterThan(1);
  });

  it("không nghẽn nhiều giờ -> ước lượng KHÔNG vượt trần (bộ ghi P4 07/10: 1,5e84 B/s)", () => {
    let l: LinkEstimate = { lastAt: t0, lastSent: 0, lastBacklog: 0, lastFrames: 0, capacityBytesPerSec: 300_000 };
    let now = t0;
    for (let i = 0; i < 3000; i++) {  // ~4 gio, nhip 5 s
      now += 5_000;
      l = updateLinkEstimate(l, l.lastSent + 150_000, 0, l.lastFrames + 12, now);
    }
    expect(l.capacityBytesPerSec).toBe(LINK_CAP_MAX);
    expect(Number.isFinite(l.capacityBytesPerSec)).toBe(true);
  });

  it("socket mới (bộ đếm về 0) -> đặt lại mốc nhưng GIỮ băng thông đã biết", () => {
    const l0 = { lastAt: t0, lastSent: 9_000_000, lastBacklog: 0, lastFrames: 500, capacityBytesPerSec: 250_000 };
    const l = updateLinkEstimate(l0, 1_000, 0, 1, t0 + 5_000);
    expect(l.lastSent).toBe(1_000);
    expect(l.capacityBytesPerSec).toBe(250_000);
    expect(l.recentBytesPerSec).toBeUndefined();
  });

  it("sàn nhịp theo băng thông = khung / (75% băng thông)", () => {
    const s = { decodeMs: 30, bytesPerSec: 0, frameErrors: 0, capacityBytesPerSec: 300_000, recentFrameBytes: 52_000 };
    expect(bandwidthFloorMs(s, cfg)).toBe(Math.ceil(52_000_000 / (0.75 * 300_000)));   // 232ms
    expect(bandwidthFloorMs({ decodeMs: 30, bytesPerSec: 0, frameErrors: 0 }, cfg)).toBe(0);
  });

  it("tồn đọng + biết băng thông -> nhảy THẲNG tới sàn băng thông, không nhân đôi mù", () => {
    const st = { ...initialAdaptiveState(55, 33, t0), minFrameIntervalMs: 182 };
    const r = decideAdaptive({ decodeMs: 35, bytesPerSec: 0, frameErrors: 0, backlogBytes: 270_000,
      capacityBytesPerSec: 300_000, recentFrameBytes: 52_000 }, st, cfg, t0 + 60_000);
    expect(r.state.minFrameIntervalMs).toBe(232);        // cu: 364
    expect(r.state.probeFloorMs).toBe(182);
  });

  it("tồn đọng lúc nhịp nhanh + ước lượng băng thông thấp -> giãn tối đa gấp đôi, không nhảy thẳng 400 ms (P4 30/09)", () => {
    // Log that: "ton dong 333341B -> gian nhip con 400ms" tu 50 ms trong MOT buoc -> 2,5 khung/s hon mot phut.
    const s = { decodeMs: 15, bytesPerSec: 0, frameErrors: 0, backlogBytes: 333_341,
      capacityBytesPerSec: 120_000, recentFrameBytes: 37_000 };
    expect(bandwidthFloorMs(s, cfg)).toBe(400);
    const st = { ...initialAdaptiveState(40, 33, t0), minFrameIntervalMs: 50 };
    expect(decideAdaptive(s, st, cfg, t0 + 60_000).state.minFrameIntervalMs).toBe(100);
  });

  it("một cú nghẽn ngắn mất tối đa 40% ước lượng băng thông, không nghẽn thì hồi lại trong ~20 s", () => {
    const l0: LinkEstimate = { lastAt: t0, lastSent: 0, lastBacklog: 2 * LINK_CONGESTED_BYTES, lastFrames: 0, capacityBytesPerSec: 900_000 };
    const l1 = updateLinkEstimate(l0, 250_000, 2 * LINK_CONGESTED_BYTES, 10, t0 + 5_000);   // chi thoat 50 KB/s luc don
    expect(l1.capacityBytesPerSec).toBe(540_000);                                              // cu: 475_000
    let l: LinkEstimate = { ...l1, lastBacklog: 0 };
    let now = t0 + 5_000;
    for (let i = 0; i < 4; i++) { now += 5_000; l = updateLinkEstimate(l, l.lastSent + 2_500_000, 0, l.lastFrames + 100, now); }
    expect(l.capacityBytesPerSec).toBeGreaterThan(900_000);
  });

  it("hồi phục rút NỬA khoảng cách về sàn, và dừng đúng ở sàn băng thông", () => {
    let st: AdaptiveState = { ...initialAdaptiveState(55, 33, t0), minFrameIntervalMs: 400 };
    const s = { decodeMs: 30, bytesPerSec: 0, frameErrors: 0, backlogBytes: 0,
      capacityBytesPerSec: 300_000, recentFrameBytes: 52_000, recentBytesPerSec: 100_000 };
    const seen: number[] = [];
    let now = t0;
    for (let i = 0; i < 6; i++) {
      const r = feedGoodLocal(st, s, now);
      st = r.state; now = r.now;
      seen.push(st.minFrameIntervalMs);
    }
    // san 232: 400 -84 (nua khoang cach 168) = 316; 316 -50 (nua khoang cach chi 42 < 1 buoc) = 266; -> 232
    expect(seen.slice(0, 3)).toEqual([316, 266, 232]);
    expect(Math.min(...seen)).toBe(232);                   // khong bao gio duoi san bang thong
  });

  it("đang dùng ≥75% băng thông -> KHÔNG tăng quality (khung to hơn sẽ gây nghẽn)", () => {
    const st = { ...initialAdaptiveState(55, 232, t0), quality: 40 };
    const s = { decodeMs: 30, bytesPerSec: 0, frameErrors: 0, backlogBytes: 0,
      capacityBytesPerSec: 300_000, recentFrameBytes: 52_000, recentBytesPerSec: 230_000 };
    const r = feedGoodLocal(st, s, t0);
    expect(r.state.quality).toBe(40);
    // con du dia (40% bang thong) thi van tang nhu cu
    const r2 = feedGoodLocal(st, { ...s, recentBytesPerSec: 120_000 }, t0);
    expect(r2.state.quality).toBe(50);
  });

  function feedGoodLocal(st: AdaptiveState, sample: AdaptiveSample, startAt: number) {
    let now = startAt;
    let out = st;
    for (let i = 0; i < cfg.goodStreakNeeded; i++) {
      now += cfg.cooldownMs + 5_000;
      out = decideAdaptive(sample, out, cfg, now).state;
    }
    return { state: out, now };
  }
});
