// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

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
  probeRetryAfter: number;    // số lần bị chặn trước khi nới ngưỡng tránh nghẽn một bước
  linkUtilization: number;    // tỉ lệ băng thông đo được được phép dùng (phần còn lại = đệm an toàn)
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
  // (17/09/2026) Da thu 0.5 -> 0.7 roi TRA VE 0.5.
  //
  // Voi 0.7, do that tren tab 5 the camera: fps len 15.97 nhung he DAO DONG —
  // diem can bang roi vao vung 50ms, ma o do decode (37ms) chi hon ngan sach
  // (35ms) mot chut, nen chi can mot dao dong nho la lat qua lat lai:
  //     50ms -> qua tai -> quality 70->40, gian 100ms -> "rat thap" -> 50ms
  // Ap luc nguoc phai can thiep 7 lan/7 phut va quality ket o san 40 — tuc
  // NGUOI DUNG XIN THEM CHAT LUONG MA NHAN LAI IT HON.
  //
  // Nguong tranh nghen (probeFloorMs) da chan duoc dao dong do, nhung diem can
  // bang on dinh nhat van la 100ms/10fps — dung bang voi ti le 0.5. Tuc 0.7
  // khong doi lai duoc gi ma chi day he toi sat mep. Nguoi dung quyet dinh tra
  // ve 0.5 sau khi thu thuc te.
  //
  // Bai hoc: ti le nay khong phai "muc du phong thua" ma la KHOANG CACH AN
  // TOAN toi vung mat on dinh.
  decodeBudgetRatio: 0.5,
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
  probeRetryAfter: 6,
  // (24/09/2026) Chi dung 75% bang thong do duoc. Phan con lai hap thu dao dong WiFi
  // va cac khung full-frame lon hon trung binh.
  linkUtilization: 0.75,
};

export type AdaptiveState = {
  quality: number;
  minFrameIntervalMs: number;
  /** Nhịp gốc do thiết bị yêu cầu (YAML). Là TRẦN fps; hồi phục không bao giờ vượt qua. */
  baseIntervalMs?: number;
  /**
   * (17/09/2026) NGƯỠNG TRÁNH NGHẼN — tương tự `ssthresh` của TCP.
   * Nhịp gần nhất ĐÃ GÂY QUÁ TẢI. Hồi phục không được rút xuống tới mức này nữa.
   * Không có nó, bộ điều tiết "quên" rằng 50ms vừa thất bại và cứ lao xuống lại:
   * đo thật -> 50ms quá tải -> giãn 200ms -> rút 150/100/50 -> quá tải -> lặp.
   * Dao động đó còn chiếm hết các lượt hồi phục nên quality kẹt vĩnh viễn ở sàn.
   */
  probeFloorMs?: number;
  /** Số lần hồi phục bị `probeFloorMs` chặn — đủ nhiều thì nới thử lại một bước. */
  probeBlocked?: number;
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
  // (24/09/2026) Uoc luong duong truyen (xem updateLinkEstimate). Thieu = khong biet,
  // bo dieu tiet chay y nhu truoc.
  /** Băng thông THẬT của đường truyền, đo lúc socket đang nghẽn (byte/s). */
  capacityBytesPerSec?: number | null;
  /** Tải đang đẩy đi trong cửa sổ gần nhất (byte/s) — thay cho trung bình từ lúc kết nối. */
  recentBytesPerSec?: number | null;
  /** Kích thước trung bình một khung trong cửa sổ gần nhất (byte, gồm cả phần tiếng đi kèm). */
  recentFrameBytes?: number | null;
};

// ══════════════════════════════════════════════════════════════════════════
// (24/09/2026) UOC LUONG DUONG TRUYEN
//
// Do that tren P4 (WiFi qua chip phu C6): giai ma chi 30-40ms/khung, nhung khi phat
// YouTube thi socket ton dong 270-600 KB lap di lap lai. Nut that la BANG THONG,
// khong phai CPU. Bo dieu tiet cu chi nhin thoi gian giai ma khi hoi phuc, nen no:
// rut nhip + TANG quality (khung to hon) -> vuot bang thong -> ton dong -> gian x2
// len 400ms -> hoi phuc -50ms/20s mat vai phut -> lap lai. Log that:
//     rut nhip ve 182ms -> tang quality 50, 55 -> ton dong 270KB -> gian 364ms
//
// Cach do: trong luc socket NGHEN (con ton dong o ca dau va cuoi cua so), toc do
// byte roi khoi server CHINH LA bang thong duong truyen. Ngoai luc nghen thi toc do
// do chi la tai minh dang day, nen chi dung de NANG uoc luong khi no vuot qua.
// ══════════════════════════════════════════════════════════════════════════

