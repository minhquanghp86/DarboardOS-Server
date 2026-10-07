import { describe, expect, it } from "vitest";
import { classifyLockGesture } from "./lockGesture.js";

const P4 = { w: 1024, h: 600, photo: false };
const g = (sx: number, sy: number, ex: number, ey: number, ms = 300, o = P4) => classifyLockGesture({ sx, sy, ex, ey, ms, ...o });

describe("cu chi man hinh khoa", () => {
  it("vuot len tu nua duoi du dai -> mo khoa (P4 va S3 480x480)", () => {
    expect(g(512, 560, 520, 380)).toBe("unlock");
    expect(g(240, 450, 236, 330, 400, { w: 480, h: 480, photo: false })).toBe("unlock");
  });
  it("vuot ngan / bat dau o mep tren / cheo / qua cham -> khong mo", () => {
    expect(g(512, 560, 512, 500)).toBe("none");
    expect(g(512, 150, 512, 10)).toBe("none");
    expect(g(300, 560, 520, 380)).toBe("none");
    expect(g(512, 560, 512, 300, 4000)).toBe("none");
  });
  it("cham -> tap; vuot ngang khi co anh -> doi anh, khong co anh -> none", () => {
    expect(g(500, 300, 505, 304)).toBe("tap");
    expect(g(700, 300, 400, 320, 300, { ...P4, photo: true })).toBe("next");
    expect(g(300, 300, 600, 290, 300, { ...P4, photo: true })).toBe("prev");
    expect(g(700, 300, 400, 320)).toBe("none");
  });
});
