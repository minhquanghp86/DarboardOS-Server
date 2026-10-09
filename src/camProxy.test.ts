import { describe, expect, it } from "vitest";
import { noteCameraHost } from "./camProxy.js";

describe("(09/10/2026) nha nhieu man co camera: ?rwvdev chon dung man", () => {
  it("co rwvdev -> camera cua man do, bo tham so truoc khi gui firmware; khong co -> man dau tien", async () => {
    const { pickCamHost } = await import("./camProxy.js");
    noteCameraHost("esp32-aaaaaaaaaaaa", "::ffff:192.168.1.11", 8082);
    noteCameraHost("esp32-bbbbbbbbbbbb", "192.168.1.12", 8082);
    expect(pickCamHost("?n=x&rwvdev=esp32-bbbbbbbbbbbb")).toMatchObject({ id: "esp32-bbbbbbbbbbbb", search: "?n=x", h: { ip: "192.168.1.12" } });
    expect(pickCamHost("?rwvdev=esp32-bbbbbbbbbbbb").search).toBe("");
    expect(pickCamHost("?p=%2FDCIM%2Fa.jpg").search).toBe("?p=%2FDCIM%2Fa.jpg");   // khong co rwvdev: giu nguyen
  });
});
