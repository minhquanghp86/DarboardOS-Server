// (07/10/2026) Hang doi gui cua KERNEL cho tung socket thiet bi (cot Send-Q cua `ss` = tx_queue trong /proc/net/tcp6).
// Do that khi P4 phat YouTube: trung vi 21 KB, p90 143 KB, max 374 KB — nam TRUOC moi goi am thanh nhung
// ws.bufferedAmount khong thay (chi la phan Node con giu), nen bo khung / gian nhip phan ung qua muon va tieng bi dut
// 0,4–0,9 s. Addon chay host_network nen /proc/net/tcp6 trong container la bang socket cua may chu.
import fs from "node:fs";

const ESTABLISHED = "01";
const CACHE_MS = 150;

/** "B30AA8C0" (IPv4, tung byte dao nguoc) hoac 32 ky tu hex IPv6 (4 tu 32 bit dao byte) -> dia chi dang Node bao. */
function hexToIp(hex: string): string | null {
  const v4 = (w: string) => [6, 4, 2, 0].map((i) => parseInt(w.slice(i, i + 2), 16)).join(".");
  if (hex.length === 8) return v4(hex);
  if (hex.length !== 32) return null;
  const w = [0, 8, 16, 24].map((i) => hex.slice(i, i + 8).toUpperCase());
  if (w[0] === "00000000" && w[1] === "00000000" && w[2] === "FFFF0000") return v4(w[3]);  // ::ffff:a.b.c.d
  const bytes: string[] = [];
  for (const x of w) for (const i of [6, 4, 2, 0]) bytes.push(x.slice(i, i + 2));
  const groups: string[] = [];
  for (let i = 0; i < 16; i += 2) groups.push(String(parseInt(bytes[i] + bytes[i + 1], 16).toString(16)));
  return groups.join(":");
}

/** Noi dung /proc/net/tcp hoac tcp6 -> Map "congCucBo|ipXa:congXa" -> tx_queue (byte), chi socket ESTABLISHED. */
export function parseProcNetTcp(text: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of text.split("\n").slice(1)) {
    const f = line.trim().split(/\s+/);
    if (f.length < 5 || f[3] !== ESTABLISHED) continue;
    const [lHex, lPortHex] = f[1].split(":");
    const [rHex, rPortHex] = f[2].split(":");
    const ip = hexToIp(rHex);
    if (!lHex || !ip || !lPortHex || !rPortHex) continue;
    out.set(`${parseInt(lPortHex, 16)}|${ip}:${parseInt(rPortHex, 16)}`, parseInt(f[4].split(":")[0], 16) || 0);
  }
  return out;
}

let cache: { at: number; map: Map<string, number> } | null = null;

/** Byte kernel con giu (chua duoc dau kia xac nhan) cua socket TCP; 0 neu khong doc duoc / khong thay. */
export function kernelTxQueue(remoteAddress: string | undefined, remotePort: number | undefined,
                              localPort: number | undefined, now = Date.now()): number {
  if (!remoteAddress || !remotePort || !localPort) return 0;
  if (!cache || now - cache.at > CACHE_MS) {
    const map = new Map<string, number>();
    for (const f of ["/proc/net/tcp6", "/proc/net/tcp"]) {
      try {
        for (const [k, v] of parseProcNetTcp(fs.readFileSync(f, "utf8"))) map.set(k, v);
      } catch { /* khong co file (khong phai Linux / khong host_network): coi nhu 0 */ }
    }
    cache = { at: now, map };
  }
  const ip = remoteAddress.startsWith("::ffff:") ? remoteAddress.slice(7) : remoteAddress;
  return cache.map.get(`${localPort}|${ip}:${remotePort}`) ?? 0;
}
