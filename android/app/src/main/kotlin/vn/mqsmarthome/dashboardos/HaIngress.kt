package vn.mqsmarthome.dashboardos

/**
 * (20/11/2026) GD12 — TỰ TẠO PHIÊN INGRESS **BÊN TRONG WEBVIEW**, ĐÚNG LUỒNG CỦA CHÍNH HA FRONTEND.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────────────
 * BẰNG CHỨNG (đã kiểm chứng trên máy này, không phải suy đoán):
 *
 *  1. Bản GD10 gọi native `HttpURLConnection` tới `POST /api/hassio/ingress/session[/<slug>]`. Endpoint đó
 *     **không tồn tại** như một API HTTP: HA core chỉ chuyển tiếp một danh sách đường dẫn ĐÓNG
 *     (`homeassistant/components/hassio/http.py` → `PATHS_ADMIN` / `PATHS_NO_AUTH`), và `ingress/session`
 *     KHÔNG nằm trong danh sách nào. Chạy thật:
 *
 *         $ curl -X POST -H 'content-type: application/json' -d '{}' \
 *             https://hass.mqsmarthome.io.vn/api/hassio/ingress/session/self_dashboard
 *         401
 *         $ curl -X POST ... /api/hassio/ingress/session
 *         401
 *
 *  2. HA frontend **không** dùng HTTP. Nó dùng **WebSocket command** rồi tự đặt cookie. Trích từ chính bundle
 *     đang chạy trên `hass.mqsmarthome.io.vn` (`/frontend_latest/22070.<hash>.js`, tải về bằng curl):
 *
 *         q: async e => {
 *              const t = await e.callWS({ type: "supervisor/api", endpoint: "/ingress/session", method: "post" });
 *              return s = t.session,
 *                     document.cookie = `ingress_session=${s};path=/api/hassio_ingress/;SameSite=Strict`
 *                                       + ("https:" === location.protocol ? ";Secure" : ""), s
 *            }
 *
 *     (bản `dev` mới hơn của frontend dùng `hass.callWS({type:"supervisor/ingress/session", slug})` +
 *     `setIngressCookie` — cùng một cơ chế, khác tên command; xem `src/data/hassio/ingress.ts`).
 *
 *  3. Phía core: `homeassistant/components/hassio/websocket_api.py` → `websocket_supervisor_api` chuyển tiếp
 *     `endpoint` xuống Supervisor và **tự chèn `session_data_user_id = connection.user.id`** khi
 *     `command == "/ingress/session"`; `websocket_ingress_session` là biến thể `supervisor/ingress/session`.
 *     Supervisor (`supervisor/api/ingress.py`) trả `{"session": "…"}` và chỉ chấp nhận `ingress_session`
 *     trong cookie ở `/api/hassio_ingress/<token>/…` (`handler` → `request.cookies[COOKIE_INGRESS]`).
 *
 * ⇒ Vì vậy app phải làm **đúng ba việc của frontend, và làm TRONG TRANG HA (cùng origin)**:
 *     a. lấy access token — hoặc dùng luôn `document.querySelector('home-assistant').hass.callWS` (nhanh nhất,
 *        frontend tự làm mới token), hoặc đọc `localStorage['hassTokens']` và làm mới bằng
 *        `POST /auth/token` (`grant_type=refresh_token` + `client_id`) khi đã hết hạn,
 *     b. mở `wss://<domain>/api/websocket`, `auth` bằng access token, gửi
 *        `{type:"supervisor/api", endpoint:"/ingress/session", method:"post"}` (dự phòng:
 *        `{type:"supervisor/ingress/session", slug}`) → nhận `{session}`,
 *     c. `document.cookie = "ingress_session=<session>;path=/api/hassio_ingress/;SameSite=Strict[;Secure]"`.
 *
 *     Làm trong trang HA là BẮT BUỘC: cookie do JS đặt nằm đúng domain/path và đi vào cookie store của WebView
 *     (cùng store với [HaCookie]), nên `GET …/launcher-config.html` mới trả 200; `HttpURLConnection` **không**
 *     chia sẻ cookie store với WebView nên cách cũ không thể hoạt động.
 *
 * Tệp này THUẦN (không API Android, không mở kết nối): chỉ dựng chuỗi JS, đọc kết quả bridge và định dạng log
 * → unit test trên JVM (`HaIngressTest`).
 */
