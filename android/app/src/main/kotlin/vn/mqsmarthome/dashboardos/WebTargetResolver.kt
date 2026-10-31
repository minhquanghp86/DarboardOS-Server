package vn.mqsmarthome.dashboardos

import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * (13/11/2026) GD6 — HAI Ô NHẬP: "Trang điều khiển (https)" và "Máy chủ API (LAN)".
 *
 * Vì sao phải tách đôi (bối cảnh đã kiểm chứng):
 *  - WebView chỉ được cấp micro/camera (getUserMedia) trong SECURE CONTEXT → trang điều khiển phải mở bằng
 *    **https**, tức đi qua domain + ingress của Home Assistant:
 *    `https://<domain>/api/hassio_ingress/<TOKEN>/launcher-config.html`.
 *    Trang này (đúng add-on) trả **401** khi WebView chưa có cookie Home Assistant — 401 KHÔNG phải lỗi,
 *    nó chỉ có nghĩa "hãy đăng nhập HA", nên app vẫn phải coi là TÌM THẤY và mở bình thường.
 *  - API riêng của app (`/app/register`, `/app/incoming`, `/app/answer`, `/app/decline`) thì phải gọi **LAN**
 *    (`http://192.168.10.2:18080`): ingress cần cookie HA, HttpURLConnection không có cookie → không dùng được.
 *
 * Nên: ô 1 → [webUrl] (WebView), ô 2 → [apiBase] (PhoneService + PhoneApi). Hai giá trị lưu riêng, KHÔNG suy ra
 * cái này từ cái kia khi đã có cả hai.
 *
 * Phần "nhận biết đúng add-on" (thuần, không mạng) tách khỏi phần gọi mạng để unit test được:
 *  - [webCandidates]  : domain/URL người dùng gõ → danh sách URL ứng viên (thứ tự ưu tiên),
 *  - [isAcceptedWeb]  : (200 | 401) và body KHÔNG phải SPA của Home Assistant,
 *  - [isHomeAssistantSpa] : body có `<title>Home Assistant</title>` → của HA, không phải add-on,
 *  - [apiCandidates]  : ô 2 → các gốc API ứng viên (`http://host:18080`, ...),
 *  - [apiBaseOrNull]  : chọn apiBase (ô 2, hoặc suy ra từ ô 1 khi ô 1 là IP LAN),
 *  - [callPageUrl]    : webUrl → trang gọi (cùng thư mục ingress) khi bấm "Nghe".
 *
 * (14/11/2026) GD7 — ĐĂNG NHẬP HOME ASSISTANT (401 KHÔNG còn được mở thẳng ra WebView):
 *  - [needsHaLogin]      : mã HTTP của lần dò → có phải "cần đăng nhập HA" (401/403) hay không,
 *  - [isIngressUrl]      : URL có nằm sau ingress của HA (`/api/hassio_ingress/…`) hay không,
 *  - [SESSION_COOKIE_NAMES] / [hasSessionCookie] : cookie header có `ingress_session` / `hassio_ingress` không,
 *  - [loginUrl]          : webUrl → `https://<domain>/` (trang đăng nhập Lovelace của HA),
 *  - [sameUrl]           : so 2 URL cùng đích (bỏ query/fragment).
 *
 * Cả tệp chỉ dùng java.net (không có API Android) → chạy được trong unit test JVM.
 */
object WebTargetResolver {

    /** Tiền tố ingress của Home Assistant (HA tự thêm token phía sau). */
    const val INGRESS_PREFIX = "/api/hassio_ingress"

    /**
     * TOKEN ingress mặc định của add-on (người dùng sửa được ở Cài đặt → [Prefs.KEY_INGRESS_TOKEN]).
     * Đây là chuỗi nằm sau `/api/hassio_ingress/` trong URL do Home Assistant cấp.
     */
    const val DEFAULT_INGRESS_TOKEN = "KJjH_rSB8SdDeyjszvdZnnH1pRlxySfVG5VmgDMVf38"

    /** Trang điều khiển (thư mục public của add-on). */
    const val LAUNCHER_PAGE = "launcher-config.html"

