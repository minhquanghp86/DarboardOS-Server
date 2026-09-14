// GĐ3 - Vòng điều khiển thích nghi (adaptive): tự chỉnh CHẤT LƯỢNG JPEG và NHỊP GỬI FRAME
// cho TỪNG thiết bị, dựa trên số đo THẬT (thời gian decode do chính thiết bị báo về,
// bytes/s, lỗi). Có "trễ" (cooldown) và yêu cầu nhiều mẫu tốt liên tiếp mới nâng lại
// -> tránh dao động lên xuống liên tục.
//
// Ngân sách decode = minFrameInterval × decodeBudgetRatio. Ví dụ nhịp 100ms (10fps),
// tỉ lệ 0.5 -> thiết bị nên decode xong trong 50ms; vượt thì giảm chất lượng trước,
// hết mức giảm được thì giãn nhịp (hạ fps).

export type AdaptiveCfg = {
  minQuality: number;         // sàn chất lượng
  maxQuality: number;         // trần = chất lượng thiết bị yêu cầu (từ YAML)
  qualityStepDown: number;    // bước giảm khi quá tải
  qualityStepUp: number;      // bước tăng khi dư địa
  intervalStepMs: number;     // bước giãn nhịp khi đã chạm sàn chất lượng
  maxIntervalMs: number;      // nhịp tối đa (fps thấp nhất)
  decodeBudgetRatio: number;  // tỉ lệ ngân sách decode trong 1 khung hình
  goodStreakNeeded: number;   // số mẫu tốt liên tiếp trước khi nâng lại
  cooldownMs: number;         // thời gian chờ tối thiểu giữa 2 lần chỉnh
  maxBytesPerSec: number;     // trên ngưỡng này thì KHÔNG nâng chất lượng
  minDeviceHeapFree: number;  // heap nội bộ tối thiểu của thiết bị (dưới ngưỡng -> hạ tải)
};

export const DEFAULT_ADAPTIVE_CFG: AdaptiveCfg = {
  minQuality: 40,
  maxQuality: 80,
  qualityStepDown: 10,
  qualityStepUp: 5,
  intervalStepMs: 50,
  maxIntervalMs: 400,
  decodeBudgetRatio: 0.5,
  goodStreakNeeded: 3,
  cooldownMs: 20_000,
  maxBytesPerSec: 1_500_000,
  minDeviceHeapFree: 25_000,
};

export type AdaptiveState = {
  quality: number;
  minFrameIntervalMs: number;
  lastChangeAt: number;
  goodStreak: number;
  changes: number;
  lastReason: string;
};

export type AdaptiveSample = {
  decodeMs: number | null;
  bytesPerSec: number;
  frameErrors: number;
  // (14/09/2026) GD3.5: heap noi bo con lai cua thiet bi (null = firmware cu, khong biet)
  heapFree?: number | null;
};

export function initialAdaptiveState(quality: number, minFrameIntervalMs: number, now: number): AdaptiveState {
  return {
    quality,
    minFrameIntervalMs,
    lastChangeAt: now,
    goodStreak: 0,
    changes: 0,
    lastReason: 'khởi tạo',
  };
}

export function adaptiveBudgetMs(state: AdaptiveState, cfg: AdaptiveCfg): number {
  return Math.max(20, Math.round(state.minFrameIntervalMs * cfg.decodeBudgetRatio));
}

export function decideAdaptive(
  sample: AdaptiveSample,
  state: AdaptiveState,
  cfg: AdaptiveCfg,
  now: number
): { state: AdaptiveState; changed: boolean; reason: string } {
  const out: AdaptiveState = { ...state };
  const budget = adaptiveBudgetMs(state, cfg);

  // (14/09/2026) GD3.5: RAM nội bộ của thiết bị quá thấp -> hạ tải NGAY (không chờ decode).
  // Đây là "phanh an toan": thà mất chất lượng còn hơn tràn RAM/reboot.
  if (sample.heapFree != null && sample.heapFree < cfg.minDeviceHeapFree) {
    if (now - state.lastChangeAt < cfg.cooldownMs) {
      return { state: out, changed: false, reason: 'heap thấp nhưng đang trong thời gian trễ' };
    }
    if (out.quality > cfg.minQuality) {
      out.quality = Math.max(cfg.minQuality, out.quality - cfg.qualityStepDown);
      out.lastReason = `heap thiet bi ${sample.heapFree}B < ${cfg.minDeviceHeapFree}B → giảm quality còn ${out.quality}`;
    } else if (out.minFrameIntervalMs < cfg.maxIntervalMs) {
      out.minFrameIntervalMs = Math.min(cfg.maxIntervalMs, out.minFrameIntervalMs + cfg.intervalStepMs);
      out.lastReason = `heap thiet bi ${sample.heapFree}B < ${cfg.minDeviceHeapFree}B → giãn nhịp còn ${out.minFrameIntervalMs}ms`;
    } else {
      return { state: out, changed: false, reason: 'heap thấp nhưng đã ở mức thấp nhất' };
    }
    out.lastChangeAt = now;
    out.goodStreak = 0;
    out.changes = state.changes + 1;
    return { state: out, changed: true, reason: out.lastReason };
  }

  if (sample.decodeMs == null || sample.decodeMs <= 0) {
    return { state: out, changed: false, reason: 'chưa có số đo decode' };
  }
  if (now - state.lastChangeAt < cfg.cooldownMs) {
    return { state: out, changed: false, reason: 'đang trong thời gian trễ' };
  }

  // Quá tải -> hạ chất lượng trước, chạm sàn thì giãn nhịp
  if (sample.decodeMs > budget) {
    if (out.quality > cfg.minQuality) {
      out.quality = Math.max(cfg.minQuality, out.quality - cfg.qualityStepDown);
      out.lastReason = `decode ${sample.decodeMs.toFixed(1)}ms > ngân sách ${budget}ms → giảm quality còn ${out.quality}`;
    } else if (out.minFrameIntervalMs < cfg.maxIntervalMs) {
      out.minFrameIntervalMs = Math.min(cfg.maxIntervalMs, out.minFrameIntervalMs + cfg.intervalStepMs);
      out.lastReason = `decode ${sample.decodeMs.toFixed(1)}ms > ngân sách ${budget}ms → giãn nhịp còn ${out.minFrameIntervalMs}ms`;
    } else {
      return { state: out, changed: false, reason: 'đã ở mức thấp nhất' };
    }
    out.lastChangeAt = now;
    out.goodStreak = 0;
    out.changes = state.changes + 1;
    return { state: out, changed: true, reason: out.lastReason };
  }

  // Dư địa -> nâng lại dần, cần nhiều mẫu tốt liên tiếp và mạng không căng
  const comfortable = sample.decodeMs < budget * 0.5 && sample.bytesPerSec < cfg.maxBytesPerSec;
  if (comfortable && out.quality < cfg.maxQuality) {
    out.goodStreak = state.goodStreak + 1;
    if (out.goodStreak >= cfg.goodStreakNeeded) {
      out.quality = Math.min(cfg.maxQuality, out.quality + cfg.qualityStepUp);
      out.goodStreak = 0;
      out.lastChangeAt = now;
      out.changes = state.changes + 1;
      out.lastReason = `decode ${sample.decodeMs.toFixed(1)}ms rất thấp → tăng quality lên ${out.quality}`;
      return { state: out, changed: true, reason: out.lastReason };
    }
    return { state: out, changed: false, reason: `tốt ${out.goodStreak}/${cfg.goodStreakNeeded}` };
  }

  out.goodStreak = 0;
  return { state: out, changed: false, reason: 'ổn định' };
}