object HaIngress {

    /** Tên đối tượng bridge `addJavascriptInterface` (JS gọi `window.DashboardOS.postResult(json)`). */
    const val BRIDGE = "DashboardOS"

    /** Phương thức bridge mà JS gọi khi xong một bước. */
    const val BRIDGE_METHOD = "postResult"

    /** Tên cookie phiên ingress của Supervisor (đúng như frontend đặt). */
    const val COOKIE_NAME = "ingress_session"

    /**
     * `Path` của cookie — **đúng như frontend đang chạy** (`path=/api/hassio_ingress/`), không phải `/`.
     * Nhờ vậy cookie không bị gửi kèm mọi request khác của HA, và vẫn khớp khi Supervisor kiểm tra phiên.
     */
    const val COOKIE_PATH = "/api/hassio_ingress/"

    /** Command WebSocket tổng hợp của core (chuyển tiếp `endpoint` xuống Supervisor). */
    const val WS_TYPE_PROXY = "supervisor/api"

    /** `endpoint` của command trên. */
    const val ENDPOINT_SESSION = "/ingress/session"

    /** Command riêng của bản frontend mới (`{type:"supervisor/ingress/session", slug}`). */
    const val WS_TYPE_SESSION = "supervisor/ingress/session"

    /** Giá trị cookie `ingress_session=<session>; Path=…[; Secure]` (dùng khi app phải ghi hộ bằng CookieManager). */
    fun cookieValue(session: String, secure: Boolean): String {
        val s = session.trim()
        return "$COOKIE_NAME=$s; Path=$COOKIE_PATH" + if (secure) "; Secure" else ""
    }

    /**
     * Đoạn JS chạy TRONG trang HA (đã đăng nhập) để tạo phiên ingress + đặt cookie, rồi báo kết quả về app qua
     * bridge [BRIDGE].[BRIDGE_METHOD].
     *
     * Kết quả (JSON) theo từng bước — mỗi bước một dòng:
     *  - `{"step":"token","ok":true|false,"detail":"hass|socket|no_tokens|…"}`,
     *  - `{"step":"session","ok":true,"session":"…","how":"hass|socket","cookie":true|false}`,
     *  - `{"step":"session","ok":false,"detail":"<lý do>"}`.
     *
     * [slug] chỉ dùng cho đường dự phòng `supervisor/ingress/session` (bản frontend mới).
     */
    fun sessionScript(slug: String = ServerResolver.ADDON_SLUG): String =
        SCRIPT.replace(SLUG_PLACEHOLDER, escapeJs(slug.trim()))

    /** Một kết quả bridge đã đọc. */
    data class Result(
        /** `token` / `session`. */
        val step: String,
        val ok: Boolean,
        /** Session token (chỉ có khi `step=session` và `ok=true`). */
        val session: String? = null,
        /** Đường đã dùng: `hass` (dùng `hass.callWS` của frontend) hay `socket` (WebSocket + access token). */
        val how: String? = null,
        /** `document.cookie` đọc lại thấy `ingress_session` (chỉ có ý nghĩa khi `ok=true`). */
        val cookie: Boolean = false,
        /** Lý do thất bại (`no_tokens`, `auth_invalid`, `ws_timeout`, `not_admin`…). */
        val detail: String? = null,
    ) {
        /** Đã tạo được phiên thật (bước `session`, `ok`, có session an toàn). */
        val sessionReady: Boolean get() = step == STEP_SESSION && ok && isSafeSession(session)
    }

