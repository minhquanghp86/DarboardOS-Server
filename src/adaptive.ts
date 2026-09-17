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
  intervalStepMs: number;     // bước RÚT nhịp khi hồi phục (cộng dần)
  intervalBackoffFactor: number; // hệ số GIÃN nhịp khi quá tải (nhân)
  cooldownDownMs: number;     // thời gian trễ khi HẠ tải (ngắn hơn khi nâng)
  maxIntervalMs: number;      // nhịp tối đa (fps thấp nhất)
  decodeBudgetRatio: number;  // tỉ lệ ngân sách decode trong 1 khung hình
  goodStreakNeeded: number;   // số mẫu tốt liên tiếp trước khi nâng lại
  cooldownMs: number;         // thời gian chờ tối thiểu giữa 2 lần chỉnh
  maxBytesPerSec: number;     // trên ngưỡng này thì KHÔNG nâng chất lượng
  minDeviceHeapFree: number;  // heap nội bộ tối thiểu của thiết bị (dưới ngưỡng -> hạ tải)
  maxBacklogBytes: number;    // tồn đọng bộ đệm gửi WS tối đa (trên ngưỡng -> hạ tải)
};

export const DEFAULT_ADAPTIVE_CFG: AdaptiveCfg = {
  minQuality: 40,
  maxQuality: 80,
  qualityStepDown: 10,
  // (17/09/2026) 5 -> 10. Hoi phuc quality tu san 40 len tran 80 truoc day mat
  // 8 buoc; nay 4 buoc.
  qualityStepUp: 10,
  intervalStepMs: 50,
  intervalBackoffFactor: 2,
  maxIntervalMs: 400,
  cooldownDownMs: 5_000,
  // (17/09/2026) 0.5 -> 0.7. Do that tren tab 5 the camera: decode 40ms, nen
  // voi ti le 0.5 diem can bang roi dung 100ms (10fps) — nhanh hon nua thi
  // ngan sach (50 -> 25ms) khong con du. Ti le 0.7 cho phep ~70ms (14fps) ma
  // van con 30% du phong.
  // Day la GIAM MUC DU PHONG, nen chi lam sau khi da co day du luoi an toan:
  // ap luc nguoc (2.6.0) phan ung tuc thi, AIMD (2.7.0) lui nhanh, va khoi
  // dong than trong (2.7.4). Khong nen nang tiep len 0.8+ ma khong do lai.
  decodeBudgetRatio: 0.7,
  // (17/09/2026) 3 -> 2 mau tot lien tiep, va tre khi NANG LAI 20s -> 10s.
  //
  // Tinh bat doi xung VAN GIU (ha tai 5s, nang lai 10s) — chi la "cham" truoc
  // day cham qua muc can thiet: tu quality 40 len 80 mat ~4 PHUT, du nguoi
  // dung chi vua chuyen tab. Do nguoi dung phan anh truc tiep.
  //
  // Co so de noi: dieu kien "thoai mai" da doi decode phai duoi MOT NUA ngan
  // sach, tuc khi nhanh hoi phuc chay thi da co gap doi du dia — bo tung buoc
  // nho trong tinh huong do la thua than trong. Rui ro dao dong van duoc chan
  // boi: van can 2 mau tot LIEN TIEP, van kiem tra ton dong socket, va chieu
  // ha tai thi nhanh hon han (nhan 2, tre 5s).
  //
  // Tong: tu 40 len 80 con ~1 phut thay vi ~4 phut.
  goodStreakNeeded: 2,
  cooldownMs: 10_000,
  maxBytesPerSec: 1_500_000,
  minDeviceHeapFree: 25_000,
  maxBacklogBytes: 98_304,
};

export type AdaptiveState = {
  quality: number;
  minFrameIntervalMs: number;
  /** Nhịp gốc do thiết bị yêu cầu (YAML). Là TRẦN fps; hồi phục không bao giờ vượt qua. */
  baseIntervalMs?: number;
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
  // (17/09/2026) Byte còn kẹt trong bộ đệm gửi WebSocket. Tín hiệu quá tải DUY
  // NHẤT không phụ thuộc vào việc thiết bị báo được số liệu về hay không.
  backlogBytes?: number | null;
};

export function initialAdaptiveState(quality: number, minFrameIntervalMs: number, now: number): AdaptiveState {
  return {
    quality,
    minFrameIntervalMs,
    baseIntervalMs: minFrameIntervalMs,
    lastChangeAt: now,
    goodStreak: 0,
    changes: 0,
    lastReason: 'khởi tạo',
  };
}

