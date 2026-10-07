import { describe, expect, it } from "vitest";
import { kindFromUrl, parseClearKey, parseM3u, rewritePlaylist, sniffKind, validateLists } from "./iptv.js";

// Trich danh sach that iptv-org (vn.m3u, 07/10/2026) + cac kieu hay gap o danh sach tu dung / Kodi / Xtream.
const M3U = `﻿#EXTM3U url-tvg="https://epg.example/vn.xml"
#EXTINF:-1 tvg-id="AnGiangTV1.vn@SD" tvg-logo="https://i.imgur.com/mgp6RAU.png" group-title="General",An Giang TV 1 (1080p) [Geo-blocked]
https://tv.angiangtv.vn/live/kgtv/kgtv.m3u8
#EXTINF:-1 tvg-id="X" group-title="General;News",Kênh A, có dấu phẩy
#EXTVLCOPT:http-user-agent=Mozilla/5.0 (Test)
#EXTVLCOPT:http-referrer=https://ref.example/
https://a.example/live/index.m3u8?token=1
#EXTINF:-1 group-title="Undefined",Kênh B
#EXTHTTP:{"User-Agent":"UA-B","cookie":"c=1"}
http://b.example:8080/user/pass/12345
#EXTINF:-1 tvg-logo="logo.png" group-title="Phim, Truyện",Kênh C
https://c.example/c.ts|User-Agent=Kodi%2F20&Referer=https://c.example/
#EXTINF:-1,Kênh DRM
#KODIPROP:inputstream.adaptive.license_type=com.widevine.alpha
#KODIPROP:inputstream.adaptive.manifest_type=mpd
https://d.example/manifest
#EXTINF:-1,Kênh UDP
udp://@239.1.1.1:1234
#EXTINF:-1 group-title=Radio" tvg-logo="https://x.example/l.png", Radio Nhạc Vàng
https://r.example/nv.m3u8
#EXTINF:-1,Trùng
https://tv.angiangtv.vn/live/kgtv/kgtv.m3u8
https://e.example/hls/vtv1/playlist.m3u8
`;

describe("parseM3u", () => {
  const r = parseM3u(M3U, "l1");
  const by = (n: string) => r.channels.find((c) => c.name === n)!;

  it("doc ten, logo, nhom, EPG; bo nhan iptv-org; ma kenh on dinh", () => {
    expect(r.epg).toBe("https://epg.example/vn.xml");
    const a = by("An Giang TV 1 (1080p)");
    expect(a.logo).toBe("https://i.imgur.com/mgp6RAU.png");
    expect(a.groups).toEqual(["General"]);
    expect(a.kind).toBe("hls");
    expect(a.id).toBe(parseM3u(M3U, "l1").channels[0].id);
    expect(parseM3u(M3U, "l2").channels[0].id).not.toBe(a.id);
  });
  it("ten co dau phay, nhieu nhom (;), EXTVLCOPT", () => {
    const c = by("Kênh A, có dấu phẩy");
    expect(c.groups).toEqual(["General", "News"]);
    expect(c.headers).toEqual({ "User-Agent": "Mozilla/5.0 (Test)", Referer: "https://ref.example/" });
  });
  it("EXTHTTP, nhom Undefined -> Khác, URL khong phan mo rong -> auto", () => {
    const b = by("Kênh B");
    expect(b.groups).toEqual(["Khác"]);
    expect(b.headers).toEqual({ "User-Agent": "UA-B", Cookie: "c=1" });
    expect(b.kind).toBe("auto");
  });
  it("hau to |header kieu Kodi, nhom co dau phay, logo tuong doi bi bo", () => {
    const c = by("Kênh C");
    expect(c.url).toBe("https://c.example/c.ts");
    expect(c.headers).toEqual({ "User-Agent": "Kodi/20", Referer: "https://c.example/" });
    expect(c.groups).toEqual(["Phim, Truyện"]);
    expect(c.logo).toBeUndefined();
    expect(c.kind).toBe("ts");
  });
  it("KODIPROP: DRM + DASH; header cua kenh truoc khong lan sang", () => {
    const d = by("Kênh DRM");
    expect(d.drm).toBe(true);
    expect(d.kind).toBe("dash");
    expect(d.headers).toBeUndefined();
  });
  it("bo udp://, bo URL trung; URL khong co #EXTINF lay ten tu duong dan", () => {
    expect(r.skipped).toBe(1);
    expect(r.channels.some((c) => c.name === "Trùng")).toBe(false);
    expect(by("playlist.m3u8").groups).toEqual(["Khác"]);
    expect(r.channels).toHaveLength(7);
  });
  it("ngoac le trong #EXTINF (danh sach that 07/10): van lay dung ten, nhom, logo", () => {
    const c = by("Radio Nhạc Vàng");
    expect(c.groups).toEqual(["Radio"]);
    expect(c.logo).toBe("https://x.example/l.png");
  });
});