    const val STEP_TOKEN = "token"
    const val STEP_SESSION = "session"
    const val STEP_NAV = "nav"

    /**
     * Đọc JSON do JS gửi về. Chỉ nhận đúng những trường mình phát ra (chuỗi + boolean), nên không cần
     * `org.json` (không có trên JVM test) và không bị ảnh hưởng bởi dữ liệu lạ.
     */
    fun parseResult(json: String?): Result? {
        val j = json?.trim().orEmpty()
        if (!j.startsWith("{")) return null
        val step = stringField(j, "step")?.lowercase() ?: return null
        if (step.isEmpty()) return null
        val ok = boolField(j, "ok")
        val session = stringField(j, "session")
        val how = stringField(j, "how")
        val detail = stringField(j, "detail")
        return Result(
            step = step,
            ok = ok,
            session = session?.trim()?.ifEmpty { null },
            how = how?.trim()?.ifEmpty { null },
            cookie = boolField(j, "cookie"),
            detail = detail?.trim()?.ifEmpty { null },
        )
    }

    /**
     * Session token của Supervisor là chuỗi an toàn (uuid/hex): chỉ chữ, số, `-`, `_`, `.`; không khoảng trắng,
     * không `;` (không thể phá cookie) và dài ≥ 8.
     */
    fun isSafeSession(session: String?): Boolean {
        val s = session?.trim().orEmpty()
        if (s.length < 8) return false
        return s.all { it.isLetterOrDigit() || it == '-' || it == '_' || it == '.' }
    }

    /**
     * Dòng log chuẩn mà app ghi ra Logcat (tag `DashboardOS-login`) cho từng bước của luồng:
     *
     *     [login] step=token result=ok how=hass
     *     [login] step=session result=ok how=socket cookie=yes
     *     [login] step=nav result=pending url=…/api/hassio_ingress/KJjH…/launcher-config.html
     */
    fun logLine(step: String, result: String, extra: String? = null): String {
        val sb = StringBuilder("[login] step=")
            .append(step.trim().ifEmpty { "-" })
            .append(" result=").append(result.trim().ifEmpty { "-" })
        val e = extra?.trim().orEmpty()
        if (e.isNotEmpty()) sb.append(' ').append(e)
        return sb.toString()
    }

    // ────────────────────────────────────────────────────────────── nội bộ: đọc JSON

    private fun boolField(json: String, name: String): Boolean =
        Regex("\"" + Regex.escape(name) + "\"\\s*:\\s*true", RegexOption.IGNORE_CASE).containsMatchIn(json)

    private fun stringField(json: String, name: String): String? =
        STRING_FIELD_RE(name).find(json)?.groupValues?.getOrNull(1)?.let { unescape(it) }

