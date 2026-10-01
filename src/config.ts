// SPDX-License-Identifier: Apache-2.0 AND MIT
//
// Portions Copyright (c) 2025 strange_v - MIT License (see LICENSE-MIT).
// Modifications Copyright (c) 2026 minhquanghp86 - Apache License 2.0 (see LICENSE).
//
// Derived from strange-v/RemoteWebViewServer. THIS FILE HAS BEEN MODIFIED.

import env from "env-var";
import { getRotatedDimensions, Rotation } from "./util.js";

export type DeviceConfig = {
  height: number;                   // px
  width: number;                    // px
  tileSize: number;                 // px
  fullFrameTileCount: number;       // tiles
  fullFrameAreaThreshold: number;   // 0..1
  fullFrameEvery: number;           // frames
  everyNthFrame: number;            // frames (>=1)
  minFrameInterval: number;         // ms (>=0)
  jpegQuality: number;              // 1..100
  maxBytesPerMessage: number;       // bytes (>0)
  rotation: Rotation;               // degrees
  // (23/09/2026) URL "ve nha" cua thiet bi, dung de nhung vao script
  // launcher (nut dropdown Home/YouTube). CO Y KHONG dua vao
  // deviceConfigsEqual() ben duoi — doi gia tri nay (nguoi dung sua "Home
  // URL" tren HA) khong duoc phep kich "Reconfiguring" -> pha Chromium
  // target, dung y het bai hoc da ghi o deviceManager.ts dong 49.
  homeUrl?: string;
  // (23/09/2026) Thiet bi tu bao "toi co loa, gui audio cho toi" qua tham so
  // ?audio=1 — chi firmware co goi set_speaker() (P4) moi gui co nay, S3
  // khong dung nen mac dinh false, khong nhan goi AudioFrame nao. Giong
  // homeUrl, KHONG dua vao deviceConfigsEqual() vi day la co dinh theo
  // firmware, khong phai thu can kich "Reconfiguring" khi doi.
  audioEnabled: boolean;
  // (24/09/2026) Thiet bi bao "toi phong duoc khung nua do phan giai" qua ?half=1 (P4: JPEG + PPA phan cung).
  // Chi khi do server moi gui khung video 1/2 do phan giai (FLAG_HALF_SCALE). Nhu audioEnabled, KHONG dua
  // vao deviceConfigsEqual() — co dinh theo firmware.
  halfScale: boolean;
  // (30/09/2026) ?half=2: nhu half=1 VA thiet bi MUON khung nua cho MOI video (S3: giai ma JPEG phan mem ~60 ms/khung
  // 480x480 -> YouTube ~2 fps; nua do phan giai = 1/4 diem anh, phong x2 bang phan mem). Co dinh theo firmware.
  halfVideo: boolean;
  // (01/10/2026) ?cam=<cong>: firmware co ung dung Camera (cam_app, chi P4). 0 = khong co -> an ung dung Camera. Co dinh
  // theo firmware, KHONG dua vao deviceConfigsEqual().
  camPort: number;
  // (01/10/2026) ?snd=1: firmware tu phat chuong / bao thuc (DeviceControl PlaySound, am luong rieng Thong bao / Bao thuc,
  // Khong lam phien tren thiet bi). Khong co -> chuong qua luong am thanh trang web nhu cu. Co dinh theo firmware.
  sound: boolean;
  // (25/09/2026) Thiet bi co trigger on_url_entered (bao ?urlset=1): URL nguoi dung nhap o nut mo rong duoc GUI
  // cho thiet bi (SetDisplayURL) de no tu dat "URL hien thi" roi mo trang. Khong co -> server tu mo trang.
  // Co dinh theo firmware, KHONG dua vao deviceConfigsEqual() (giong halfScale).
  urlSet: boolean;
  // (25/09/2026) ?fb=1: thiet bi giai ma thang vao framebuffer -> khung day du chia dai ngang (frameProcessor).
  fbBands: boolean;
  // (25/09/2026) ?ctl=1: thiet bi nhan DeviceControl (thanh truot do sang/am luong) va gui DeviceState. Co dinh
  // theo firmware, KHONG dua vao deviceConfigsEqual().
  devControl: boolean;
  // (27/09/2026) ?va=1: firmware co tro ly giong noi (on_assist) -> Shell hien nut "Tro ly". Co dinh theo firmware.
  voice: boolean;
};

