package app.restroos.client.core

import java.net.URI
import java.net.URISyntaxException

/** Where the Hub is: what staff type, turned into the Hub's base URL. */
object HubAddress {
  const val HTTP_PORT = 7400
  const val HTTPS_PORT = 7443

  /**
   * "192.168.1.20", "restro.local:7400" or "https://restro.local" → the
   * Hub's base URL, e.g. "http://192.168.1.20:7400". Without a scheme it is
   * plain HTTP; without a port, the Hub's. Null when it isn't an address.
   */
  fun normalize(input: String): String? {
    var text = input.trim()
    if (text.isEmpty()) return null
    if (!text.contains("://")) text = "http://$text"
    val uri =
      try {
        URI(text)
      } catch (_: URISyntaxException) {
        return null
      }
    val scheme = uri.scheme?.lowercase() ?: return null
    if (scheme != "http" && scheme != "https") return null
    val host = uri.host ?: return null
    if (host.isEmpty()) return null
    val port = if (uri.port == -1) (if (scheme == "https") HTTPS_PORT else HTTP_PORT) else uri.port
    return "$scheme://$host:$port"
  }

  /** Whether `url` is on the Hub (same scheme, host and port), so it stays in the app. */
  fun isOnHub(hub: String, url: String): Boolean {
    val a = runCatching { URI(hub) }.getOrNull() ?: return false
    val b = runCatching { URI(url) }.getOrNull() ?: return false
    val port = { u: URI -> if (u.port != -1) u.port else if (u.scheme == "https") 443 else 80 }
    return a.scheme.equals(b.scheme, ignoreCase = true) &&
      a.host.equals(b.host, ignoreCase = true) &&
      port(a) == port(b)
  }
}
