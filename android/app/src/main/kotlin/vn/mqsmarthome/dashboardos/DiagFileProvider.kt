package vn.mqsmarthome.dashboardos

import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import java.io.File
import java.io.FileNotFoundException

/**
 * (29/11/2026) GD17 — **CHIA SẺ TỆP CHẨN ĐOÁN** (`content://vn.mqsmarthome.dashboardos.diagfiles/<tệp>`).
 *
 * App này **không có phụ thuộc runtime** (xem `app/build.gradle.kts`: chỉ `android.*`, build được offline), nên thay
 * vì `androidx.core.content.FileProvider` ở đây dùng một `ContentProvider` tương đương — CÙNG giao kèo với
 * `FileProvider`:
 *  - `AndroidManifest.xml` khai `<provider … grantUriPermissions="true">` + `<meta-data
 *    android:name="android.support.FILE_PROVIDER_PATHS" android:resource="@xml/file_paths" />`;
 *  - `res/xml/file_paths.xml` khai `<external-files-path>` (bộ nhớ ngoài riêng của app) + `<files-path>` (dự phòng),
 *    và **chính tệp XML đó quyết định** thư mục được phép phục vụ ([roots]);
 *  - chỉ phục vụ **đọc** tệp `diag-…txt`, chặn `..`/`/` ([DiagFile.isSafeName]) — không lộ gì ngoài tệp chẩn đoán;
 *  - trả `OpenableColumns.DISPLAY_NAME`/`SIZE` để hộp chọn ứng dụng (Zalo, Telegram, Gmail…) hiện đúng tên tệp.
 */
class DiagFileProvider : ContentProvider() {

    override fun onCreate(): Boolean = true

    override fun getType(uri: Uri): String = "text/plain"

    override fun query(
        uri: Uri,
        projection: Array<out String>?,
        selection: String?,
        selectionArgs: Array<out String>?,
        sortOrder: String?
    ): Cursor? {
        val file = fileFor(uri) ?: return null
        val columns = projection ?: arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE)
        val cursor = MatrixCursor(columns, 1)
        cursor.addRow(columns.map { column ->
            when (column) {
                OpenableColumns.DISPLAY_NAME -> file.name
                OpenableColumns.SIZE -> file.length()
                else -> null
            }
        })
        return cursor
    }

    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
        val file = fileFor(uri) ?: throw FileNotFoundException("không có tệp chẩn đoán: $uri")
        if (mode != "r") throw FileNotFoundException("chỉ cho đọc: $mode")
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
    }

    override fun insert(uri: Uri, values: ContentValues?): Uri? = null

    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int = 0

    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0

    /** Tệp ứng với [uri] (`content://…/<tên tệp>`), chỉ trong các thư mục khai ở `res/xml/file_paths.xml`. */
    private fun fileFor(uri: Uri): File? {
        val ctx = context ?: return null
        val name = uri.lastPathSegment ?: return null
        if (!DiagFile.isSafeName(name) || !DiagFile.isDiagFile(name)) return null
        return roots(ctx).asSequence().map { File(it, name) }.firstOrNull { it.isFile }
    }

    /** Thư mục gốc được phép phục vụ — đọc từ `R.xml.file_paths` (`external-files-path` + `files-path`). */
    private fun roots(ctx: Context): List<File> {
        val out = ArrayList<File>(2)
        runCatching {
            val parser = ctx.resources.getXml(R.xml.file_paths)
            try {
                var event = parser.eventType
                while (event != org.xmlpull.v1.XmlPullParser.END_DOCUMENT) {
                    if (event == org.xmlpull.v1.XmlPullParser.START_TAG) {
                        val attr = parser.getAttributeValue(null, "path").orEmpty().trim('/')
                        val base = when (parser.name) {
                            "external-files-path" -> runCatching { ctx.getExternalFilesDir(null) }.getOrNull()
                            "files-path" -> ctx.filesDir
                            else -> null
                        }
                        if (base != null) out.add(if (attr.isEmpty()) base else File(base, attr))
                    }
                    event = parser.next()
                }
            } finally {
                runCatching { parser.close() }
            }
        }
        // XML hỏng/không đọc được ⇒ vẫn phục vụ được thư mục chẩn đoán chuẩn của app.
        if (out.isEmpty()) out.add(DiagStore.root(ctx))
        return out
    }
}
