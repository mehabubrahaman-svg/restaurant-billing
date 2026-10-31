package app.restroos.client.core

/** Splitting ESC/POS bytes for Bluetooth, which takes them a little at a time. */
object PrintData {
  /** Classic (SPP) printers: their buffers are small, so write and flush in pieces this size. */
  const val CLASSIC_CHUNK = 512

  /** BLE before the MTU is raised: 23-byte packets, 3 of them ATT header. */
  const val BLE_DEFAULT_CHUNK = 20

  /** The MTU the app asks a BLE printer for. Many cheap printers settle lower. */
  const val BLE_REQUESTED_MTU = 185

  /** Bytes per BLE write for a negotiated MTU (3 bytes of each packet are header). */
  fun bleChunkSize(mtu: Int): Int = (mtu - 3).coerceIn(BLE_DEFAULT_CHUNK, 512)

  /** `data` in pieces of at most `size` bytes, in order. Empty data is no pieces. */
  fun chunks(data: ByteArray, size: Int): List<ByteArray> {
    require(size > 0) { "chunk size must be positive" }
    return (data.indices step size).map { data.copyOfRange(it, minOf(it + size, data.size)) }
  }

  /**
   * How long to keep a classic connection open after the last write, so the
   * printer has taken everything before the socket closes (cheap printers
   * drop what's still in flight): about 10 KB/s, at least 300 ms, at most 4 s.
   */
  fun drainMillis(bytes: Int): Long = (300L + bytes / 10L).coerceAtMost(4_000L)

  /** A Bluetooth MAC address, e.g. 66:22:B3:01:4C:7A. */
  fun isMacAddress(address: String): Boolean =
    Regex("^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$").matches(address)
}
