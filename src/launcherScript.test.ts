import { describe, expect, it } from "vitest";
import { buildAudioGuardScript, buildLauncherScript, buildTvCodecScript } from "./deviceManager.js";

describe("launcher script (chuoi JS tiem vao moi trang)", () => {
  it("cu phap hop le (co va khong co homeUrl), co am lich + nhom ung dung", () => {
    for (const home of ["http://192.168.1.2:8123/dashboard-mobile/3", undefined]) {
      const src = buildLauncherScript(home);
      expect(() => new Function(src)).not.toThrow();
      expect(src).toContain("RwvLunar");
      expect(src).toContain('"giai_tri"');
    }
  });
});

describe("script khoa am thanh (tiem vao moi tab)", () => {
  it("cu phap hop le, co bao trang thai phat va ham dung", () => {
    for (const muted of [true, false]) {
      const src = buildAudioGuardScript(muted);
      expect(() => new Function(src)).not.toThrow();
      expect(src).toContain("__rwvMediaStop");
      expect(src).toContain('"__rwvControl"');
      expect(() => new Function(buildAudioGuardScript(muted, true))).not.toThrow();
    }
  });
  it("YouTube TV: chi H.264, gioi han cao/hinh moi giay", () => {
    const M = { isTypeSupported: (_t: string) => true };
    const P = { canPlayType: (_t: string) => 'probably' };
    const w: Record<string, unknown> = { MediaSource: M };
    new Function('window', 'HTMLMediaElement', 'navigator', buildTvCodecScript(720, 30))(w, { prototype: P }, {});
    expect(M.isTypeSupported('video/mp4; codecs="avc1.4d401f"')).toBe(true);
    expect(M.isTypeSupported('video/mp4; codecs="avc1.4d401f"; width=1280; height=720; framerate=30')).toBe(true);
    expect(M.isTypeSupported('video/mp4; codecs="avc1.4d401f"; height=1080')).toBe(false);
    expect(M.isTypeSupported('video/mp4; codecs="avc1.4d401f"; framerate=60')).toBe(false);
    expect(M.isTypeSupported('video/webm; codecs="vp9"')).toBe(false);
    expect(M.isTypeSupported('audio/webm; codecs="opus"')).toBe(true);
    expect(P.canPlayType('video/mp4; codecs="av01.0.05M.08"')).toBe('');
  });
});