    /**
     * (26/11/2026) GD14 — **PANEL CỦA ADD-ON TRONG HOME ASSISTANT** (`/b39feb53_remote_webview_server`).
     *
     * Đây là đường vào ĐÚNG và DUY NHẤT hoạt động được, đã kiểm chứng:
     *  - add-on có ingress nên HA tự tạo một mục ở thanh bên với `url_path` = slug add-on;
     *  - mở `https://<domain>/<slug>` trong trình duyệt **đã đăng nhập** thì CHÍNH HA FRONTEND dựng panel, tạo phiên
     *    ingress rồi nhúng add-on vào `<iframe src="…/api/hassio_ingress/<TOKEN>/…">`;
     *  - vào thẳng `/api/hassio_ingress/<TOKEN>/…` thì thất bại (401) vì phiên ingress chỉ được tạo khi HA frontend
     *    mở panel — đúng lỗi mà 4 bản trước mắc phải.
     *
     * ⇒ WebView chỉ cần mở đúng đường dẫn panel này; mọi việc còn lại HA tự làm (và https sẵn nên micro/camera chạy).
     */
    const val PANEL_PATH = "/${ServerResolver.ADDON_SLUG}"

    /** Trang gọi (video) — cùng thư mục với trang điều khiển. */
    const val CALL_PAGE = "call-web.html"

    /** Thư mục ingress cũ / proxy giữ tên add-on. */
    const val ADDON_SLUG = ServerResolver.ADDON_SLUG

    /** Cổng mặc định của web server add-on (host network). */
    const val ADDON_PORT = ServerResolver.ADDON_PORT

    /**
     * (21/11/2026) GD13 — cổng **HTTPS tự ký** của add-on (`src/tls.ts`; cấu hình add-on `18443/tcp`). Xem
     * [TlsPolicy]: đây là đường vào KHUYẾN NGHỊ cho điện thoại (secure context + không cần đăng nhập HA).
     */
    const val ADDON_TLS_PORT = ServerResolver.ADDON_TLS_PORT

    /** Giá trị điền sẵn cho ô "Máy chủ API (LAN)". */
    const val DEFAULT_API_INPUT = "192.168.10.2:18080"

    /** Timeout mỗi lần GET (đủ cho 1 trang HTML; sai địa chỉ thì thất bại nhanh). */
    const val TIMEOUT_MS = 4000

    /**
     * (14/11/2026) GD7 — Tên cookie mà Home Assistant đặt khi một phiên đăng nhập đi qua ingress.
     *
     * Vì sao dò hai tên: HA đặt `ingress_session` cho phiên ingress hiện tại, và một số bản
     * (supervisor / ingress proxy) dùng `hassio_ingress`. Chỉ cần MỘT trong hai xuất hiện trong
     * `CookieManager.getInstance().getCookie(origin)` là WebView đã có phiên → ingress trả trang thay vì 401.
     */
    val SESSION_COOKIE_NAMES = listOf("ingress_session", "hassio_ingress")

    /** Chỉ cần đầu trang để thấy `<title>` — không tải cả 180 KB của launcher-config.html. */
    private const val BODY_MAX = 16_384

    /** Kết quả 1 lần GET trang điều khiển: mã HTTP + đầu body. */
    data class WebCheck(val url: String, val status: Int, val body: String?) {
        /** true = đúng add-on (200 hoặc 401) và không phải trang SPA của Home Assistant. */
        val accepted: Boolean get() = isAcceptedWeb(status, body)
    }

    // ────────────────────────────────────────────────────────────── ô 1: trang điều khiển

