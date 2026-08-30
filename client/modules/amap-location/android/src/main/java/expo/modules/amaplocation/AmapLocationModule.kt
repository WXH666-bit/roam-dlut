package expo.modules.amaplocation

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import com.amap.api.location.AMapLocation
import com.amap.api.location.AMapLocationClient
import com.amap.api.location.AMapLocationClientOption
import com.amap.apis.utils.core.api.AMapUtilCoreApi
import expo.modules.core.arguments.ReadableArguments
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val AMAP_API_KEY_METADATA = "com.amap.api.v2.apikey"
private const val DEFAULT_INTERVAL_MS = 2_000L
private const val MIN_INTERVAL_MS = 1_000L
private const val MAX_INTERVAL_MS = 30_000L

/** Android-only bridge around AMap's fused GPS/Wi-Fi/cell location SDK. */
class AmapLocationModule : Module() {
  private val mainHandler = Handler(Looper.getMainLooper())
  private var locationClient: AMapLocationClient? = null

  override fun definition() = ModuleDefinition {
    Name("AmapLocation")
    Events("onLocation", "onError")

    AsyncFunction("isConfigured") {
      hasApiKey(requireContext())
    }

    AsyncFunction("start") { arguments: ReadableArguments, promise: Promise ->
      val privacyAccepted = arguments.getBoolean("privacyAccepted", false)
      val requestedInterval = arguments.getDouble("intervalMs", DEFAULT_INTERVAL_MS.toDouble())
      val intervalMs = if (requestedInterval.isFinite()) {
        requestedInterval.toLong().coerceIn(MIN_INTERVAL_MS, MAX_INTERVAL_MS)
      } else {
        DEFAULT_INTERVAL_MS
      }

      mainHandler.post {
        try {
          promise.resolve(startInternal(privacyAccepted, intervalMs))
        } catch (error: Throwable) {
          promise.reject("E_AMAP_LOCATION_START", error.message ?: "AMap location failed to start", error)
        }
      }
    }

    AsyncFunction("stop") { promise: Promise ->
      mainHandler.post {
        destroyClient()
        promise.resolve()
      }
    }

    OnDestroy {
      mainHandler.post { destroyClient() }
    }
  }

  private fun startInternal(privacyAccepted: Boolean, intervalMs: Long): Boolean {
    val context = requireContext()
    if (!privacyAccepted) throw SecurityException("AMap privacy consent is required")
    if (!hasApiKey(context)) return false
    if (context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
      throw SecurityException("Precise location permission is required")
    }

    destroyClient()
    AMapLocationClient.updatePrivacyShow(context, true, true)
    AMapLocationClient.updatePrivacyAgree(context, true)
    AMapUtilCoreApi.setCollectInfoEnable(true)

    val client = AMapLocationClient(context)
    val option = AMapLocationClientOption().apply {
      setLocationMode(AMapLocationClientOption.AMapLocationMode.Hight_Accuracy)
      setInterval(intervalMs)
      setNeedAddress(false)
      setMockEnable(false)
      // Indoor network accuracy depends on a fresh AP list. AMap defaults this
      // to false; active scans trade a little power for materially better fixes.
      setWifiActiveScan(true)
      // A cached coordinate may look precise while being unsafe for a 50 m action.
      setLocationCacheEnable(false)
      setHttpTimeOut(8_000L)
    }
    client.setLocationOption(option)
    client.setLocationListener { location -> handleLocation(location) }
    locationClient = client
    client.startLocation()
    return true
  }

  private fun handleLocation(location: AMapLocation?) {
    if (location == null) return
    if (location.errorCode != 0) {
      sendEvent("onError", Bundle().apply {
        putInt("code", location.errorCode)
        putString("message", location.errorInfo ?: "AMap location error")
      })
      return
    }

    val coordinateSystem = if (
      AMapLocation.COORD_TYPE_WGS84.equals(location.coordType, ignoreCase = true)
    ) {
      "wgs84"
    } else {
      "gcj02"
    }
    sendEvent("onLocation", Bundle().apply {
      putDouble("lat", location.latitude)
      putDouble("lng", location.longitude)
      putDouble("accuracy", location.accuracy.toDouble())
      putDouble("timestamp", location.time.toDouble())
      putString("coordinateSystem", coordinateSystem)
      putInt("locationType", location.locationType)
      putBoolean("isLive", isLiveLocationType(location.locationType))
    })
  }

  private fun isLiveLocationType(locationType: Int): Boolean = when (locationType) {
    AMapLocation.LOCATION_TYPE_FIX_CACHE,
    AMapLocation.LOCATION_TYPE_OFFLINE,
    AMapLocation.LOCATION_TYPE_LAST_LOCATION_CACHE,
    AMapLocation.LOCATION_TYPE_COARSE_LOCATION -> false
    else -> true
  }

  private fun destroyClient() {
    val client = locationClient ?: return
    locationClient = null
    runCatching { client.stopLocation() }
    runCatching { client.onDestroy() }
  }

  private fun hasApiKey(context: Context): Boolean = runCatching {
    @Suppress("DEPRECATION")
    val applicationInfo = context.packageManager.getApplicationInfo(
      context.packageName,
      PackageManager.GET_META_DATA
    )
    applicationInfo.metaData?.getString(AMAP_API_KEY_METADATA)?.isNotBlank() == true
  }.getOrDefault(false)

  private fun requireContext(): Context =
    appContext.reactContext?.applicationContext
      ?: throw IllegalStateException("React context is unavailable")
}
