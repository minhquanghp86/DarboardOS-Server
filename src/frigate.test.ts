// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

import { describe, expect, it } from "vitest";
import { hostsOfConfig, hostsOfRuntime, parseFrigateTitle, toEvent } from "./frigate.js";

describe("frigate — su kien camera", () => {
  it("doc dia chi tu tieu de muc cau hinh tich hop (vd: frigate:5000)", () => {
    expect(parseFrigateTitle("frigate:5000")).toEqual({ host: "frigate", port: 5000 });
    expect(parseFrigateTitle("http://192.168.1.5:5000/")).toEqual({ host: "192.168.1.5", port: 5000 });
    expect(parseFrigateTitle("frigate")).toEqual({ host: "frigate", port: 5000 });
    expect(parseFrigateTitle("rac rac")).toBeNull();
    expect(parseFrigateTitle("x:99999")).toBeNull();
  });
  it("su kien Frigate 0.18 -> ban gon; sub_label dang mang; id la bi bo", () => {
    const e = toEvent({ id: "1791384622.358381-abc123", camera: "ezviz", label: "person", sub_label: ["Minh", 0.9],
      top_score: 0.8123, start_time: 1791384622.35, end_time: 1791384640.1, has_clip: true, has_snapshot: true, zones: ["cong"],
      thumbnail: "AAAA" });
    expect(e).toEqual({ id: "1791384622.358381-abc123", camera: "ezviz", label: "person", sub: "Minh", score: 0.81,
      start: 1791384622.35, end: 1791384640.1, clip: true, snap: true, zones: ["cong"] });
    expect(toEvent({ id: "1.2-x", camera: "c", label: "car", data: { top_score: 0.7 }, end_time: null })!.end).toBeNull();
    expect(toEvent({ id: "../../etc", camera: "c" })).toBeNull();
  });
});

describe("frigate — camera cua chinh panel", () => {
  it("lay may chu nguon tu go2rtc + ffmpeg, bo 127.0.0.1 va mat khau (cau hinh that 08/10)", () => {
    const h = hostsOfConfig({
      cameras: { p4_panel: { ffmpeg: { inputs: [{ path: "rtsp://127.0.0.1:8554/p4_panel" }] } },
        ezviz: { ffmpeg: { inputs: [{ path: "rtsp://127.0.0.1:8554/ezviz" }, { path: "rtsp://127.0.0.1:8554/ezviz_sub" }] } },
        nogo: { ffmpeg: { inputs: [{ path: "rtsp://admin:secret@192.168.1.150:554/live" }] } } },
      go2rtc: { streams: { p4_panel: "http://192.168.1.179:8080/live", ezviz: ["rtsp://u:p@192.168.1.101:554/a", "ffmpeg:ezviz#video=h264", "rac"] } },
    });
    expect(h).toEqual({ p4_panel: ["192.168.1.179"], ezviz: ["192.168.1.101"], nogo: ["192.168.1.150"] });
  });
});

describe("(08/10/2026) frigate — nguon go2rtc DANG CHAY (doi IP khong can khoi dong lai Frigate)", () => {
  it("lay may chu tu producers.url, bo mat khau / 127.0.0.1", () => {
    const rt = { p4_panel: { producers: [{ url: "http://192.168.1.24:8080/live" }] },
      ezviz: { producers: [{ url: "rtsp://u:p@192.168.1.101:554/a" }, { url: "rtsp://127.0.0.1:8554/x" }] }, rong: {} };
    expect(hostsOfRuntime(rt)).toEqual({ p4_panel: ["192.168.1.24"], ezviz: ["192.168.1.101"], rong: [] });
    expect(hostsOfRuntime(null)).toEqual({});
  });
});

import { camAuth, cameraHost, noteCameraHost } from "./camProxy.js";
describe("(08/10/2026) mat khau HTTP cua P4 — server gan header khi goi cam_app", () => {
  it("co ?ca= -> Authorization Basic; khong co / sai dang -> khong header (firmware chua bat mat khau)", () => {
    // firmware: hex("darboard:matkhau123")
    noteCameraHost("esp32-p4", "::ffff:192.168.1.24", 8082, Buffer.from("darboard:matkhau123").toString("hex"));
    expect(cameraHost()).toEqual({ ip: "192.168.1.24", port: 8082, auth: "ZGFyYm9hcmQ6bWF0a2hhdTEyMw==" });
    expect(camAuth(cameraHost()!)).toEqual({ authorization: "Basic ZGFyYm9hcmQ6bWF0a2hhdTEyMw==" });
    noteCameraHost("esp32-p4", "192.168.1.24", 8082, "khong hop le!");
    expect(camAuth(cameraHost()!)).toEqual({});
    noteCameraHost("esp32-p4", "192.168.1.24", 8082, null);
    expect(cameraHost()).toEqual({ ip: "192.168.1.24", port: 8082 });
    noteCameraHost("esp32-p4", "192.168.1.24", 0);
    expect(cameraHost()).toBeUndefined();
  });
});

describe("(09/10/2026) luong qua server /cam/live/<id>", () => {
  it("them dau cam-live:<id> de nhan camera cua chinh panel", () => {
    const h = hostsOfRuntime({ p4_panel: { producers: [{ url: "ffmpeg:http://172.30.32.1:18080/cam/live/esp32-0a0b0c0d0003#video=copy" }] },
      cong: { producers: [{ url: "rtsp://u:p@192.168.1.20:554/s" }] } });
    expect(h.p4_panel).toContain("cam-live:esp32-0a0b0c0d0003");
    expect(h.cong).toEqual(["192.168.1.20"]);
  });
});