    /**
     * Sinh danh sách URL trang điều khiển ứng viên từ chuỗi người dùng gõ ở ô 1.
     *
     *  - Người dùng đã gõ tiền tố đường dẫn (URL đầy đủ, vd `https://hass/.../launcher-config.html`) → thử
     *    đúng cái đó trước.
     *  - **Domain** (không phải IP LAN) → đúng thứ tự yêu cầu:
     *      1. `https://<domain>/api/hassio_ingress/<TOKEN>/launcher-config.html`  (ingress HA — cần đăng nhập HA)
     *      2. `https://<domain>/b39feb53_remote_webview_server/launcher-config.html` (proxy giữ tên add-on)
     *      3. `https://<domain>/launcher-config.html` (add-on phục vụ thẳng ở gốc domain)
     *  - **IP LAN** (192.168.x, 10.x, 172.16-31.x, 127.x, localhost) → **https trước** (secure context cho micro/camera):
     *      `https://<ip>:18443/launcher-config.html` ← (21/11/2026 GD13) HTTPS TỰ KÝ của chính add-on, KHÔNG cần đăng
     *      nhập HA; rồi `https://<ip>/launcher-config.html`, `https://<ip>/<slug>/launcher-config.html`,
     *      `http://<ip>:18080/launcher-config.html`, `http://<ip>/launcher-config.html`.
     *  - Loại trùng, giữ thứ tự. Chuỗi rỗng / rác → danh sách rỗng.
     */
    fun webCandidates(input: String?, token: String? = null): List<String> {
        val raw = input?.trim().orEmpty()
        if (raw.isEmpty()) return emptyList()
        val a = ServerResolver.parse(raw) ?: return emptyList()
        val tok = sanitizeToken(token)
        val out = LinkedHashSet<String>()
        val prefix = a.prefix

        fun add(scheme: String, port: Int, path: String) {
            val netloc = if (port > 0) "${a.host}:$port" else a.host
            out.add("$scheme://$netloc$path")
        }

        // Đúng thứ người dùng gõ (họ đã dán URL đầy đủ, kể cả URL ingress).
        if (prefix.isNotEmpty()) add(a.scheme, a.port, "$prefix/$LAUNCHER_PAGE")

        // Cổng add-on: cổng người dùng gõ (nếu có), ngược lại 18080.
        val port = if (a.port > 0) a.port else ADDON_PORT
        if (a.lan) {
            // (21/11/2026) GD13 — ƯU TIÊN SỐ MỘT: HTTPS của chính add-on (`https://<ip>:18443`, chứng chỉ tự ký do
            // server sinh trong /data/tls — xem src/tls.ts). Chỉ https mới là secure context (WebView mới cấp
            // micro/camera) VÀ đường này KHÔNG cần đăng nhập Home Assistant, không cần phiên ingress — đúng lỗi
            // người dùng báo (đăng nhập HA xong vẫn không vào được dashboard).
            add("https", ADDON_TLS_PORT, "/$LAUNCHER_PAGE")
            // Dự phòng TLS sẵn có (reverse proxy trên máy) trên cổng người dùng gõ.
            add("https", a.port, "/$LAUNCHER_PAGE")
            add("https", a.port, "/$ADDON_SLUG/$LAUNCHER_PAGE")
            // Add-on mở thẳng (http, cổng 18080): trang vẫn mở được nhưng KHÔNG có micro/camera.
            add("http", port, "/$LAUNCHER_PAGE")
            if (prefix.isNotEmpty()) add("http", port, "$prefix/$LAUNCHER_PAGE")
            add("http", a.port, "/$LAUNCHER_PAGE")
        } else {
            // (26/11/2026) GD14 — ĐÚNG THỨ TỰ của chế độ domain (panel của HA là đường CHÍNH):
            // (1) `https://<domain>/<slug>` — panel của add-on trên HA; CHÍNH HA frontend dựng panel + tạo phiên
            //     ingress + nhúng add-on. Không cần app tự tạo phiên, không cần TOKEN.
            add("https", a.port, PANEL_PATH)
            // (2) cùng panel nhưng trỏ thẳng trang điều khiển (một số bản HA phục vụ tĩnh được đường này).
            add("https", a.port, "$PANEL_PATH/$LAUNCHER_PAGE")
            // (3) ingress của Home Assistant — dự phòng khi panel không mở được (cần phiên ingress sẵn có).
            add("https", a.port, "$INGRESS_PREFIX/$tok/$LAUNCHER_PAGE")
            // (4) add-on phục vụ thẳng ở gốc domain.
            add("https", a.port, "/$LAUNCHER_PAGE")
        }
        return out.toList()
    }

    // ────────────────────────────────────────────────────────────── panel của add-on trên HA (GD14)

    /**
     * URL panel của add-on trên Home Assistant: `https://<domain>/b39feb53_remote_webview_server`.
     *
     * [origin] phải là origin (`https://<domain>`, có hoặc không có `/` cuối); chuỗi rỗng → null.
     */
    fun panelUrl(origin: String?): String? {
        val o = origin?.trim()?.trimEnd('/').orEmpty()
        if (o.isEmpty()) return null
        if (!o.startsWith("http://", ignoreCase = true) && !o.startsWith("https://", ignoreCase = true)) return null
        return o + PANEL_PATH
    }

    /**
     * Đường dẫn của [url] có phải panel của add-on không (`/b39feb53_remote_webview_server` hoặc
     * `/b39feb53_remote_webview_server/…`). So khớp theo **đoạn đường dẫn**, nên
     * `/b39feb53_remote_webview_server_x` KHÔNG khớp.
     */
    fun isPanelUrl(url: String?): Boolean {
        val path = pathOf(url)?.lowercase() ?: return false
        val panel = PANEL_PATH.lowercase()
        return path == panel || path.startsWith("$panel/")
    }

