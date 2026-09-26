import { describe, expect, it } from "vitest";
import { SerialQueue, TabPolicyView, nowPlaying, pickEvictions, recentsList } from "./tabPolicy.js";

const tab = (key: string, o: Partial<TabPolicyView> = {}): TabPolicyView => ({
  key, label: key, pinned: false, backgroundAudio: false, mediaPlaying: false, mediaKnown: false, lastUsed: 0, ...o,
});

describe("don tab (MAX_APP_TABS)", () => {
  it("don tab cu nhat, khong dung tab ghim va tab active", () => {
    const tabs = [
      tab("home", { pinned: true, lastUsed: 0 }),
      tab("cams", { lastUsed: 1 }),
      tab("weather", { lastUsed: 2 }),
      tab("scenes", { lastUsed: 3 }),
    ];
    expect(pickEvictions(tabs, "scenes", 2)).toEqual(["cams"]);
    expect(pickEvictions(tabs, "cams", 1)).toEqual(["weather", "scenes"]);
  });

  it("radio dang phat nen khong bi don; radio da dung thi don binh thuong", () => {
    const playing = [tab("radio", { backgroundAudio: true, mediaKnown: true, mediaPlaying: true, lastUsed: 1 }),
                     tab("cams", { lastUsed: 2 }), tab("scenes", { lastUsed: 3 })];
    expect(pickEvictions(playing, "scenes", 2)).toEqual(["cams"]);
    const stopped = [tab("radio", { backgroundAudio: true, mediaKnown: true, mediaPlaying: false, lastUsed: 1 }),
                     tab("cams", { lastUsed: 2 }), tab("scenes", { lastUsed: 3 })];
    expect(pickEvictions(stopped, "scenes", 2)).toEqual(["radio"]);
  });

  it("radio chua bao trang thai phat lan nao -> than trong, coi nhu dang phat", () => {
    const tabs = [tab("music", { backgroundAudio: true, lastUsed: 1 }), tab("cams", { lastUsed: 2 }), tab("x", { lastUsed: 3 })];
    expect(pickEvictions(tabs, "x", 2)).toEqual(["cams"]);
  });

  it("het ung vien thi tam vuot han muc, khong don gi", () => {
    const tabs = [tab("radio", { backgroundAudio: true, mediaKnown: true, mediaPlaying: true }), tab("cams")];
    expect(pickEvictions(tabs, "cams", 1)).toEqual([]);
  });
});

describe("the Dang phat", () => {
  it("chi liet ke tab NEN duoc phep phat nen va dang phat that", () => {
    const tabs = [
      tab("radio", { label: "Radio", backgroundAudio: true, mediaKnown: true, mediaPlaying: true }),
      tab("music", { label: "Nhạc", backgroundAudio: true, mediaKnown: true, mediaPlaying: false }),
      tab("youtube", { mediaKnown: true, mediaPlaying: true }),
      tab("home", { pinned: true }),
    ];
    expect(nowPlaying(tabs, "home")).toEqual([{ k: "radio", l: "Radio" }]);
    expect(nowPlaying(tabs, "radio")).toEqual([]);
  });
});

describe("SerialQueue", () => {
  it("tac vu sau chi bat dau khi tac vu truoc xong (chong tao trung tab)", async () => {
    const q = new SerialQueue();
    const created = new Set<string>();
    const log: string[] = [];
    const openApp = (key: string) => q.run(async () => {
      if (created.has(key)) { log.push(`activate ${key}`); return; }
      await new Promise((r) => setTimeout(r, 5));  // Target.createTarget ... nhieu buoc await
      created.add(key); log.push(`create ${key}`);
    });
    await Promise.all([openApp("cams"), openApp("cams"), openApp("cams")]);
    expect(log).toEqual(["create cams", "activate cams", "activate cams"]);
  });

  it("mot tac vu loi khong chan cac tac vu sau", async () => {
    const q = new SerialQueue();
    await expect(q.run(async () => { throw new Error("x"); })).rejects.toThrow("x");
    await expect(q.run(async () => 42)).resolves.toBe(42);
  });
});

describe("man hinh Gan day", () => {
  it("moi dung gan nhat truoc, bo man hinh chinh, danh dau ghim/active", () => {
    const tabs = [
      { key: "home", label: "Home Assistant", pinned: true, lastUsed: 5 },
      { key: "__system", label: "Màn hình chính", pinned: true, lastUsed: 9 },
      { key: "radio", label: "Radio", pinned: false, lastUsed: 7, thumb: "data:image/jpeg;base64,AA" },
      { key: "cams", label: "Camera", pinned: false, lastUsed: 1 },
    ];
    expect(recentsList(tabs, "radio")).toEqual([
      { k: "radio", l: "Radio", t: "data:image/jpeg;base64,AA", p: false, a: true },
      { k: "home", l: "Home Assistant", t: null, p: true, a: false },
      { k: "cams", l: "Camera", t: null, p: false, a: false },
    ]);
  });
});
