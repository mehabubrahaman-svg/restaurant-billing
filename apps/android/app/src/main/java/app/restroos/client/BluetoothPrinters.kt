package app.restroos.client

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.BluetoothSocket
import android.bluetooth.BluetoothStatusCodes
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import app.restroos.client.core.PrintData
import java.io.IOException
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** A printer failure to show the staff, in their language. */
class PrintFailure(message: String) : Exception(message)

/**
 * Sends ESC/POS bytes to Bluetooth printers that are already paired with the
 * tablet in Android's Bluetooth settings. Classic printers (most 58/80 mm
 * thermal printers) take them over SPP; BLE printers over a writable GATT
 * characteristic. Calls block: run them off the main thread, one at a time.
 */
class BluetoothPrinters(private val context: Context) {
  private val adapter: BluetoothAdapter? =
    context.getSystemService(BluetoothManager::class.java)?.adapter

  fun hasPermission(): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
      context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) ==
        PackageManager.PERMISSION_GRANTED

  private fun ready(): BluetoothAdapter {
    val bt = adapter ?: throw PrintFailure(context.getString(R.string.bt_none))
    if (!hasPermission()) throw PrintFailure(context.getString(R.string.bt_permission))
    if (!bt.isEnabled) throw PrintFailure(context.getString(R.string.bt_off))
    return bt
  }

  data class Bonded(val name: String, val address: String, val type: String)

  /** The tablet's paired devices, printers first by name. */
  fun bonded(): List<Bonded> =
    ready()
      .bondedDevices
      .orEmpty()
      .map { d ->
        val type =
          when (d.type) {
            BluetoothDevice.DEVICE_TYPE_CLASSIC -> "CLASSIC"
            BluetoothDevice.DEVICE_TYPE_LE -> "LE"
            BluetoothDevice.DEVICE_TYPE_DUAL -> "DUAL"
            else -> "UNKNOWN"
          }
        Bonded(d.name ?: d.address, d.address, type)
      }
      .sortedWith(compareBy({ !looksLikePrinter(it) }, { it.name.lowercase() }))

  private fun looksLikePrinter(b: Bonded) =
    PRINTER_NAME_HINTS.any { b.name.contains(it, ignoreCase = true) }

  /** Prints `data` on the printer at `address`; throws PrintFailure with the reason. */
  fun print(connection: String, address: String, data: ByteArray) {
    if (!PrintData.isMacAddress(address)) throw PrintFailure("Not a Bluetooth address: $address")
    val device = ready().getRemoteDevice(address.uppercase())
    when (connection) {
      "BLE" -> printLe(device, data)
      else -> printClassic(device, data)
    }
  }

  // ---- classic (SPP) ----------------------------------------------------------------

  private fun printClassic(device: BluetoothDevice, data: ByteArray) {
    val socket = openSocket(device)
    try {
      val out = socket.outputStream
      for (piece in PrintData.chunks(data, PrintData.CLASSIC_CHUNK)) {
        out.write(piece)
        out.flush()
      }
      // Let the printer take everything before the socket closes.
      Thread.sleep(PrintData.drainMillis(data.size))
    } catch (e: IOException) {
      throw PrintFailure("Lost the printer while printing: ${e.message ?: "I/O error"}")
    } finally {
      runCatching { socket.close() }
    }
  }

  /**
   * The standard SPP socket, then the insecure one, then channel 1 directly:
   * cheap printers often answer only to one of them.
   */
  private fun openSocket(device: BluetoothDevice): BluetoothSocket {
    val attempts: List<() -> BluetoothSocket> =
      listOf(
        { device.createRfcommSocketToServiceRecord(SPP) },
        { device.createInsecureRfcommSocketToServiceRecord(SPP) },
        {
          device.javaClass
            .getMethod("createRfcommSocket", Int::class.javaPrimitiveType)
            .invoke(device, 1) as BluetoothSocket
        },
      )
    var last: Exception? = null
    for (attempt in attempts) {
      val socket = runCatching(attempt).getOrElse { last = it as? Exception; null } ?: continue
      try {
        socket.connect()
        return socket
      } catch (e: IOException) {
        last = e
        runCatching { socket.close() }
      }
    }
    throw PrintFailure(
      "Couldn't connect to the printer (${last?.message ?: "no answer"}). " +
        "Check it is on and in range."
    )
  }

  // ---- BLE --------------------------------------------------------------------------

  private fun printLe(device: BluetoothDevice, data: ByteArray) {
    val session = LeSession()
    val gatt =
      device.connectGatt(context, false, session, BluetoothDevice.TRANSPORT_LE)
        ?: throw PrintFailure("Couldn't open a Bluetooth LE connection")
    try {
      session.await(session.ready, "connect")
      session.failure?.let { throw PrintFailure(it) }
      val target = session.target ?: throw PrintFailure("The printer has nowhere to write to")
      val chunk = PrintData.bleChunkSize(session.mtu)
      val withResponse =
        target.properties and BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE == 0
      val type =
        if (withResponse) BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
        else BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
      for (piece in PrintData.chunks(data, chunk)) {
        session.write(gatt, target, piece, type)
      }
      Thread.sleep(PrintData.drainMillis(data.size) / 2)
    } finally {
      runCatching { gatt.disconnect() }
      runCatching { gatt.close() }
    }
  }

  /** Connect → raise the MTU → find a writable characteristic, then one write at a time. */
  private inner class LeSession : BluetoothGattCallback() {
    val ready = CountDownLatch(1)
    @Volatile var mtu = 23
    @Volatile var target: BluetoothGattCharacteristic? = null
    @Volatile var failure: String? = null
    @Volatile private var written: CountDownLatch? = null
    @Volatile private var writeStatus = BluetoothGatt.GATT_SUCCESS

    fun await(latch: CountDownLatch, what: String) {
      if (!latch.await(LE_TIMEOUT_S, TimeUnit.SECONDS)) {
        throw PrintFailure("The printer didn't answer ($what)")
      }
    }

    override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
      if (newState == BluetoothProfile.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS) {
        if (!gatt.requestMtu(PrintData.BLE_REQUESTED_MTU)) gatt.discoverServices()
      } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
        failure = failure ?: "The printer disconnected (status $status)"
        ready.countDown()
        written?.countDown()
      }
    }

    override fun onMtuChanged(gatt: BluetoothGatt, mtu: Int, status: Int) {
      if (status == BluetoothGatt.GATT_SUCCESS) this.mtu = mtu
      gatt.discoverServices()
    }

    override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
      if (status != BluetoothGatt.GATT_SUCCESS) {
        failure = "Couldn't read the printer's services (status $status)"
      } else {
        target = writable(gatt)
        if (target == null) failure = "The printer has nowhere to write to"
      }
      ready.countDown()
    }

    override fun onCharacteristicWrite(
      gatt: BluetoothGatt,
      characteristic: BluetoothGattCharacteristic,
      status: Int,
    ) {
      writeStatus = status
      written?.countDown()
    }

    @Suppress("DEPRECATION")
    fun write(gatt: BluetoothGatt, c: BluetoothGattCharacteristic, piece: ByteArray, type: Int) {
      failure?.let { throw PrintFailure(it) }
      val latch = CountDownLatch(1)
      written = latch
      // A write can be refused while the previous one is still in flight: retry briefly.
      var started = false
      for (i in 0 until 50) {
        started =
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            gatt.writeCharacteristic(c, piece, type) == BluetoothStatusCodes.SUCCESS
          } else {
            c.writeType = type
            c.value = piece
            gatt.writeCharacteristic(c)
          }
        if (started) break
        Thread.sleep(20)
      }
      if (!started) throw PrintFailure("The printer stopped taking data")
      await(latch, "write")
      failure?.let { throw PrintFailure(it) }
      if (writeStatus != BluetoothGatt.GATT_SUCCESS) {
        throw PrintFailure("The printer refused the data (status $writeStatus)")
      }
    }
  }

  /** A known printer characteristic if there is one, else the first writable one. */
  private fun writable(gatt: BluetoothGatt): BluetoothGattCharacteristic? {
    val all = gatt.services.flatMap { it.characteristics }
    val canWrite = { c: BluetoothGattCharacteristic ->
      c.properties and
        (BluetoothGattCharacteristic.PROPERTY_WRITE or
          BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0
    }
    return all.firstOrNull { it.uuid in KNOWN_PRINTER_CHARACTERISTICS && canWrite(it) }
      ?: all.firstOrNull(canWrite)
  }

  companion object {
    /** Serial Port Profile: what classic Bluetooth receipt printers speak. */
    val SPP: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
    private const val LE_TIMEOUT_S = 15L
    private val KNOWN_PRINTER_CHARACTERISTICS =
      setOf(
        // Most generic thermal printers (service 18F0).
        UUID.fromString("00002af1-0000-1000-8000-00805f9b34fb"),
        // Another common one (service FF00 / FFE0).
        UUID.fromString("0000ff02-0000-1000-8000-00805f9b34fb"),
        UUID.fromString("0000ffe1-0000-1000-8000-00805f9b34fb"),
        // ISSC transparent UART, used by several printer modules.
        UUID.fromString("49535343-8841-43f4-a8d4-ecbe34729bb3"),
      )
    private val PRINTER_NAME_HINTS =
      listOf("print", "pos", "rpp", "mtp", "rp5", "rp8", "tvs", "epson", "xp-", "bt-")
  }
}
