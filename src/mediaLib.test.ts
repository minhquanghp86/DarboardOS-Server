import { describe, expect, it } from "vitest";
import { castType, kindOf, sourceOf, toFolder, toPlayers } from "./mediaLib.js";

describe("mediaLib (14/10/2026: ung dung Media)", () => {
  it("goc: an nguon da co ung dung rieng, ten tieng Viet; all=1 hien het", () => {
    const root = { children: [
      { title: "Camera", media_content_id: "media-source://camera", can_expand: true },
      { title: "My media", media_content_id: "media-source://media_source", can_expand: true },
      { title: "Radio Browser", media_content_id: "media-source://radio_browser", can_expand: true },
      { title: "DLNA", media_content_id: "media-source://dlna_dms/nas", can_expand: true },
    ] };
    expect(toFolder(root, true, false).items.map(i => i.t)).toEqual(["Máy chủ DLNA", "Thư mục media"]);
    expect(toFolder(root, true, true).items).toHaveLength(4);
    expect(sourceOf("media-source://media_source/local/audio")).toBe("media_source");
  });
  it("loai muc + sap xep thu muc truoc, so tu nhien", () => {
    const f = toFolder({ title: "audio", media_content_id: "media-source://media_source/local/audio", children: [
      { title: "Bai 10.mp3", media_content_id: "a10", media_class: "music", media_content_type: "audio/mpeg", can_play: true },
      { title: "Bai 2.mp3", media_content_id: "a2", media_class: "music", media_content_type: "audio/mpeg", can_play: true },
      { title: "phim.mp4", media_content_id: "v", media_class: "video", media_content_type: "video/mp4", can_play: true },
      { title: "Album", media_content_id: "d", media_class: "directory", can_expand: true },
    ] }, false, false);
    expect(f.items.map(i => `${i.k}:${i.t}`)).toEqual(["dir:Album", "aud:Bai 2.mp3", "aud:Bai 10.mp3", "vid:phim.mp4"]);
    expect(kindOf({ media_class: "image", media_content_type: "image/jpeg", can_play: true })).toBe("img");
    expect(castType("video/mp4")).toBe("video");
    expect(castType("audio/x-wav")).toBe("music");
  });
  it("loa: bo unavailable va loa khong phat duoc media, am luong %", () => {
    const p = toPlayers([
      { entity_id: "media_player.tv", state: "idle", attributes: { friendly_name: "TV", supported_features: 512 | 4, volume_level: 0.3 } },
      { entity_id: "media_player.cu", state: "unavailable", attributes: { supported_features: 512 } },
      { entity_id: "media_player.chi_dieu_khien", state: "on", attributes: { supported_features: 1 } },
      { entity_id: "light.x", state: "on", attributes: {} },
    ]);
    expect(p).toEqual([{ id: "media_player.tv", name: "TV", state: "idle", vol: 30, title: "", canVol: true }]);
  });
});