    /** Phần đường dẫn của [url] (`https://h/a/b?x=1#y` → `/a/b`); null = không phải URL http(s). */
    fun pathOf(url: String?): String? {
        val u = url?.trim().orEmpty()
        if (u.isEmpty()) return null
        val origin = originUrl(u) ?: return null
        val rest = u.substring(origin.length)
        val noQuery = rest.substringBefore('#').substringBefore('?')
        return if (noQuery.isEmpty()) "/" else noQuery
    }

    /**
     * (26/11/2026) GD14 — trang HTML (hoặc chính WebView) có nhúng add-on qua ingress không:
     * `<iframe src="…/api/hassio_ingress/…">` — đây là DẤU HIỆU CHẮC CHẮN NHẤT "đã vào đúng panel".
     *
     * Dùng cho: (a) chẩn đoán trong `probeWeb`/`connect` (body của panel), (b) kiểm tra bằng JS trong WebView
     * (`document.querySelector('iframe[src*="hassio_ingress"]')`).
     */
    fun hasIngressIframe(html: String?): Boolean {
        val h = html ?: return false
        if (h.isEmpty()) return false
        return INGRESS_IFRAME_RE.containsMatchIn(h)
    }

    /**
     * Body này có phải SPA của Home Assistant không?
     *
     * Trang chủ/portal của HA trả `<title>Home Assistant</title>`, còn add-on trả `<title>Dashboard</title>`.
     * Đây là dấu hiệu duy nhất đủ tin cậy để loại `https://<domain>/launcher-config.html` khi domain đó chỉ là
     * HA (không có add-on) — đúng lỗi "trả về HTML của HA nên báo không tìm thấy Dashboard OS".
     */
    fun isHomeAssistantSpa(body: String?): Boolean {
        val b = body ?: return false
        if (b.isBlank()) return false
        return HA_TITLE_RE.containsMatchIn(b)
    }

    /**
     * Chấp nhận URL trang điều khiển khi:
     *  - mã HTTP **200** (add-on trả trang) hoặc **401** (đúng add-on, WebView chưa có cookie HA → cần đăng nhập), VÀ
     *  - body **không** phải SPA của Home Assistant.
     */
    fun isAcceptedWeb(status: Int, body: String?): Boolean {
        if (status != HttpURLConnection.HTTP_OK && status != HttpURLConnection.HTTP_UNAUTHORIZED) return false
        return !isHomeAssistantSpa(body)
    }

    /**
     * (26/11/2026) GD14 — như [isAcceptedWeb] nhưng biết [url], vì PANEL của add-on trên HA **luôn** trả SPA của HA
     * (`<title>Home Assistant</title>`) rồi mới nhúng add-on vào iframe: 200 cho đường dẫn panel = ĐÚNG đích.
     *
     * Nhờ vậy bước "Kết nối" không loại panel chỉ vì body là SPA của HA (bản GD11 loại ⇒ không bao giờ tìm ra
     * đường vào hoạt động được).
     */
    fun isAcceptedWeb(url: String?, status: Int, body: String?): Boolean {
        if (isPanelUrl(url) && status == HttpURLConnection.HTTP_OK) return true
        return isAcceptedWeb(status, body)
    }

    /**
     * (26/11/2026) GD14 — tiêu đề **TRẦN** của Home Assistant (`Home Assistant` đúng nguyên văn, không có hậu tố).
     *
     * Panel của add-on có tiêu đề riêng (vd `Dashboard OS - Home Assistant`), nên tiêu đề trần = trang SPA của HA
     * chưa dựng panel (hoặc đường dẫn không tồn tại) — KHÔNG được tính là "đã vào panel".
     */
    fun isBareHomeAssistantTitle(title: String?): Boolean {
        val t = title?.trim().orEmpty()
        if (t.isEmpty()) return false
        return t.equals("home assistant", ignoreCase = true)
    }

    // ────────────────────────────────────────────────────────────── ô 2: máy chủ API (LAN)

