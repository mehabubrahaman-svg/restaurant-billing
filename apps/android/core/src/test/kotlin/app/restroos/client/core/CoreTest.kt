package app.restroos.client.core

import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class HubAddressTest {
  @Test
  fun `fills in the scheme and the Hub's port`() {
    assertEquals("http://192.168.1.20:7400", HubAddress.normalize(" 192.168.1.20 "))
    assertEquals("http://restro.local:8080", HubAddress.normalize("restro.local:8080"))
    assertEquals("https://restro.local:7443", HubAddress.normalize("https://restro.local/pos?x=1"))
    assertEquals("http://10.0.2.2:7400", HubAddress.normalize("HTTP://10.0.2.2"))
  }

  @Test
  fun `rejects what isn't an address`() {
    assertNull(HubAddress.normalize(""))
    assertNull(HubAddress.normalize("ftp://hub"))
    assertNull(HubAddress.normalize("http://"))
    assertNull(HubAddress.normalize("not an address"))
  }

  @Test
  fun `keeps the Hub's own pages in the app`() {
    val hub = "http://192.168.1.20:7400"
    assertTrue(HubAddress.isOnHub(hub, "http://192.168.1.20:7400/pos/tables"))
    assertFalse(HubAddress.isOnHub(hub, "http://192.168.1.20:8000/"))
    assertFalse(HubAddress.isOnHub(hub, "https://example.com/help"))
    assertTrue(HubAddress.isOnHub("http://hub:80", "http://hub/x"))
  }
}

class PrintDataTest {
  @Test
  fun `splits bytes in order without losing any`() {
    val data = ByteArray(1_234) { it.toByte() }
    val pieces = PrintData.chunks(data, 512)
    assertEquals(listOf(512, 512, 210), pieces.map { it.size })
    assertContentEquals(data, pieces.reduce { a, b -> a + b })
    assertEquals(emptyList(), PrintData.chunks(ByteArray(0), 20).map { it.size })
    assertEquals(listOf(20), PrintData.chunks(ByteArray(20), 20).map { it.size })
  }

  @Test
  fun `sizes BLE writes from the MTU`() {
    assertEquals(20, PrintData.bleChunkSize(23))
    assertEquals(182, PrintData.bleChunkSize(185))
    assertEquals(20, PrintData.bleChunkSize(0))
    assertEquals(512, PrintData.bleChunkSize(1_000))
  }

  @Test
  fun `waits for the printer to drain, within bounds`() {
    assertEquals(300, PrintData.drainMillis(0))
    assertEquals(500, PrintData.drainMillis(2_000))
    assertEquals(4_000, PrintData.drainMillis(1_000_000))
  }

  @Test
  fun `recognises Bluetooth addresses`() {
    assertTrue(PrintData.isMacAddress("66:22:B3:01:4C:7A"))
    assertFalse(PrintData.isMacAddress("192.168.1.50:9100"))
    assertFalse(PrintData.isMacAddress("66-22-B3-01-4C-7A"))
  }
}

class JsTest {
  @Test
  fun `quotes strings safely for JavaScript`() {
    assertEquals("\"a\\\"b\\\\c\\nd\\u2028\\u0001\"", Js.string("a\"b\\c\nd \u0001"))
    assertEquals("""{"ok":true}""", Js.result(null))
    assertEquals("""{"ok":false,"error":"Bluetooth is off"}""", Js.result("Bluetooth is off"))
    assertEquals(
      "window.RestroAndroidCallbacks&&window.RestroAndroidCallbacks.settle(\"p1\",\"{\\\"ok\\\":true}\")",
      Js.settle("p1", Js.result(null)),
    )
  }
}