    private fun STRING_FIELD_RE(name: String) =
        Regex("\"" + Regex.escape(name) + "\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"")

    /** Bỏ escape cơ bản của JSON (`\"`, `\\`, `\/`, `\n`, `\t`, `\r`, `\uXXXX`). */
    private fun unescape(raw: String): String {
        if (!raw.contains('\\')) return raw
        val sb = StringBuilder(raw.length)
        var i = 0
        while (i < raw.length) {
            val c = raw[i]
            if (c != '\\' || i + 1 >= raw.length) {
                sb.append(c)
                i++
                continue
            }
            when (val n = raw[i + 1]) {
                'n' -> { sb.append('\n'); i += 2 }
                'r' -> { sb.append('\r'); i += 2 }
                't' -> { sb.append('\t'); i += 2 }
                'b' -> { sb.append('\b'); i += 2 }
                'f' -> { sb.append('\u000C'); i += 2 }
                'u' -> {
                    val hex = raw.substring(i + 2, minOf(i + 6, raw.length))
                    val code = hex.toIntOrNull(16)
                    if (code != null && hex.length == 4) {
                        sb.append(code.toChar())
                        i += 6
                    } else {
                        sb.append(n)
                        i += 2
                    }
                }

                else -> { sb.append(n); i += 2 }
            }
        }
        return sb.toString()
    }

    // ────────────────────────────────────────────────────────────── nội bộ: JS

    /** Chuỗi JS an toàn (dùng làm literal `"…"`). */
    private fun escapeJs(value: String): String {
        val sb = StringBuilder(value.length + 8)
        for (c in value) {
            when (c) {
                '\\' -> sb.append("\\\\")
                '"' -> sb.append("\\\"")
                '\n' -> sb.append("\\n")
                '\r' -> sb.append("\\r")
                '\t' -> sb.append("\\t")
                '<' -> sb.append("\\u003c")
                '>' -> sb.append("\\u003e")
                '&' -> sb.append("\\u0026")
                else -> if (c < ' ') sb.append("\\u%04x".format(c.code)) else sb.append(c)
            }
        }
        return sb.toString()
    }

    private const val SLUG_PLACEHOLDER = "__DASHBOARDOS_SLUG__"

    /**
     * Toàn bộ JS. Không dùng template literal (không có `$`) để nhúng thẳng vào Kotlin raw string.
     *
     * Trình tự:
     *  1. `viaHass()`  — `document.querySelector('home-assistant').hass.callWS(...)` (frontend đang chạy = nhanh
     *     nhất, không phải lo token/ làm mới token),
     *  2. `viaSocket()` — tự mở `/api/websocket`, `auth` bằng access token (đọc `localStorage.hassTokens`, làm mới
     *     bằng `/auth/token` nếu hết hạn), gửi lần lượt `supervisor/api` + `supervisor/ingress/session`,
     *  3. `storeCookie()` — `document.cookie` với `path=/api/hassio_ingress/` (+ `Secure` khi https),
     *  4. báo từng bước về app qua bridge.
     */
    private val SCRIPT: String = """
(function () {
  var SLUG = "__DASHBOARDOS_SLUG__";
  var B = window.DashboardOS;
  var dead = false;
  function report(o) {
    try { if (B && B.postResult) { B.postResult(JSON.stringify(o)); } } catch (e) {}
  }
  function finish(o) { if (dead) { return; } dead = true; report(o); }
  function secureSuffix() { return location.protocol === "https:" ? ";Secure" : ""; }
  function storeCookie(s) {
    var v = "ingress_session=" + s + ";path=/api/hassio_ingress/;SameSite=Strict" + secureSuffix();
    document.cookie = v;
    return document.cookie.indexOf("ingress_session=") >= 0;
  }
  function loadTokens() {
    try { return JSON.parse(window.localStorage.getItem("hassTokens") || "null"); } catch (e) { return null; }
  }
  function isExpired(t) {
    var e = Number((t && t.expires) || 0);
    return e > 0 && Date.now() > (e - 60000);
  }
  function refresh(t) {
    var body = new URLSearchParams();
    body.set("grant_type", "refresh_token");
    body.set("refresh_token", t.refresh_token);
    if (t.clientId) { body.set("client_id", t.clientId); }
    return fetch("/auth/token", { method: "POST", body: body, credentials: "same-origin" })
      .then(function (r) {
        if (!r.ok) { throw new Error("refresh_http_" + r.status); }
        return r.json();
      })
      .then(function (j) {
        if (!j || !j.access_token) { throw new Error("refresh_no_token"); }
        t.access_token = j.access_token;
        if (j.refresh_token) { t.refresh_token = j.refresh_token; }
        if (j.expires_in) { t.expires = Date.now() + Number(j.expires_in) * 1000; }
        try { window.localStorage.setItem("hassTokens", JSON.stringify(t)); } catch (e) {}
        return t.access_token;
      });
  }
  function token() {
    var t = loadTokens();
    if (!t || !t.access_token || !t.refresh_token) { return Promise.reject(new Error("no_tokens")); }
    if (isExpired(t)) { return refresh(t); }
    return Promise.resolve(t.access_token);
  }
  function sessionFrom(r) {
    if (!r) { return null; }
    if (typeof r === "string") { return r; }
    if (r.session) { return String(r.session); }
    return null;
  }
  function viaHass() {
    try {
      var el = document.querySelector("home-assistant");
      var hass = el && el.hass;
      if (!hass || typeof hass.callWS !== "function") { return null; }
      return hass.callWS({ type: "supervisor/api", endpoint: "/ingress/session", method: "post" });
    } catch (e) { return null; }
  }
  function commands() {
    var list = [{ id: 1, type: "supervisor/api", endpoint: "/ingress/session", method: "post" }];
    if (SLUG) { list.push({ id: 2, type: "supervisor/ingress/session", slug: SLUG }); }
    return list;
  }
  function viaSocket(tok) {
    return new Promise(function (resolve, reject) {
      var cmds = commands();
      var idx = 0;
      var current = null;
      var ws = null;
      var timer = null;
      var settled = false;
      function stop(err, val) {
        if (settled) { return; }
        settled = true;
        if (timer) { clearTimeout(timer); }
        try { if (ws) { ws.close(); } } catch (e) {}
        if (err) { reject(err); } else { resolve(val); }
      }
      function next() {
        if (idx >= cmds.length) { stop(new Error("no_ingress_endpoint")); return; }
        current = cmds[idx];
        idx += 1;
        try { ws.send(JSON.stringify(current)); } catch (e) { stop(new Error("ws_send_failed")); }
      }
      timer = setTimeout(function () { stop(new Error("ws_timeout")); }, 9000);
      try { ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/api/websocket"); }
      catch (e) { stop(new Error("ws_open_failed")); return; }
      ws.onmessage = function (ev) {
        var m = null;
        try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (!m || !m.type) { return; }
        if (m.type === "auth_required") { ws.send(JSON.stringify({ type: "auth", access_token: tok })); return; }
        if (m.type === "auth_invalid") { stop(new Error("auth_invalid")); return; }
        if (m.type === "auth_ok") { next(); return; }
        if (current && m.id === current.id) {
          if (m.success) {
            var s = sessionFrom(m.result);
            if (s) { stop(null, s); } else { next(); }
            return;
          }
          next();
        }
      };
      ws.onerror = function () { stop(new Error("ws_error")); };
      ws.onclose = function () { stop(new Error("ws_closed")); };
    });
  }
  function afterSession(session, how) {
    var s = session ? String(session) : "";
    if (!s) { finish({ step: "session", ok: false, detail: "no_session" }); return; }
    var ok = storeCookie(s);
    finish({ step: "session", ok: true, session: s, how: how, cookie: ok });
  }
  function withToken(why) {
    token().then(function (tok) {
      report({ step: "token", ok: true, detail: why });
      return viaSocket(tok);
    }, function (e) {
      report({ step: "token", ok: false, detail: String((e && e.message) || e || "no_token") });
      throw e;
    }).then(function (s) {
      afterSession(s, "socket");
    }, function (e) {
      finish({ step: "session", ok: false, detail: String((e && e.message) || e || "fail") });
    });
  }
  function start() {
    var p = viaHass();
    if (p && typeof p.then === "function") {
      p.then(function (r) {
        var s = sessionFrom(r);
        if (s) {
          report({ step: "token", ok: true, detail: "hass" });
          afterSession(s, "hass");
        } else {
          withToken("hass_no_session");
        }
      }, function () { withToken("hass_error"); });
      return;
    }
    withToken("no_hass_object");
  }
  try { start(); } catch (e) { finish({ step: "session", ok: false, detail: "script_error" }); }
})();
""".trimIndent()
}
