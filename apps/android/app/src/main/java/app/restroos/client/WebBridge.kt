package app.restroos.client

import android.content.ContentValues
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.Toast
import app.restroos.client.core.Js
import java.io.File
import java.util.concurrent.Executors
import org.json.JSONArray
import org.json.JSONObject

/**
 * `window.RestroAndroid` in the web app (apps/web/src/lib/android-bridge.ts).
 * Only the Hub's own pages are loaded in the WebView; anything else opens in
 * the browser, so only the Hub can call this.
 */
class WebBridge(
  private val activity: MainActivity,
  private val web: WebView,
  private val printers: BluetoothPrinters,
) {
  /** One print at a time: a printer can't take two connections at once. */
  private val printing = Executors.newSingleThreadExecutor()

  @JavascriptInterface fun version(): String = BuildConfig.VERSION_NAME

  @JavascriptInterface
  fun bondedPrinters(): String =
    try {
      if (!printers.hasPermission()) activity.askForBluetooth()
      val list = JSONArray()
      for (b in printers.bonded()) {
        list.put(JSONObject().put("name", b.name).put("address", b.address).put("type", b.type))
      }
      JSONObject().put("ok", true).put("printers", list).toString()
    } catch (e: PrintFailure) {
      Js.result(e.message)
    } catch (e: SecurityException) {
      Js.result(activity.getString(R.string.bt_permission))
    }

  @JavascriptInterface
  fun print(requestId: String, connection: String, address: String, base64: String) {
    if (!printers.hasPermission()) activity.askForBluetooth()
    printing.execute {
      val result =
        try {
          printers.print(connection, address, Base64.decode(base64, Base64.DEFAULT))
          Js.result(null)
        } catch (e: PrintFailure) {
          Js.result(e.message)
        } catch (e: SecurityException) {
          Js.result(activity.getString(R.string.bt_permission))
        } catch (e: Exception) {
          Js.result(e.message ?: e.javaClass.simpleName)
        }
      web.post { web.evaluateJavascript(Js.settle(requestId, result), null) }
    }
  }

  /** Saves a file the web app made (a CSV export, a backup) to Downloads. */
  @JavascriptInterface
  fun saveFile(fileName: String, mimeType: String, base64: String): String {
    val name = File(fileName).name.ifBlank { "restroos-file" }
    return try {
      val bytes = Base64.decode(base64, Base64.DEFAULT)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        val values =
          ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, name)
            put(MediaStore.Downloads.MIME_TYPE, mimeType)
            put(MediaStore.Downloads.IS_PENDING, 1)
          }
        val resolver = activity.contentResolver
        val uri =
          resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
            ?: throw IllegalStateException("no Downloads folder")
        resolver.openOutputStream(uri)?.use { it.write(bytes) }
          ?: throw IllegalStateException("can't write")
        values.clear()
        values.put(MediaStore.Downloads.IS_PENDING, 0)
        resolver.update(uri, values, null, null)
      } else {
        // Android 9 and older: the app's own Downloads folder needs no permission.
        val dir = activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
          ?: throw IllegalStateException("no storage")
        File(dir, name).writeBytes(bytes)
      }
      activity.runOnUiThread {
        Toast.makeText(activity, activity.getString(R.string.file_saved, name), Toast.LENGTH_LONG)
          .show()
      }
      Js.result(null)
    } catch (e: Exception) {
      activity.runOnUiThread {
        Toast.makeText(activity, activity.getString(R.string.file_failed, name), Toast.LENGTH_LONG)
          .show()
      }
      Js.result(e.message ?: "failed")
    }
  }

  fun shutdown() = printing.shutdownNow()
}