    /**
     * Sinh danh sách gốc API ứng viên từ ô 2. API của app chỉ sống ở GỐC add-on (`/app/...`), nên tiền tố
     * đường dẫn (nếu người dùng dán kèm) bị bỏ.
     *
     *  - `192.168.10.2:18080`  -> http://192.168.10.2:18080, https://192.168.10.2:18080
     *  - `192.168.10.2`        -> http://192.168.10.2:18080, http://192.168.10.2, https://192.168.10.2
     *  - `hass.example.com:8123` -> https://hass.example.com:8123, http://hass.example.com:8123
     *  - rỗng / rác -> danh sách rỗng.
     */
    fun apiCandidates(input: String?): List<String> {
        val raw = input?.trim().orEmpty()
        if (raw.isEmpty()) return emptyList()
        val a = ServerResolver.parse(raw) ?: return emptyList()
        val out = LinkedHashSet<String>()

        fun add(scheme: String, port: Int) {
            out.add("$scheme://${a.host}" + if (port > 0) ":$port" else "")
        }

        val other = if (a.scheme == "http") "https" else "http"
        if (a.port > 0) {
            add(a.scheme, a.port)
            add(other, a.port)
        } else {
            if (a.lan) add(a.scheme, ADDON_PORT)   // cổng add-on (trường hợp phổ biến nhất trong LAN)
            add(a.scheme, 0)                       // cổng mặc định của scheme (80 / 443)
            add(other, 0)
        }
        return out.toList()
    }

    /**
     * apiBase dùng cho PhoneService/PhoneApi:
     *  - ô 2 có giá trị → lấy ứng viên đầu của [apiCandidates] (thêm `http://` nếu người dùng gõ thiếu),
     *  - ô 2 TRỐNG → suy ra từ ô 1 **chỉ khi ô 1 là IP LAN**: `http://<ip>:18080` (hoặc đúng cổng đã gõ),
     *  - không suy ra được (ô 1 là domain / rác) → null (màn hình chính báo lỗi rõ ràng).
     *
     * (GD9) KHÔNG còn dùng cho giao diện 1 ô — xem [apiBasesForInput]. Giữ lại cho dữ liệu cũ / unit test.
     */
    fun apiBaseOrNull(webInput: String?, apiInput: String?): String? {
        apiCandidates(apiInput).firstOrNull()?.let { return it }
        val a = ServerResolver.parse(webInput) ?: return null
        if (!a.lan) return null
        val port = if (a.port > 0) a.port else ADDON_PORT
        return "http://${a.host}:$port"
    }

    // ────────────────────────────────────────────────────────────── (GD9) MỘT Ô ĐỊA CHỈ

    /**
     * (17/11/2026) GD9 — NGƯỜI DÙNG CHỈ NHẬP MỘT ĐỊA CHỈ. Từ đúng chuỗi đó suy ra cả **trang điều khiển** (WebView)
     * và **gốc API** (`/app/register`, `/app/incoming`, `/app/answer`, `/app/decline`, `/app/hangup`):
     *
     *  - **Domain** (`hass.mqsmarthome.io.vn`) → ingress của Home Assistant cho CẢ HAI:
     *      1. `https://<domain>/api/hassio_ingress/<TOKEN>`   ← API (cần cookie phiên HA, xem src/haCookie)
     *      2. `https://<domain>/<slug>`                        (reverse proxy giữ tên add-on)
     *      3. `https://<domain>`                               (add-on phục vụ ở gốc domain)
     *    Đây là thứ tự "token sai → 401/404 → thử đường dẫn khác" mà yêu cầu đặt ra.
     *  - **IP LAN** (`192.168.10.2`) → `http://<ip>:18080` (+ dự phòng https/http như [apiCandidates]).
     *    Không có HTTPS thì WebView **không được cấp micro/camera** → màn hình chính hiện cảnh báo (xem MainActivity).
     *  - Đã dán URL đầy đủ (kể cả URL ingress) → giữ đúng tiền tố đường dẫn đó trước, rồi mới tới dự phòng.
     *
     * Trả danh sách ứng viên theo thứ tự ưu tiên (rỗng = chuỗi không dùng được).
     */
    fun apiBasesForInput(input: String?, token: String? = null): List<String> {
        val raw = input?.trim().orEmpty()
        if (raw.isEmpty()) return emptyList()
        val a = ServerResolver.parse(raw) ?: return emptyList()
        val tok = sanitizeToken(token)
        val out = LinkedHashSet<String>()
        val netloc = if (a.port > 0) "${a.host}:${a.port}" else a.host

        // Người dùng đã dán URL đầy đủ có tiền tố: dùng đúng tiền tố đó trước (giữ nguyên ingress họ đang có).
        if (a.prefix.isNotEmpty() && !a.prefix.equals("/$ADDON_SLUG", ignoreCase = true)) out.add("${a.scheme}://$netloc${a.prefix}")

        if (a.lan) {
            // (21/11/2026) GD13 — API native đi LAN bằng http://<ip>:18080 như cũ (không cần TLS, không cookie), và
            // thêm HTTPS tự ký của add-on ngay sau đó làm phương án hai (khi 18080 bị chặn / người dùng chỉ mở 18443).
            // Trang điều khiển trong WebView thì NGƯỢC LẠI: https://<ip>:18443 là ứng viên đầu (cần secure context).
            val lan = apiCandidates(raw)
            if (lan.isNotEmpty()) out.add(lan.first())
            out.add("https://${a.host}:$ADDON_TLS_PORT")
            lan.drop(1).forEach { out.add(it) }
            if (a.prefix.isNotEmpty()) out.add("${a.scheme}://$netloc${a.prefix}")
        } else {
            // (1) ingress HA — dạng CHÍNH khi người dùng chỉ nhập domain.
            out.add("https://$netloc$INGRESS_PREFIX/$tok")
            // (2) reverse proxy giữ tên add-on. (3) add-on ở gốc domain.
            out.add("https://$netloc/$ADDON_SLUG")
            out.add("https://$netloc")
            // (4) cổng add-on mở thẳng (không TLS): vẫn dùng được cho API (chỉ mất micro/camera).
            out.add("http://${a.host}:$ADDON_PORT")
        }
        return out.filter { it.startsWith("http://") || it.startsWith("https://") }.toList()
    }