// (17/09/2026) AIMD — giam NHAN, tang CONG.
//
// Truoc day ca hai chieu deu cong/tru 50ms. Khi tran fps con la 100ms thi tam
// chap nhan duoc, nhung khi ha tran xuong 33ms (30fps) de dashboard muot thi
// di tu 33ms den 400ms mat 8 buoc — nhan voi thoi gian tre la gan 3 phut thiet
// bi bi doi 30fps, dung vung da gay crash.
//
// Nhan doi thi chi 4 buoc: 33 -> 66 -> 132 -> 264 -> 400. Hoi phuc van cong
// tung buoc 50ms nhu cu. Day la nguyen tac cua moi thuat toan chong nghen
// mang, va ly do cung y het: HONG THI PHAI LUI NHANH, HOI PHUC THI PHAI CHAM.
function backoffInterval(cur: number, cfg: AdaptiveCfg): number {
  const next = Math.round(cur * cfg.intervalBackoffFactor);
  // bao dam luon tien it nhat mot buoc, phong khi cur qua nho
  return Math.min(cfg.maxIntervalMs, Math.max(next, cur + cfg.intervalStepMs));
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
    if (now - state.lastChangeAt < cfg.cooldownDownMs) {
      return { state: out, changed: false, reason: 'heap thấp nhưng đang trong thời gian trễ' };
    }
    if (out.quality > cfg.minQuality) {
      out.quality = Math.max(cfg.minQuality, out.quality - cfg.qualityStepDown);
      out.lastReason = `heap thiet bi ${sample.heapFree}B < ${cfg.minDeviceHeapFree}B → giảm quality còn ${out.quality}`;
    } else if (out.minFrameIntervalMs < cfg.maxIntervalMs) {
      out.minFrameIntervalMs = backoffInterval(out.minFrameIntervalMs, cfg);
      out.lastReason = `heap thiet bi ${sample.heapFree}B < ${cfg.minDeviceHeapFree}B → giãn nhịp còn ${out.minFrameIntervalMs}ms`;
    } else {
      return { state: out, changed: false, reason: 'heap thấp nhưng đã ở mức thấp nhất' };
    }
    out.lastChangeAt = now;
    out.goodStreak = 0;
    out.changes = state.changes + 1;
    return { state: out, changed: true, reason: out.lastReason };
  }

  // (17/09/2026) Tồn đọng socket cao -> thiết bị KHÔNG tiêu hoá kịp. Phải xét
  // TRƯỚC nhánh "chưa có số đo decode": khi quá tải nặng thì chính gói FrameStats
  // cũng không lọt về, nên nếu chờ decodeMs thì vòng điều khiển sẽ mù đúng lúc
  // cần nó nhất. Đây là lỗ hổng đã quan sát được trên thiết bị thật.
  if (sample.backlogBytes != null && sample.backlogBytes > cfg.maxBacklogBytes) {
    if (now - state.lastChangeAt < cfg.cooldownDownMs) {
      return { state: out, changed: false, reason: 'tồn đọng cao nhưng đang trong thời gian trễ' };
    }
    if (out.minFrameIntervalMs < cfg.maxIntervalMs) {
      out.minFrameIntervalMs = backoffInterval(out.minFrameIntervalMs, cfg);
      out.lastReason = `ton dong ${sample.backlogBytes}B > ${cfg.maxBacklogBytes}B → giãn nhịp còn ${out.minFrameIntervalMs}ms`;
    } else if (out.quality > cfg.minQuality) {
      out.quality = Math.max(cfg.minQuality, out.quality - cfg.qualityStepDown);
      out.lastReason = `ton dong ${sample.backlogBytes}B > ${cfg.maxBacklogBytes}B → giảm quality còn ${out.quality}`;
    } else {
      return { state: out, changed: false, reason: 'tồn đọng cao nhưng đã ở mức thấp nhất' };
    }
    out.lastChangeAt = now;
    out.goodStreak = 0;
    out.changes = state.changes + 1;
    return { state: out, changed: true, reason: out.lastReason };
  }

  if (sample.decodeMs == null || sample.decodeMs <= 0) {
    return { state: out, changed: false, reason: 'chưa có số đo decode' };
  }
  // Ha tai dung tre NGAN; nang lai dung tre DAI (xet o nhanh hoi phuc ben duoi).
  const overloaded = sample.decodeMs > budget;
  if (now - state.lastChangeAt < (overloaded ? cfg.cooldownDownMs : cfg.cooldownMs)) {
    return { state: out, changed: false, reason: 'đang trong thời gian trễ' };
  }

  // Quá tải -> hạ chất lượng trước, chạm sàn thì giãn nhịp
  if (overloaded) {
    if (out.quality > cfg.minQuality) {
      out.quality = Math.max(cfg.minQuality, out.quality - cfg.qualityStepDown);
      out.lastReason = `decode ${sample.decodeMs.toFixed(1)}ms > ngân sách ${budget}ms → giảm quality còn ${out.quality}`;
    } else if (out.minFrameIntervalMs < cfg.maxIntervalMs) {
      out.minFrameIntervalMs = backoffInterval(out.minFrameIntervalMs, cfg);
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
  const comfortable = sample.decodeMs < budget * 0.5
    && sample.bytesPerSec < cfg.maxBytesPerSec
    && (sample.backlogBytes ?? 0) <= cfg.maxBacklogBytes / 2;

  // (17/09/2026) SUA LOI BANH COC: truoc day nhanh hoi phuc CHI nang lai quality,
  // khong bao gio rut ngan minFrameIntervalMs. Hau qua: mot tab nang (vd 5 the
  // camera) gian nhip 100ms -> 400ms, roi khi chuyen sang tab nhe thiet bi VAN
  // ket o 2.5fps vinh vien. Hoi phuc theo thu tu nguoc voi luc ha tai (LIFO):
  // rut nhip ve truoc, het moi nang quality.
  const baseIntervalMs = out.baseIntervalMs ?? out.minFrameIntervalMs;
  if (comfortable && out.minFrameIntervalMs > baseIntervalMs) {
    out.goodStreak = state.goodStreak + 1;
    if (out.goodStreak >= cfg.goodStreakNeeded) {
      out.minFrameIntervalMs = Math.max(baseIntervalMs, out.minFrameIntervalMs - cfg.intervalStepMs);
      out.goodStreak = 0;
      out.lastChangeAt = now;
      out.changes = state.changes + 1;
      out.lastReason = `decode ${sample.decodeMs.toFixed(1)}ms rất thấp → rút nhịp về ${out.minFrameIntervalMs}ms`;
      return { state: out, changed: true, reason: out.lastReason };
    }
    return { state: out, changed: false, reason: `tốt ${out.goodStreak}/${cfg.goodStreakNeeded}` };
  }

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
