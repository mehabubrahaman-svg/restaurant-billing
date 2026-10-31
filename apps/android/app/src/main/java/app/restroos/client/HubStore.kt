package app.restroos.client

import android.content.Context

/** Where the Hub is, and whether the app pins itself, remembered between launches. */
class HubStore(context: Context) {
  private val prefs = context.getSharedPreferences("hub", Context.MODE_PRIVATE)

  /** The Hub's base URL, e.g. http://192.168.1.20:7400; null until connected. */
  val url: String?
    get() = prefs.getString(KEY_URL, null)

  /** The last address used, to prefill the form after "Use another Hub". */
  val lastAddress: String?
    get() = prefs.getString(KEY_LAST, null)

  var kiosk: Boolean
    get() = prefs.getBoolean(KEY_KIOSK, false)
    set(value) = prefs.edit().putBoolean(KEY_KIOSK, value).apply()

  fun use(url: String) {
    prefs.edit().putString(KEY_URL, url).putString(KEY_LAST, url).apply()
  }

  fun forget() {
    prefs.edit().remove(KEY_URL).putBoolean(KEY_KIOSK, false).apply()
  }

  private companion object {
    const val KEY_URL = "hubURL"
    const val KEY_LAST = "lastHubAddress"
    const val KEY_KIOSK = "kiosk"
  }
}