    /** Gốc API ưu tiên cho một ô địa chỉ (null = chuỗi không dùng được). */
    fun apiBaseForInput(input: String?, token: String? = null): String? = apiBasesForInput(input, token).firstOrNull()

    /**
     * (17/11/2026) GD9 — `apiBase` có nằm sau ingress của Home Assistant không (tức là MỌI lời gọi API native
     * `/app/...` phải kèm cookie phiên HA, nếu không ingress trả 401).
     *
     * Lưu ý: KHÔNG viết dạng `slash-app-sao` trong KDoc — Kotlin cho phép block comment lồng nhau, nên cặp
     * `slash-sao` vô tình sẽ mở một comment mới chưa đóng và nuốt phần còn lại của tệp.
     */
    fun isIngressBase(base: String?): Boolean = isIngressUrl(base)

    /** Cảnh báo: địa chỉ không phải https → WebView KHÔNG được cấp micro/camera. */
    fun lacksSecureContext(webUrl: String?): Boolean {
        val u = webUrl?.trim()?.lowercase().orEmpty()
        return u.startsWith("http://")
    }

    // ────────────────────────────────────────────────────────────── trang gọi + token

    /**
     * webUrl → trang gọi trong CÙNG thư mục (giữ nguyên tiền tố ingress, nên cookie HA vẫn áp dụng):
     * `https://hass/api/hassio_ingress/<TOKEN>/launcher-config.html` -> `.../call-web.html?call=<id>`.
     * null = webUrl không dùng được.
     *
     * (17/11/2026) GD9 — [phoneId] (tuỳ chọn) được gắn thêm `&phone=<id>`: trang biết NGAY máy nào đang gọi nên
     * `{type:'join'}` gửi kèm id máy, server gắn phiên web làm đầu cuối tiếng/hình của đúng máy đó (không phải đoán
     * từ /calls/state).
     */
    fun callPageUrl(webUrl: String?, callId: String, phoneId: String? = null): String? {
        val base = webUrl?.trim().orEmpty()
        if (!base.startsWith("http://") && !base.startsWith("https://")) return null
        val cut = base.indexOfAny(charArrayOf('?', '#'))
        val noQuery = if (cut >= 0) base.substring(0, cut) else base
        val slash = noQuery.lastIndexOf('/')
        val last = noQuery.substring(slash + 1)
        val dir = if (last.contains('.')) noQuery.substring(0, slash + 1) else noQuery.trimEnd('/') + "/"
        val query = StringBuilder()
        if (callId.isNotBlank()) query.append("?call=").append(URLEncoder.encode(callId, "UTF-8"))
        val ph = phoneId?.trim().orEmpty()
        if (ph.isNotEmpty()) query.append(if (query.isEmpty()) "?phone=" else "&phone=").append(URLEncoder.encode(ph, "UTF-8"))
        return "$dir$CALL_PAGE$query"
    }

