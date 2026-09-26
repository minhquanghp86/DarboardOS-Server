import { describe, expect, it } from "vitest";
import { DIAL_ST, appXml, deviceXml, dialUuid, launchUrl, parseMSearch, ssdpResponse } from "./dial.js";

describe("DIAL (truyen YouTube tu dien thoai)", () => {
  it("nhan M-SEARCH tim DIAL / ssdp:all, bo qua loai khac", () => {
    const m = (st: string) => `M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ${st}\r\n\r\n`;
    expect(parseMSearch(m(DIAL_ST))).toEqual({ st: DIAL_ST, mx: 2 });
    expect(parseMSearch(m("ssdp:all"))).toMatchObject({ st: "ssdp:all" });
    expect(parseMSearch(m("urn:schemas-upnp-org:device:MediaRenderer:1"))).toBeNull();
    expect(parseMSearch("NOTIFY * HTTP/1.1\r\n\r\n")).toBeNull();
  });
  it("uuid on dinh, tra loi SSDP + mo ta thiet bi + trang thai ung dung", () => {
    expect(dialUuid("esp32-a")).toBe(dialUuid("esp32-a"));
    expect(dialUuid("esp32-a")).not.toBe(dialUuid("esp32-b"));
    expect(dialUuid("x")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    const r = ssdpResponse("http://192.168.1.5:56790/dial/p/dd.xml", "u-1");
    expect(r).toContain("LOCATION: http://192.168.1.5:56790/dial/p/dd.xml\r\n");
    expect(r).toContain(`USN: uuid:u-1::${DIAL_ST}`);
    expect(deviceXml("Phòng <khách>", "u-1")).toContain("<friendlyName>Phòng &lt;khách&gt;</friendlyName>");
    expect(appXml(false)).toContain("<state>stopped</state>");
    expect(appXml(true)).toContain('<link rel="run" href="run"/>');
  });
  it("URL mo tren panel: chi tham so an toan tu dien thoai", () => {
    expect(launchUrl("https://www.youtube.com/tv", "pairingCode=abc-123&theme=cl&v=dQw4w9WgXcQ"))
      .toBe("https://www.youtube.com/tv?pairingCode=abc-123&theme=cl&v=dQw4w9WgXcQ");
    expect(launchUrl("https://www.youtube.com/tv", "evil=%3Cscript%3E&x=javascript:alert(1)&ok=1")).toBe("https://www.youtube.com/tv?ok=1");
    expect(launchUrl("https://www.youtube.com/tv", "")).toBe("https://www.youtube.com/tv");
  });
});
