import json
import os
import sys
import time
import urllib.request

DEV = os.environ.get("DEV", "esp32-1cdbd49b2260")
SRV = os.environ.get("SRV", "http://192.168.10.2:18080")
DUR = int(os.environ.get("DUR", "180"))
LABEL = os.environ.get("LABEL", "")
TOK = os.environ.get("SUPERVISOR_TOKEN", "")
GO_HOME = os.environ.get("GO_HOME", "1") == "1"


def post(url, body):
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers={"content-type": "application/json"}, method="POST")
    try:
        return json.load(urllib.request.urlopen(req, timeout=20))
    except Exception as e:
        return {"ok": False, "error": str(e)}


def dev():
    d = json.load(urllib.request.urlopen(SRV + "/metrics", timeout=10))
    return [x for x in d["devices"] if x["id"] == DEV][0]


def fps_over(n):
    a = dev()
    time.sleep(n)
    b = dev()
    return (b.get("framesSent", 0) - a.get("framesSent", 0)) / float(n)


print("=== DO %s ===" % (LABEL or DEV))
pre = fps_over(6)
print("kiem tra khung: %.1f fps" % pre)
if pre < 2.0:
    print("PANEL KHONG PHAT VIDEO (fps < 2) -> dung, khong lay so.")
    sys.exit(2)

rows = []
t0 = time.time()
prev = dev()
prev_t = t0
while time.time() - t0 < DUR:
    time.sleep(10)
    cur = dev()
    now = time.time()
    dt = now - prev_t
    rows.append({"t": round(now - t0),
                 "fps": round((cur.get("framesSent", 0) - prev.get("framesSent", 0)) / dt, 1),
                 "q": cur.get("appliedQuality"), "iv": cur.get("appliedMinFrameIntervalMs"),
                 "dec": cur.get("recentMedianDecodeMs"), "fb": cur.get("recentFrameBytes"),
                 "heap": cur.get("deviceHeapFree")})
    prev, prev_t = cur, now

for r in rows:
    print("%3ds fps=%5.1f q=%s iv=%s dec=%s fb=%s heap=%s" % (
        r["t"], r["fps"], r["q"], r["iv"], r["dec"], r["fb"], r["heap"]))

if GO_HOME:
    print("tra ve home:", post(SRV + "/screens/act", {"id": DEV, "act": "app", "app": "home"}))

n = len(rows)
print("\n=== TONG KET %ds ===" % (n * 10))
print("fps : avg %.1f  min %.1f  max %.1f" % (sum(r["fps"] for r in rows) / n,
                                              min(r["fps"] for r in rows), max(r["fps"] for r in rows)))
print("q   : %s" % sorted({r["q"] for r in rows}))
print("iv  : %s" % sorted({r["iv"] for r in rows}))
print("dec : avg %.1f  max %.1f" % (sum((r["dec"] or 0) for r in rows) / n, max((r["dec"] or 0) for r in rows)))
print("fb  : avg %.1f KB" % (sum((r["fb"] or 0) for r in rows) / n / 1024))
print("heap: min %s" % min([r["heap"] for r in rows if r["heap"]] or [None]))
