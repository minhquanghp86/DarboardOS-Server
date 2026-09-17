import { describe, expect, it } from "vitest";
import { DEFAULT_ADAPTIVE_CFG, decideAdaptive, initialAdaptiveState, adaptiveBudgetMs } from "./adaptive.js";
import type { AdaptiveState, AdaptiveSample } from "./adaptive.js";

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
    let st = { ...initialAdaptiveState(80, 33, t0), quality: 80, minFrameIntervalMs: 100,
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
