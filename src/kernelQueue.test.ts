import { describe, expect, it } from "vitest";
import { parseProcNetTcp } from "./kernelQueue.js";

// Dong that doc tren HASS 07/10/2026 (P4 192.168.1.179, S3 192.168.1.163, cong WS 8081 = 0x1F91).
const TCP6 = `  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   6: 00000000000000000000000000000000:1F91 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 47351398 1 000000007e57ceb6 100 0 0 10 0
  20: 0000000000000000FFFF0000020AA8C0:1F91 0000000000000000FFFF0000B30AA8C0:C153 01 00000A0C:00000000 01:00000014 00000000     0        0 64588343 2 00000000a044aa31 24 4 29 30 30
  24: 0000000000000000FFFF0000020AA8C0:1F91 0000000000000000FFFF0000A30AA8C0:E20E 01 00000000:00000000 00:00000000 00000000     0        0 64608501 1 0000000096606130 21 4 28 24 16
`;
const TCP4 = `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 0200A8C0:1F91 B30AA8C0:D001 01 0005B4A0:00000000 01:00000014 00000000     0        0 1 1 0 20 4 30 10 -1
   1: 0200A8C0:1F91 B30AA8C0:D002 06 00001000:00000000 00:00000000 00000000     0        0 0 3 0
`;

describe("parseProcNetTcp", () => {
  it("doc tx_queue cua socket IPv4-mapped trong tcp6, bo socket LISTEN", () => {
    const m = parseProcNetTcp(TCP6);
    expect(m.get("8081|192.168.1.179:49491")).toBe(0xa0c);
    expect(m.get("8081|192.168.1.163:57870")).toBe(0);
    expect(m.size).toBe(2);
  });
  it("doc /proc/net/tcp (IPv4), chi lay ESTABLISHED", () => {
    const m = parseProcNetTcp(TCP4);
    expect(m.get("8081|192.168.1.179:53249")).toBe(0x5b4a0);
    expect(m.has("8081|192.168.1.179:53250")).toBe(false);  // TIME_WAIT (06)
  });
  it("chiu duoc dau vao rong / hong", () => {
    expect(parseProcNetTcp("").size).toBe(0);
    expect(parseProcNetTcp("header\nrac\n  1: xx").size).toBe(0);
  });
});
