import { describe, expect, it } from "vitest";
import { DEFAULT_ADAPTIVE_CFG, decideAdaptive, initialAdaptiveState, adaptiveBudgetMs } from "./adaptive.js";

const cfg = { ...DEFAULT_ADAPTIVE_CFG };
const t0 = 1_000_000;

describe("GĐ3 - bộ điều khiển thích nghi", () => {
  // Suy ra tu cfg thay vi ma hoa cung, de viec chinh decodeBudgetRatio khong
  // lam hong test (da tung hong khi doi 0.5 -> 0.7).
  const budgetFor = (ms: number) => Math.max(20, Math.round(ms * cfg.decodeBudgetRatio));

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

    // 3 mẫu tốt -> rút 200 -> 150
    for (let i = 0; i < 3; i++) { now += 30_000; st = decideAdaptive(light, st, cfg, now).state; }
    expect(st.minFrameIntervalMs).toBe(150);
    expect(st.quality).toBe(40); // quality chưa đụng tới

    // 3 mẫu tốt nữa -> rút 150 -> 100 (mức gốc)
    for (let i = 0; i < 3; i++) { now += 30_000; st = decideAdaptive(light, st, cfg, now).state; }
    expect(st.minFrameIntervalMs).toBe(100);

    // Đã về gốc: KHÔNG vượt qua nữa, chuyển sang nâng quality
    for (let i = 0; i < 3; i++) { now += 30_000; st = decideAdaptive(light, st, cfg, now).state; }
    expect(st.minFrameIntervalMs).toBe(100);
    expect(st.quality).toBe(45);
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

  it("nhịp giãn làm ngân sách rộng ra -> hết quá tải", () => {
    const st = { ...initialAdaptiveState(40, 150, t0) };
    // ngân sách = 75ms; decode 60ms -> không vượt -> ổn định
    const r = decideAdaptive({ decodeMs: 60, bytesPerSec: 1000, frameErrors: 0 }, st, cfg, t0 + 30_000);
    expect(r.changed).toBe(false);
    expect(r.reason).toBe("ổn định");
  });

  it("dư địa: cần 3 mẫu tốt liên tiếp mới TĂNG quality", () => {
    let st = initialAdaptiveState(40, 100, t0);
    let now = t0 + 30_000;
    const good = { decodeMs: 10, bytesPerSec: 10_000, frameErrors: 0 };
    for (let i = 0; i < 2; i++) {
      const r = decideAdaptive(good, st, cfg, now);
      expect(r.changed).toBe(false);
      st = r.state;
      now += 30_000;
    }
    const r3 = decideAdaptive(good, st, cfg, now);
    expect(r3.changed).toBe(true);
    expect(r3.state.quality).toBe(45);
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
