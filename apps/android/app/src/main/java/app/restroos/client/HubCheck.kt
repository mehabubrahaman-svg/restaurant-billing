package app.restroos.client

import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONObject

/** Whether a RestroOS Hub answers at an address (GET /api/v1/health). */
enum class HubCheck {
  OK,
  UNREACHABLE,
  NOT_A_HUB;

  companion object {
    /** Blocks for up to about 5 s: call it off the main thread. */
    fun run(base: String): HubCheck {
      val connection =
        try {
          URL("$base/api/v1/health").openConnection() as HttpURLConnection
        } catch (_: Exception) {
          return UNREACHABLE
        }
      return try {
        connection.connectTimeout = 5_000
        connection.readTimeout = 5_000
        connection.setRequestProperty("Accept", "application/json")
        if (connection.responseCode != 200) return NOT_A_HUB
        val body = connection.inputStream.bufferedReader().use { it.readText() }
        val json = runCatching { JSONObject(body) }.getOrNull() ?: return NOT_A_HUB
        if (json.opt("status") is String && json.opt("version") is String) OK else NOT_A_HUB
      } catch (_: Exception) {
        UNREACHABLE
      } finally {
        connection.disconnect()
      }
    }
  }
}