    /**
     * Gốc của một URL (`https://hass.mqsmarthome.io.vn/api/hassio_ingress/<TOKEN>/launcher-config.html` ->
     * `https://hass.mqsmarthome.io.vn`) — dùng cho nút "Đăng nhập Home Assistant" ở Cài đặt: mở trang chủ HA
     * để đăng nhập (cookie), sau đó ingress mới trả trang thay vì 401. null = URL không dùng được.
     */
    fun originUrl(url: String?): String? {
        val u = url?.trim().orEmpty()
        return ORIGIN_RE.find(u)?.groupValues?.get(1)
    }

    /** Token ingress hợp lệ (bỏ khoảng trắng / `/` thừa); rỗng → [DEFAULT_INGRESS_TOKEN]. */
    fun sanitizeToken(token: String?): String {
        val t = token?.trim()?.trim('/')?.trim().orEmpty()
        return if (t.isEmpty()) DEFAULT_INGRESS_TOKEN else t
    }

    // ────────────────────────────────────────────────────────────── đăng nhập Home Assistant (GD7)

    /**
     * (14/11/2026) GD7 — mã HTTP của lần dò có nghĩa "phải đăng nhập Home Assistant" hay không.
     *
     * `launcher-config.html` nằm sau ingress của HA nên khi WebView CHƯA có cookie phiên HA, HA trả
     * **401** (body là text `401: Unauthorized`, KHÔNG redirect sang trang đăng nhập); một số cấu hình
     * reverse proxy trả **403**. Cả hai đều là "đúng add-on, cần đăng nhập" — không phải lỗi địa chỉ.
     */
    fun needsHaLogin(status: Int): Boolean =
        status == HttpURLConnection.HTTP_UNAUTHORIZED || status == HttpURLConnection.HTTP_FORBIDDEN

    /**
     * (14/11/2026) GD7 — URL có nằm sau ingress của Home Assistant không
     * (`https://<domain>/api/hassio_ingress/<TOKEN>/…`, hoặc dạng `/hassio/ingress/…`).
     * Dùng để chặn hiển thị nội dung lỗi thô (`401: Unauthorized`) của ingress.
     */
    fun isIngressUrl(url: String?): Boolean {
        val u = url?.trim().orEmpty()
        if (u.isEmpty()) return false
        return u.contains("$INGRESS_PREFIX/", ignoreCase = true) ||
            u.contains("/hassio/ingress/", ignoreCase = true)
    }

    /**
     * (14/11/2026) GD7 — cookie header (`CookieManager.getCookie(origin)`) đã có phiên HA chưa?
     *
     * Chỉ dò TÊN cookie trong header dạng `a=1; ingress_session=…; b=2`; không cần giá trị. Header rỗng /
     * null → false.
     *
     * (18/11/2026) GD10 — **KHÔNG còn là logic "đã đăng nhập chưa"**: đăng nhập Lovelace của HA không sinh cookie
     * nào trong hai tên này (HA giữ phiên trong `localStorage`; `ingress_session` chỉ có khi mở add-on hoặc khi app
     * tự tạo — xem [HaLogin]/[HaIngress]). Nay hàm này chỉ dùng để biết "đã có phiên ingress chưa" trong log /
     * màn Cài đặt.
     */
    fun hasSessionCookie(cookieHeader: String?): Boolean {
        val header = cookieHeader ?: return false
        if (header.isBlank()) return false
        for (part in header.split(';')) {
            val name = part.substringBefore('=').trim()
            if (name.isEmpty()) continue
            for (known in SESSION_COOKIE_NAMES) {
                if (known.equals(name, ignoreCase = true)) return true
            }
        }
        return false
    }

    /**
     * (14/11/2026) GD7 — webUrl → trang đăng nhập Home Assistant: `https://<domain>/` (Lovelace tự chuyển
     * sang form đăng nhập). null = webUrl không phải URL http(s) (không có gì để mở).
     */
    fun loginUrl(webUrl: String?): String? = originUrl(webUrl)?.trimEnd('/')?.plus("/")

    /**
     * (14/11/2026) GD7 — hai URL có cùng đích không (bỏ query + fragment, bỏ `/` cuối).
     *
     * Dùng để biết "trang WebView đang lỗi 401 có đúng là trang điều khiển đã lưu (`webUrl`) không": nếu đúng
     * thì tự chuyển về origin của HA để đăng nhập, nếu không (vd trang gọi `call-web.html?call=…`) thì hiện màn
     * hình "Cần đăng nhập Home Assistant" có nút Đăng nhập.
     */
    fun sameUrl(a: String?, b: String?): Boolean {
        val x = normalizeUrl(a) ?: return false
        val y = normalizeUrl(b) ?: return false
        return x == y
    }

