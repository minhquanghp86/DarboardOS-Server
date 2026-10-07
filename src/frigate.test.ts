import { describe, expect, it } from "vitest";
import { parseFrigateTitle, toEvent } from "./frigate.js";

describe("frigate — su kien camera", () => {
  it("doc dia chi tu tieu de muc cau hinh tich hop (do that: ccab4aaf-frigate-fa:5000)", () => {
    expect(parseFrigateTitle("ccab4aaf-frigate-fa:5000")).toEqual({ host: "ccab4aaf-frigate-fa", port: 5000 });
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