describe("ClearKey (KODIPROP — danh sach VN 07/10: TV360 / VTVPrime / FPT)", () => {
  const K1 = "47404f0123456789abcdef0123456789", V1 = "9fbd0123456789abcdef0123456789ab";
  it("kid:key hex (ca nhieu cap), JWK base64url, {kid:key}, URL may chu khoa", () => {
    expect(parseClearKey(`${K1}:${V1}`)).toEqual({ keys: { [K1]: V1 } });
    expect(parseClearKey(`${K1}:${V1},${V1}:${K1}`)!.keys).toEqual({ [K1]: V1, [V1]: K1 });
    const b64 = (h: string) => Buffer.from(h, "hex").toString("base64url");
    expect(parseClearKey(JSON.stringify({ keys: [{ kty: "oct", kid: b64(K1), k: b64(V1) }], type: "temporary" }))).toEqual({ keys: { [K1]: V1 } });
    expect(parseClearKey(JSON.stringify({ [K1]: V1 }))).toEqual({ keys: { [K1]: V1 } });
    expect(parseClearKey("https://lic.example/ck?id=1")).toEqual({ url: "https://lic.example/ck?id=1" });
    expect(parseClearKey("rac")).toBeNull();
  });
  it("parseM3u: clearkey -> ck (khong phai drm), drm_legacy, .drm JSON, clearkey thieu khoa -> drm", () => {
    const r = parseM3u(`#EXTM3U
#EXTINF:-1 group-title="Sự Kiện TV360",TV360+1
#EXTVLCOPT:http-user-agent=Dalvik/2.1.0
#KODIPROP:inputstream.adaptive.manifest_type=mpd
#KODIPROP:inputstream.adaptive.license_type=clearkey
#KODIPROP:inputstream.adaptive.license_key=${K1}:${V1}
https://vmttv.example/tv360/?id=tv360-1
#EXTINF:-1,Moi
#KODIPROP:inputstream.adaptive.drm_legacy=org.w3.clearkey|${K1}:${V1}
https://x.example/a.mpd
#EXTINF:-1,JSON
#KODIPROP:inputstream.adaptive.drm={"org.w3.clearkey":{"license":{"keyids":{"${K1}":"${V1}"}}}}
https://x.example/b.mpd
#EXTINF:-1,Thieu khoa
#KODIPROP:inputstream.adaptive.license_type=clearkey
https://x.example/c.mpd
`, "l");
    const [a, b, c, d] = r.channels;
    expect(a.kind).toBe("dash");
    expect(a.ck).toEqual({ keys: { [K1]: V1 } });
    expect(a.drm).toBeUndefined();
    expect(a.headers).toEqual({ "User-Agent": "Dalvik/2.1.0" });
    expect(b.ck).toEqual({ keys: { [K1]: V1 } });
    expect(c.ck).toEqual({ keys: { [K1]: V1 } });
    expect(d.drm).toBe(true);
    expect(d.ck).toBeUndefined();
  });
});

describe("kindFromUrl", () => {
  it("theo phan mo rong, bo query", () => {
    expect(kindFromUrl("https://x/a/index.m3u8?t=1")).toBe("hls");
    expect(kindFromUrl("http://x/a.M3U")).toBe("hls");
    expect(kindFromUrl("http://x/udp/239.0.0.1:1234")).toBe("ts");
    expect(kindFromUrl("http://x/v.mp4")).toBe("mp4");
    expect(kindFromUrl("http://x/live/u/p/123")).toBe("auto");
    expect(kindFromUrl("khong-phai-url")).toBe("auto");
  });
});