/** Tồn đọng tối thiểu (cả đầu lẫn cuối cửa sổ) để coi là đang nghẽn. */
export const LINK_CONGESTED_BYTES = 32_768;
/** Hệ số tự nâng ước lượng băng thông mỗi tick không nghẽn (dò dần như TCP).
 * (30/09/2026) 1.05 -> 1.15: do that tren P4 — mot cu nghen ngan luc chuyen tab keo uoc luong con 397 KB/s (thuc te
 * vua chay on 860 KB/s), san nhip bi giu 150-190 ms (5-6 khung/s) HON MOT PHUT vi moi 5 s chi nang 5%. 15%: gap doi
 * sau ~25 s; neu duong truyen yeu that, lan nghen ke tiep keo xuong lai. */
export const LINK_PROBE_UP = 1.15;
/** (30/09/2026) Moi lan do luc nghen, uoc luong giam toi da 40%: mot cu don vai giay (khung day du luc chuyen tab,
 * thiet bi dang ban) khong duoc lam "mat" nua bang thong. Duong truyen yeu that thi vai lan do lien tiep van keo xuong. */
export const LINK_MAX_DROP = 0.6;

export type LinkEstimate = {
  lastAt: number;
  lastSent: number;
  lastBacklog: number;
  lastFrames: number;
  capacityBytesPerSec?: number;
  recentBytesPerSec?: number;
  recentFrameBytes?: number;
};

export function updateLinkEstimate(
  prev: LinkEstimate | undefined,
  sent: number,
  backlog: number,
  frames: number,
  now: number
): LinkEstimate {
  // Lan dau, hoac socket moi (bo dem quay ve 0): chi dat moc, giu lai bang thong da biet.
  if (!prev || sent < prev.lastSent || frames < prev.lastFrames) {
    return { lastAt: now, lastSent: sent, lastBacklog: backlog, lastFrames: frames,
             capacityBytesPerSec: prev?.capacityBytesPerSec };
  }
  const dt = (now - prev.lastAt) / 1000;
  if (dt <= 0) return prev;

  const offered = (sent - prev.lastSent) / dt;
  const drained = Math.max(0, ((sent - backlog) - (prev.lastSent - prev.lastBacklog)) / dt);
  let cap = prev.capacityBytesPerSec;
  if (prev.lastBacklog > LINK_CONGESTED_BYTES && backlog > LINK_CONGESTED_BYTES) {
    cap = cap != null ? Math.max(Math.round(LINK_MAX_DROP * cap), Math.round(0.5 * cap + 0.5 * drained)) : Math.round(drained);
  } else if (cap != null && drained > cap) {
    cap = Math.round(drained);   // duong truyen vua chung minh chiu duoc nhieu hon
  } else if (cap != null && backlog < LINK_CONGESTED_BYTES) {
    // Khong nghen: cho uoc luong TU NANG 5% moi lan (~gap doi sau 70s). Khong co buoc nay
    // thi mot lan do trung luc WiFi kem se khoa fps vinh vien: san nhip giu tai DUOI muc
    // do, nen duong truyen khong bao gio co dip chung minh no chiu duoc nhieu hon.
    // Do that 24/09: cung P4, luc 230 KB/s (dang kem), vai phut sau 564 KB/s khong nghen.
    // Neu duong truyen that su yeu, lan nghen ke tiep se do lai dung con so.
    cap = Math.round(cap * LINK_PROBE_UP);
  }

  const dFrames = frames - prev.lastFrames;
  let frameBytes = prev.recentFrameBytes;
  if (dFrames > 0) {
    const fb = (sent - prev.lastSent) / dFrames;
    frameBytes = frameBytes != null ? Math.round(0.5 * frameBytes + 0.5 * fb) : Math.round(fb);
  }

  return {
    lastAt: now, lastSent: sent, lastBacklog: backlog, lastFrames: frames,
    capacityBytesPerSec: cap,
    recentBytesPerSec: Math.round(offered),
    recentFrameBytes: frameBytes,
  };
}

/**
 * Nhịp tối thiểu mà đường truyền chịu được: một khung cỡ hiện tại phải đi hết trong
 * phần băng thông được phép dùng. 0 = chưa đủ số liệu.
 */