const DEFAULTS = {
  tileSize: 32,
  fullFrameTileCount: 4,
  fullFrameAreaThreshold: 0.5,
  fullFrameEvery: 50,
  everyNthFrame: 1,
  minFrameInterval: 80,
  jpegQuality: 85,
  maxBytesPerMessage: 14336,
  rotation: 0,
} as const;

const store = new Map<string, DeviceConfig>();

export function getConfigFor(id: string): DeviceConfig {
  const cfg = store.get(id);
  if (!cfg) throw new Error(`config for id="${id}" not found`);
  return cfg;
}
export function setConfigFor(id: string, cfg: DeviceConfig): void {
  store.set(id, cfg);
}

function num(input?: string | null): number | undefined {
  if (input == null) return undefined;
  const v = Number(input);
  if (!Number.isFinite(v)) throw new Error(`invalid number: "${input}"`);
  return v;
}
function intPos(input?: string | null): number | undefined {
  const v = num(input);
  if (v == null) return undefined;
  if (!Number.isInteger(v) || v <= 0) throw new Error(`invalid positive integer: "${input}"`);
  return v;
}
function intNonNeg(input?: string | null): number | undefined {
  const v = num(input);
  if (v == null) return undefined;
  if (!Number.isInteger(v) || v < 0) throw new Error(`invalid non-negative integer: "${input}"`);
  return v;
}
function float01(input?: string | null): number | undefined {
  const v = num(input);
  if (v == null) return undefined;
  if (v < 0 || v > 1) throw new Error(`invalid 0..1 number: "${input}"`);
  return v;
}
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

function readEnvFallbacks(): Partial<DeviceConfig> {
  const val = (name: string) => env.get(name).asString() ?? undefined;

  const out: Partial<DeviceConfig> = {};
  const TS = val("TILE_SIZE");
  const FFTC = val("FULL_FRAME_TILE_COUNT");
  const FFAT = val("FULL_FRAME_AREA_THRESHOLD");
  const FFE = val("FULL_FRAME_EVERY");
  const ENF = val("EVERY_NTH_FRAME");
  const MFI = val("MIN_FRAME_INTERVAL_MS");
  const Q = val("JPEG_QUALITY");
  const MBPM = val("MAX_BYTES_PER_MESSAGE");

  if (TS) out.tileSize = intPos(TS)!;
  if (FFTC) out.fullFrameTileCount = intPos(FFTC)!;
  if (FFAT != null) out.fullFrameAreaThreshold = float01(FFAT)!;
  if (FFE) out.fullFrameEvery = intPos(FFE)!;
  if (ENF) out.everyNthFrame = intPos(ENF)!;
  if (MFI != null) out.minFrameInterval = intNonNeg(MFI)!;
  if (Q) out.jpegQuality = clamp(intPos(Q)!, 1, 100);
  if (MBPM) out.maxBytesPerMessage = intPos(MBPM)!;

  return out;
}