describe("rewritePlaylist", () => {
  const mk = (abs: string) => `/iptv/p?u=${encodeURIComponent(abs)}`;
  it("master: bien the tuong doi + URI cua EXT-X-MEDIA tinh tu dia chi cuoi", () => {
    const out = rewritePlaylist(
      '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",URI="audio/a.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=1\nhd/index.m3u8\n',
      "https://cdn.example/live/ch1/master.m3u8?tk=9", mk).split("\n");
    expect(out[1]).toBe(`#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",URI="${mk("https://cdn.example/live/ch1/audio/a.m3u8")}"`);
    expect(out[3]).toBe(mk("https://cdn.example/live/ch1/hd/index.m3u8"));
  });
  it("media: doan tuyet doi, khoa AES, MAP; data: giu nguyen; dong trong giu nguyen", () => {
    const out = rewritePlaylist(
      '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="/keys/k1"\n#EXT-X-MAP:URI="data:abc"\n#EXTINF:6,\nhttp://seg.example/s1.ts\n\n',
      "https://cdn.example/live/x.m3u8", mk).split("\n");
    expect(out[1]).toBe(`#EXT-X-KEY:METHOD=AES-128,URI="${mk("https://cdn.example/keys/k1")}"`);
    expect(out[2]).toBe('#EXT-X-MAP:URI="data:abc"');
    expect(out[4]).toBe(mk("http://seg.example/s1.ts"));
    expect(out[5]).toBe("");
  });
});

describe("sniffKind", () => {
  it("HLS / DASH theo noi dung (ke ca BOM) hoac content-type", () => {
    expect(sniffKind("text/plain", Buffer.from("﻿#EXTM3U\n#EXT-X-VERSION:3"))).toBe("hls");
    expect(sniffKind("application/vnd.apple.mpegurl", Buffer.from("x"))).toBe("hls");
    expect(sniffKind("application/xml", Buffer.from('<?xml version="1.0"?><MPD xmlns="x">'))).toBe("dash");
  });
  it("MPEG-TS qua byte dong bo (ke ca lech goi), FLV, MP4", () => {
    const ts = Buffer.alloc(188 * 4, 0xff);
    for (let i = 5; i < ts.length; i += 188) ts[i] = 0x47;
    expect(sniffKind("application/octet-stream", ts)).toBe("ts");
    expect(sniffKind("", Buffer.from("FLV\x01\x05"))).toBe("flv");
    expect(sniffKind("", Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from("ftypisom")]))).toBe("mp4");
    expect(sniffKind("text/html", Buffer.from("<html>"))).toBe("?");
  });
});

describe("validateLists", () => {
  it("chuan hoa ten / id, nhan duong dan /media /config, tu choi dia chi la", () => {
    const v = validateLists([
      { name: " VN ", url: "https://x.example/vn.m3u", on: true, id: "a" },
      { url: "/media/iptv/list.m3u", id: "a" },
    ]);
    expect(v[0]).toEqual({ id: "a", name: "VN", url: "https://x.example/vn.m3u", on: true });
    expect(v[1].id).not.toBe("a");
    expect(v[1].name).toBe("list");
    expect(() => validateLists([{ url: "ftp://x" }])).toThrow(/http/);
    expect(() => validateLists([{ url: "/etc/passwd" }])).toThrow();
    expect(() => validateLists([{ url: "/media/../etc/passwd" }])).toThrow();
    const sd = validateLists([{ url: "sd:/iptv/K%C3%AAnh%20nha.m3u8" }, { url: "sd:/IPTV/vtv.m3u" }]);
    expect(sd[0].name).toBe("Kênh nha");
    expect(sd[1].name).toBe("vtv");
    expect(() => validateLists([{ url: "sd:/../x.m3u" }])).toThrow();
    expect(() => validateLists([{ url: "sd:/" }])).toThrow();
  });
});