export function bandwidthFloorMs(sample: AdaptiveSample, cfg: AdaptiveCfg): number {
  const cap = sample.capacityBytesPerSec;
  const fb = sample.recentFrameBytes;
  if (!cap || !fb || cap <= 0 || fb <= 0) return 0;
  return Math.min(cfg.maxIntervalMs, Math.ceil((fb * 1000) / (cfg.linkUtilization * cap)));
}

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
/** Ghi nho nhip vua gay qua tai, de hoi phuc khong lao xuong lai dung cho do. */
function rememberFailure(out: AdaptiveState, failedAt: number): void {
  out.probeFloorMs = out.probeFloorMs != null
    ? Math.max(out.probeFloorMs, failedAt)
    : failedAt;
  out.probeBlocked = 0;
}

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
      rememberFailure(out, out.minFrameIntervalMs);
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
      rememberFailure(out, out.minFrameIntervalMs);
      // (24/09/2026) Biet bang thong thi nhay THANG toi nhip duong truyen chiu duoc,
      // thay vi nhan doi mu (182 -> 364 -> 400 trong khi chi can ~250).
      const bwFloor = bandwidthFloorMs(sample, cfg);
      // (30/09/2026) Nhung KHONG qua gap doi moi buoc: do that tren P4, uoc luong bang thong do sai dung luc nghen ->
      // nhay 50 -> 400 ms (2,5 khung/s) trong mot buoc, roi mat hon mot phut moi hoi phuc — nguoi dung thay "video giat".
      out.minFrameIntervalMs = bwFloor > out.minFrameIntervalMs
        ? Math.min(cfg.maxIntervalMs, backoffInterval(out.minFrameIntervalMs, cfg),
            Math.max(bwFloor, out.minFrameIntervalMs + cfg.intervalStepMs))
        : backoffInterval(out.minFrameIntervalMs, cfg);
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
      rememberFailure(out, out.minFrameIntervalMs);
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
  // (24/09/2026) Tai GAN DAY thay cho trung binh tu luc ket noi (sau 3 tieng con so do
  // khong con noi len gi), va khong duoc vuot phan bang thong cho phep.
  const rate = sample.recentBytesPerSec ?? sample.bytesPerSec;
  const cap = sample.capacityBytesPerSec;
  const comfortable = sample.decodeMs < budget * 0.5
    && rate < cfg.maxBytesPerSec
    && (cap == null || cap <= 0 || rate < cfg.linkUtilization * cap)
    && (sample.backlogBytes ?? 0) <= cfg.maxBacklogBytes / 2;

  // (17/09/2026) THU TU HOI PHUC: NHIP TRUOC, QUALITY SAU (LIFO — go cai vua
  // hong truoc). Da can nhac dao lai thanh quality-truoc khi thay quality ket o
  // san 40, nhung KHONG CAN: nguyen nhan that la thieu nguong tranh nghen. Khi
  // nhip bi nguong chan, luot hoi phuc TU NHUONG cho quality.
  //
  // SUA LOI BANH COC: truoc day nhanh hoi phuc CHI nang lai quality,
  // khong bao gio rut ngan minFrameIntervalMs. Hau qua: mot tab nang (vd 5 the
  // camera) gian nhip 100ms -> 400ms, roi khi chuyen sang tab nhe thiet bi VAN
  // ket o 2.5fps vinh vien. Hoi phuc theo thu tu nguoc voi luc ha tai (LIFO):
  // rut nhip ve truoc, het moi nang quality.
  const baseIntervalMs = out.baseIntervalMs ?? out.minFrameIntervalMs;
  // San hoi phuc = max(tran thiet bi yeu cau, nguong tranh nghen + mot buoc,
  //                   nhip toi thieu ma bang thong chiu duoc).
  const recoverFloor = Math.max(
    out.probeFloorMs != null ? Math.max(baseIntervalMs, out.probeFloorMs + cfg.intervalStepMs) : baseIntervalMs,
    bandwidthFloorMs(sample, cfg),
  );

  // Bi ngUong chan ma van rat thoai mai qua nhieu vong -> noi thu mot buoc.
  // Khong co co che noi nay thi mot lan qua tai nhat thoi se khoa fps vinh vien.
  if (comfortable && out.probeFloorMs != null && out.minFrameIntervalMs <= recoverFloor) {
    out.probeBlocked = (out.probeBlocked ?? 0) + 1;
    if (out.probeBlocked >= cfg.probeRetryAfter) {
      out.probeBlocked = 0;
      const next = out.probeFloorMs - cfg.intervalStepMs;
      out.probeFloorMs = next <= baseIntervalMs ? undefined : next;
      out.lastReason = `on dinh lau -> noi nguong tranh nghen`;
    }
  }

  // 1) Rut nhip truoc (LIFO — go cai vua bi gian ra), nhung khong duoi recoverFloor.
  if (comfortable && out.minFrameIntervalMs > recoverFloor) {
    out.goodStreak = state.goodStreak + 1;
    if (out.goodStreak >= cfg.goodStreakNeeded) {
      // (24/09/2026) Rut NUA khoang cach ve san (it nhat mot buoc) thay vi -50ms moi
      // lan: 400 -> san 182 truoc mat 5 buoc (~1,5 phut), nay 400 -> 291 -> 236 -> 209...
      // Van an toan vi san da tinh den bang thong va nguong tranh nghen.
      const gap = out.minFrameIntervalMs - recoverFloor;
      out.minFrameIntervalMs = Math.max(recoverFloor,
        out.minFrameIntervalMs - Math.max(cfg.intervalStepMs, Math.ceil(gap / 2)));
      out.goodStreak = 0;
      out.lastChangeAt = now;
      out.changes = state.changes + 1;
      out.lastReason = `decode ${sample.decodeMs.toFixed(1)}ms rất thấp → rút nhịp về ${out.minFrameIntervalMs}ms`;
      return { state: out, changed: true, reason: out.lastReason };
    }
    return { state: out, changed: false, reason: `tốt ${out.goodStreak}/${cfg.goodStreakNeeded}` };
  }

  // 2) Nhip da cham san (hoac bi nguong tranh nghen chan) -> luot hoi phuc
  //    TU NHUONG cho quality. Day la ly do khong can dao thu tu hai khoi nay.
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