    private fun normalizeUrl(url: String?): String? {
        val u = url?.trim().orEmpty()
        if (u.isEmpty()) return null
        val cut = u.indexOfAny(charArrayOf('?', '#'))
        val noQuery = if (cut >= 0) u.substring(0, cut) else u
        return noQuery.trimEnd('/').lowercase()
    }

    // ────────────────────────────────────────────────────────────── gọi mạng

    /**
     * GET một URL trang điều khiển (KHÔNG theo redirect: cần thấy đúng mã của add-on).
     * Trả [WebCheck] kể cả 401/404 (để [WebCheck.accepted] quyết định); null = không kết nối được.
     *
     * (17/11/2026) GD9 — [cookie] (header `Cookie:` của phiên HA, xem [HaCookie]) để lần dò SAU KHI đăng nhập thấy
     * 200 thay vì 401 (nhờ vậy không phải mở lại trang đăng nhập).
     *
     * (21/11/2026) GD13 — [allowedHosts]: host được chấp nhận **chứng chỉ tự ký** (mặc định rỗng = hành vi cũ). Cần
     * để dò được `https://<ip>:18443/launcher-config.html` — HTTPS tự ký của chính add-on (xem [TlsPolicy]).
     */
    fun probeWeb(url: String?, cookie: String? = null, allowedHosts: Set<String> = emptySet()): WebCheck? {
        val u = url?.trim().orEmpty()
        if (!u.startsWith("http://") && !u.startsWith("https://")) return null
        var conn: HttpURLConnection? = null
        try {
            val c = (URL(u).openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = TIMEOUT_MS
                readTimeout = TIMEOUT_MS
                instanceFollowRedirects = false
                useCaches = false
                setRequestProperty("accept", "text/html,application/xhtml+xml")
                setRequestProperty("cache-control", "no-cache")
                setRequestProperty("user-agent", "DashboardOS-Android")
                if (!cookie.isNullOrBlank()) setRequestProperty("cookie", cookie)
            }
            // (21/11/2026) GD13 — chứng chỉ tự ký của add-on chỉ được chấp nhận cho host đã cấu hình.
            TlsPolicy.applyTo(c, allowedHosts)
            conn = c
            val code = c.responseCode
            val stream = if (code in 200..299) c.inputStream else c.errorStream
            val body = if (stream == null) null else readHead(stream)
            return WebCheck(u, code, body)
        } catch (t: Throwable) {
            return null
        } finally {
            try {
                conn?.disconnect()
            } catch (t: Throwable) {
                // bỏ qua
            }
        }
    }

    /** Đọc tối đa [BODY_MAX] ký tự đầu (đủ cho `<title>`). */
    private fun readHead(stream: java.io.InputStream): String {
        BufferedReader(InputStreamReader(stream, Charsets.UTF_8)).use { reader ->
            val sb = StringBuilder()
            val buf = CharArray(2048)
            while (sb.length < BODY_MAX) {
                val n = reader.read(buf)
                if (n <= 0) break
                sb.append(buf, 0, minOf(n, BODY_MAX - sb.length))
            }
            return sb.toString()
        }
    }

    // ────────────────────────────────────────────────────────────── nội bộ

    /** `<title>Home Assistant</title>` — cho phép khoảng trắng/xuống dòng giữa các phần. */
    private val HA_TITLE_RE = Regex(
        "<title>\\s*Home\\s*Assistant\\s*</title>",
        RegexOption.IGNORE_CASE
    )

    /**
     * (26/11/2026) GD14 — `<iframe … hassio_ingress …>`: dấu hiệu CHẮC CHẮN panel của add-on đã được HA nhúng.
     * Không đòi thứ tự thuộc tính (`src` có thể đứng sau `id`/`class`), không phân biệt hoa/thường.
     */
    private val INGRESS_IFRAME_RE = Regex(
        "<iframe\\b[^>]*hassio_ingress",
        RegexOption.IGNORE_CASE
    )

    /** `https://host:port` ở đầu URL (không gồm đường dẫn / query). */
    private val ORIGIN_RE = Regex("^(https?://[^/?#\\s]+)", RegexOption.IGNORE_CASE)
}