export function makeConfigFromParams(params: URLSearchParams): DeviceConfig {
  const envFallbacks = readEnvFallbacks();

  // required
  let height = intPos(params.get("h")) ?? envFallbacks.height;
  let width = intPos(params.get("w")) ?? envFallbacks.width;
  if (!height || !width) throw new Error(`missing required params "h" and/or "w"`);

  // optional
  const tileSize = intPos(params.get("ts")) ?? envFallbacks.tileSize ?? DEFAULTS.tileSize;
  const fullFrameTileCount = intPos(params.get("fftc")) ?? envFallbacks.fullFrameTileCount ?? DEFAULTS.fullFrameTileCount;
  const fullFrameAreaThreshold = float01(params.get("ffat")) ?? envFallbacks.fullFrameAreaThreshold ?? DEFAULTS.fullFrameAreaThreshold;
  const fullFrameEvery = intPos(params.get("ffe")) ?? envFallbacks.fullFrameEvery ?? DEFAULTS.fullFrameEvery;
  const minFrameInterval = intNonNeg(params.get("mfi")) ?? envFallbacks.minFrameInterval ?? DEFAULTS.minFrameInterval;
  const everyNthFrame = intPos(params.get("enf")) ?? envFallbacks.everyNthFrame ?? DEFAULTS.everyNthFrame;
  const jpegQuality = clamp(intPos(params.get("q")) ?? envFallbacks.jpegQuality ?? DEFAULTS.jpegQuality, 1, 100);
  const maxBytesPerMessage = intPos(params.get("mbpm")) ?? envFallbacks.maxBytesPerMessage ?? DEFAULTS.maxBytesPerMessage;
  const rotation = intNonNeg(params.get("r")) as 0 | 90 | 180 | 270 | undefined
    ?? DEFAULTS.rotation;
  // URLSearchParams.get() tu giai ma percent-encoding — khop voi
  // append_q_str_encoded_() ben phia firmware.
  const homeUrl = params.get("home") || undefined;
  const audioEnabled = params.get("audio") === "1";
  const halfScale = params.get("half") === "1" || params.get("half") === "2";
  const halfVideo = params.get("half") === "2";
  const camPort = Math.max(0, Math.min(65535, parseInt(params.get("cam") || "0", 10) || 0));
  const sound = params.get("snd") === "1";
  const urlSet = params.get("urlset") === "1";
  const fbBands = params.get("fb") === "1";
  const devControl = params.get("ctl") === "1";
  const voice = params.get("va") === "1";

  const dimensions = getRotatedDimensions(width, height, rotation);

  return {
    height: dimensions.height,
    width: dimensions.width,
    tileSize,
    fullFrameTileCount,
    fullFrameAreaThreshold,
    fullFrameEvery,
    minFrameInterval,
    everyNthFrame,
    jpegQuality,
    maxBytesPerMessage,
    rotation,
    homeUrl,
    audioEnabled,
    halfScale,
    halfVideo,
    camPort,
    sound,
    urlSet,
    fbBands,
    devControl,
    voice,
  };
}

export function deviceConfigsEqual(
  a: DeviceConfig,
  b: DeviceConfig,
  eps = 1e-6
): boolean {
  return (
    a.width === b.width &&
    a.height === b.height &&
    a.tileSize === b.tileSize &&
    a.fullFrameTileCount === b.fullFrameTileCount &&
    Math.abs(a.fullFrameAreaThreshold - b.fullFrameAreaThreshold) <= eps &&
    a.fullFrameEvery === b.fullFrameEvery &&
    a.everyNthFrame === b.everyNthFrame &&
    a.minFrameInterval === b.minFrameInterval &&
    a.jpegQuality === b.jpegQuality &&
    a.maxBytesPerMessage === b.maxBytesPerMessage &&
    a.rotation === b.rotation
  );
}

export function logDeviceConfig(id: string, cfg: DeviceConfig): void {
  const entries: [string, string | number][] = [
    ["width", cfg.width],
    ["height", cfg.height],
    ["tileSize", cfg.tileSize],
    ["fullFrameTileCount", cfg.fullFrameTileCount],
    ["fullFrameAreaThreshold", cfg.fullFrameAreaThreshold.toFixed(3)],
    ["fullFrameEvery", cfg.fullFrameEvery],
    ["everyNthFrame", cfg.everyNthFrame],
    ["minFrameInterval", cfg.minFrameInterval],
    ["jpegQuality", cfg.jpegQuality],
    ["maxBytesPerMessage", cfg.maxBytesPerMessage],
    ["rotation", cfg.rotation],
    ["audioEnabled", cfg.audioEnabled ? "1" : "0"],
  ];

  const head = `[client_connect] id=${id}`;
  const body = entries.map(([k, v]) => `  ${k}=${v}`).join('\n');

  console.info(`${head}\n${body}`);
}
