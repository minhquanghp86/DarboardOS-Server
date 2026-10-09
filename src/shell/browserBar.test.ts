import { describe, expect, it } from "vitest";
import { shortUrl, toBrowserUrl } from "./browserBar.js";

describe("(09/10/2026) o dia chi Chrome", () => {
  it("dia chi / tu khoa -> URL", () => {
    expect(toBrowserUrl("vnexpress.net")).toBe("https://vnexpress.net");
    expect(toBrowserUrl("https://a.b/c?d=1")).toBe("https://a.b/c?d=1");
    expect(toBrowserUrl("thời tiết hà nội")).toBe("https://www.google.com/search?q=" + encodeURIComponent("thời tiết hà nội"));
    expect(toBrowserUrl("homeassistant")).toBe("https://www.google.com/search?q=homeassistant");
    expect(toBrowserUrl("192.168.1.5:8123/lovelace")).toBe("http://192.168.1.5:8123/lovelace");
    expect(toBrowserUrl("javascript:alert(1)")).toBe("");
    expect(toBrowserUrl("   ")).toBe("");
  });
  it("chu hien: bo https:// va www., giu duong dan", () => {
    expect(shortUrl("https://www.google.com/")).toBe("google.com");
    expect(shortUrl("https://vnexpress.net/the-thao?a=1")).toBe("vnexpress.net/the-thao?a=1");
  });
});
