package app.restroos.client

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.DownloadManager
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.webkit.CookieManager
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.TextView
import app.restroos.client.core.HubAddress
import kotlin.concurrent.thread

/**
 * The whole app: asks once for the Hub's address, then shows the Hub's web
 * app full screen (docs/adr/0012-android-client.md). The web app does the
 * rest; this adds Bluetooth printing, file saving, a kept-awake screen and
 * an optional kiosk pin.
 */
class MainActivity : Activity() {
  private lateinit var store: HubStore
  private lateinit var web: WebView
  private lateinit var bridge: WebBridge
  private var hubUrl: String? = null
  private var fileChooser: ValueCallback<Array<Uri>>? = null
  /** The main page failed to load; cleared when a load succeeds. */
  private var mainFrameFailed = false

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setContentView(R.layout.activity_main)
    // Kitchen screens and POS counters stay on all service.
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    store = HubStore(this)
    web = findViewById(R.id.web)
    bridge = WebBridge(this, web, BluetoothPrinters(this))
    setUpWebView()
    setUpConnectForm()
    findViewById<Button>(R.id.retry).setOnClickListener { hubUrl?.let(::openHub) }
    findViewById<Button>(R.id.change).setOnClickListener {
      store.forget()
      showConnect()
    }

    // `adb shell am start -n app.restroos.client/.MainActivity -e hubURL http://10.0.2.2:7400`
    intent?.getStringExtra(EXTRA_HUB_URL)?.let(HubAddress::normalize)?.let(store::use)
    val saved = store.url
    if (saved == null) showConnect() else openHub(saved)
  }

  override fun onResume() {
    super.onResume()
    web.onResume()
    if (store.kiosk && hubUrl != null) startKiosk()
  }

  override fun onPause() {
    web.onPause()
    CookieManager.getInstance().flush()
    super.onPause()
  }

  override fun onDestroy() {
    bridge.shutdown()
    web.destroy()
    super.onDestroy()
  }

  // ---- connect --------------------------------------------------------------------

  private fun setUpConnectForm() {
    val address = findViewById<EditText>(R.id.address)
    val button = findViewById<Button>(R.id.connect_button)
    address.setText(store.lastAddress?.removePrefix("http://") ?: "")
    findViewById<CheckBox>(R.id.kiosk).isChecked = store.kiosk
    button.setOnClickListener { connect() }
    address.setOnEditorActionListener { _, action, _ ->
      if (action == EditorInfo.IME_ACTION_GO) {
        connect()
        true
      } else false
    }
  }

  private fun connect() {
    val address = findViewById<EditText>(R.id.address)
    val button = findViewById<Button>(R.id.connect_button)
    val error = findViewById<TextView>(R.id.connect_error)
    val url = HubAddress.normalize(address.text.toString())
    if (url == null) {
      showError(error, getString(R.string.connect_invalid))
      return
    }
    error.visibility = View.GONE
    button.isEnabled = false
    button.setText(R.string.connect_checking)
    thread(name = "hub-check") {
      val check = HubCheck.run(url)
      runOnUiThread {
        button.isEnabled = true
        button.setText(R.string.connect_button)
        when (check) {
          HubCheck.OK -> {
            store.use(url)
            store.kiosk = findViewById<CheckBox>(R.id.kiosk).isChecked
            openHub(url)
          }
          HubCheck.UNREACHABLE -> showError(error, getString(R.string.connect_unreachable, url))
          HubCheck.NOT_A_HUB -> showError(error, getString(R.string.connect_not_hub, url))
        }
      }
    }
  }

  private fun showError(view: TextView, message: String) {
    view.text = message
    view.visibility = View.VISIBLE
  }

  private fun showConnect() {
    stopKiosk()
    hubUrl = null
    web.visibility = View.GONE
    web.loadUrl("about:blank")
    findViewById<View>(R.id.unreachable).visibility = View.GONE
    findViewById<View>(R.id.connect).visibility = View.VISIBLE
    findViewById<EditText>(R.id.address).apply {
      setText(store.lastAddress?.removePrefix("http://") ?: "")
      requestFocus()
    }
  }

  // ---- the Hub's web app ----------------------------------------------------------

  private fun openHub(url: String) {
    hubUrl = url
    mainFrameFailed = false
    findViewById<View>(R.id.connect).visibility = View.GONE
    findViewById<View>(R.id.unreachable).visibility = View.GONE
    web.visibility = View.VISIBLE
    if (web.url?.let { HubAddress.isOnHub(url, it) } == true) web.reload() else web.loadUrl(url)
    if (store.kiosk) startKiosk()
  }

  private fun showUnreachable() {
    val url = hubUrl ?: return
    findViewById<TextView>(R.id.unreachable_body).text =
      getString(R.string.hub_unreachable_body, url)
    findViewById<View>(R.id.unreachable).visibility = View.VISIBLE
  }

  @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
  private fun setUpWebView() {
    CookieManager.getInstance().setAcceptCookie(true)
    web.settings.apply {
      javaScriptEnabled = true
      domStorageEnabled = true
      // The kitchen display chimes for new tickets without a tap first.
      mediaPlaybackRequiresUserGesture = false
      cacheMode = WebSettings.LOAD_DEFAULT
      setSupportZoom(false)
      builtInZoomControls = false
      textZoom = 100
      userAgentString = "$userAgentString RestroOSAndroid/${BuildConfig.VERSION_NAME}"
    }
    WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
    web.addJavascriptInterface(bridge, "RestroAndroid")
    web.webViewClient =
      object : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
          val target = request.url.toString()
          val hub = hubUrl ?: return false
          val scheme = request.url.scheme?.lowercase()
          if (scheme == "blob" || scheme == "data" || scheme == "about") return false
          if (HubAddress.isOnHub(hub, target)) return false
          // Anything that isn't the Hub (a help page, a UPI link) opens outside the app.
          runCatching { startActivity(Intent(Intent.ACTION_VIEW, request.url)) }
          return true
        }

        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
          mainFrameFailed = false
        }

        override fun onPageFinished(view: WebView, url: String?) {
          if (!mainFrameFailed) findViewById<View>(R.id.unreachable).visibility = View.GONE
        }

        override fun onReceivedError(
          view: WebView,
          request: WebResourceRequest,
          error: WebResourceError,
        ) {
          if (!request.isForMainFrame) return
          mainFrameFailed = true
          showUnreachable()
        }

        /** The renderer was killed (memory pressure): start again rather than crash. */
        override fun onRenderProcessGone(
          view: WebView,
          detail: android.webkit.RenderProcessGoneDetail,
        ): Boolean {
          recreate()
          return true
        }
      }
    web.webChromeClient =
      object : WebChromeClient() {
        override fun onShowFileChooser(
          view: WebView,
          callback: ValueCallback<Array<Uri>>,
          params: FileChooserParams,
        ): Boolean {
          fileChooser?.onReceiveValue(null)
          fileChooser = callback
          return try {
            startActivityForResult(params.createIntent(), REQUEST_FILE)
            true
          } catch (_: Exception) {
            fileChooser = null
            false
          }
        }
      }
    // Files the Hub serves as downloads (with the session cookie): the system downloader.
    web.setDownloadListener { url, userAgent, disposition, mimeType, _ ->
      if (url.startsWith("blob:") || url.startsWith("data:")) return@setDownloadListener
      runCatching {
        val name = URLUtil.guessFileName(url, disposition, mimeType)
        val request =
          DownloadManager.Request(Uri.parse(url))
            .setMimeType(mimeType)
            .addRequestHeader("Cookie", CookieManager.getInstance().getCookie(url) ?: "")
            .addRequestHeader("User-Agent", userAgent)
            .setTitle(name)
            .setNotificationVisibility(
              DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED
            )
            .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
        getSystemService(DownloadManager::class.java).enqueue(request)
      }
    }
  }

  // The plain Activity result callback: the app has no AndroidX dependency.
  override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    if (requestCode == REQUEST_FILE) {
      fileChooser?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
      fileChooser = null
      return
    }
    super.onActivityResult(requestCode, resultCode, data)
  }

  override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
    if (keyCode == KeyEvent.KEYCODE_BACK && web.visibility == View.VISIBLE && web.canGoBack()) {
      web.goBack()
      return true
    }
    return super.onKeyDown(keyCode, event)
  }

  // ---- Bluetooth permission and kiosk -----------------------------------------------

  /** Android 12+: "Nearby devices", asked for the first time the web app prints or lists printers. */
  fun askForBluetooth() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
    runOnUiThread {
      if (checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) !=
        PackageManager.PERMISSION_GRANTED
      ) {
        requestPermissions(arrayOf(Manifest.permission.BLUETOOTH_CONNECT), REQUEST_BLUETOOTH)
      }
    }
  }

  /** Screen pinning: staff can't leave the app without the unpin gesture (and PIN, if set). */
  private fun startKiosk() {
    runCatching { startLockTask() }
  }

  private fun stopKiosk() {
    runCatching { stopLockTask() }
  }

  companion object {
    const val EXTRA_HUB_URL = "hubURL"
    private const val REQUEST_FILE = 1
    private const val REQUEST_BLUETOOTH = 2
  }
}
