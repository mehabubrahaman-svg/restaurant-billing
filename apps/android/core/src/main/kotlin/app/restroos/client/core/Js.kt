package app.restroos.client.core

/** Building JavaScript and JSON text to hand to the web app. */
object Js {
  /** `value` as a JSON (and so JavaScript) string literal, quotes included. */
  fun string(value: String): String {
    val out = StringBuilder(value.length + 2).append('"')
    for (c in value) {
      when (c) {
        '"' -> out.append("\\\"")
        '\\' -> out.append("\\\\")
        '\n' -> out.append("\\n")
        '\r' -> out.append("\\r")
        '\t' -> out.append("\\t")
        // Line and paragraph separators end a JavaScript string in older engines.
        ' ' -> out.append("\\u2028")
        ' ' -> out.append("\\u2029")
        else -> if (c < ' ') out.append(String.format("\\u%04x", c.code)) else out.append(c)
      }
    }
    return out.append('"').toString()
  }

  /** `{"ok":true}` or `{"ok":false,"error":"…"}`. */
  fun result(error: String?): String =
    if (error == null) """{"ok":true}""" else """{"ok":false,"error":${string(error)}}"""

  /** The call that settles a pending native request in the web app. */
  fun settle(requestId: String, resultJson: String): String =
    "window.RestroAndroidCallbacks&&window.RestroAndroidCallbacks.settle(" +
      "${string(requestId)},${string(resultJson)})"
}
