package expo.modules.backgroundguardian

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import com.amap.api.location.AMapLocation
import com.amap.api.location.AMapLocationClient
import com.amap.api.location.AMapLocationClientOption
import com.amap.apis.utils.core.api.AMapUtilCoreApi
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Background AMap owner with a silence watchdog.
 *
 * Reported accuracy is deliberately not part of provider health: an indoor
 * 58 m fix means AMap is alive, but it is still rejected later by the 30 m
 * proximity gate. Framework providers start only when AMap cannot run, emits
 * an error, or stops delivering fresh live results.
 */
internal class BackgroundAmapLocationEngine(
  private val context: Context,
  private val workerHandler: Handler,
  private val onLocation: (Long, Location) -> Unit,
  private val onUnusableResult: (Long) -> Unit,
  private val onUnavailable: (Long) -> Unit,
) {
  companion object {
    private const val LOCATION_INTERVAL_MS = 2_000L
    private const val HTTP_TIMEOUT_MS = 8_000L
    private const val LIVE_RESULT_TIMEOUT_MS = 12_000L
    private const val MAX_LOCATION_AGE_MS = 60_000L
    private const val MAX_LOCATION_FUTURE_MS = 5_000L
    private const val GCJ_ELLIPSOID_A = 6378245.0
    private const val GCJ_ECCENTRICITY_SQUARED = 0.006693421622965943
  }

  private val mainHandler = Handler(Looper.getMainLooper())
  private var client: AMapLocationClient? = null
  private var generation = 0L
  private var watchdog: Runnable? = null

  /** AMap requires client construction and lifecycle calls on the main looper. */
  fun start(ownershipToken: Long) {
    if (Looper.myLooper() == Looper.getMainLooper()) startOnMain(ownershipToken)
    else mainHandler.post { startOnMain(ownershipToken) }
  }

  fun stop() {
    if (Looper.myLooper() == Looper.getMainLooper()) stopOnMain()
    else mainHandler.post { stopOnMain() }
  }

  private fun startOnMain(ownershipToken: Long) {
    stopOnMain()
    if (context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
      notifyUnavailable(ownershipToken)
      return
    }

    val token = generation
    try {
      AMapLocationClient.updatePrivacyShow(context, true, true)
      AMapLocationClient.updatePrivacyAgree(context, true)
      AMapUtilCoreApi.setCollectInfoEnable(true)
      val nextClient = AMapLocationClient(context)
      val option = AMapLocationClientOption().apply {
        setLocationMode(AMapLocationClientOption.AMapLocationMode.Hight_Accuracy)
        setInterval(LOCATION_INTERVAL_MS)
        setNeedAddress(false)
        setMockEnable(false)
        setWifiActiveScan(true)
        setLocationCacheEnable(false)
        setHttpTimeOut(HTTP_TIMEOUT_MS)
      }
      nextClient.setLocationOption(option)
      nextClient.setLocationListener { raw ->
        mainHandler.post { handleLocation(token, ownershipToken, raw) }
      }
      client = nextClient
      armWatchdog(token, ownershipToken)
      nextClient.startLocation()
    } catch (_: Throwable) {
      stopOnMain()
      notifyUnavailable(ownershipToken)
    }
  }

  private fun stopOnMain() {
    generation += 1
    watchdog?.let(mainHandler::removeCallbacks)
    watchdog = null
    val activeClient = client
    client = null
    if (activeClient != null) {
      runCatching { activeClient.stopLocation() }
      runCatching { activeClient.onDestroy() }
    }
  }

  private fun handleLocation(token: Long, ownershipToken: Long, raw: AMapLocation?) {
    if (token != generation || client == null) return
    if (raw == null || raw.errorCode != 0) {
      fail(token, ownershipToken)
      return
    }
    if (!isFreshLiveResult(raw)) {
      notifyUnusable(ownershipToken)
      return
    }
    val normalizedLocation = toWgs84Location(raw)
    if (normalizedLocation == null) {
      notifyUnusable(ownershipToken)
      return
    }

    // A live result, including a coarse 58 m indoor result, proves that AMap is
    // still the working primary provider. Keep it selected and rearm silence
    // detection; the service's separate 30 m gate decides whether it is safe.
    armWatchdog(token, ownershipToken)
    workerHandler.post { onLocation(ownershipToken, normalizedLocation) }
  }

  private fun fail(token: Long, ownershipToken: Long) {
    if (token != generation || client == null) return
    stopOnMain()
    notifyUnavailable(ownershipToken)
  }

  private fun armWatchdog(token: Long, ownershipToken: Long) {
    watchdog?.let(mainHandler::removeCallbacks)
    val task = Runnable {
      if (token == generation && client != null) fail(token, ownershipToken)
    }
    watchdog = task
    mainHandler.postDelayed(task, LIVE_RESULT_TIMEOUT_MS)
  }

  private fun notifyUnusable(ownershipToken: Long) {
    workerHandler.post { onUnusableResult(ownershipToken) }
  }

  private fun notifyUnavailable(ownershipToken: Long) {
    workerHandler.post { onUnavailable(ownershipToken) }
  }

  private fun isFreshLiveResult(location: AMapLocation): Boolean {
    val liveType = when (location.locationType) {
      AMapLocation.LOCATION_TYPE_FIX_CACHE,
      AMapLocation.LOCATION_TYPE_OFFLINE,
      AMapLocation.LOCATION_TYPE_LAST_LOCATION_CACHE,
      AMapLocation.LOCATION_TYPE_COARSE_LOCATION -> false
      else -> true
    }
    if (!liveType) return false
    val now = System.currentTimeMillis()
    return location.time >= now - MAX_LOCATION_AGE_MS &&
      location.time <= now + MAX_LOCATION_FUTURE_MS
  }

  private fun toWgs84Location(location: AMapLocation): Location? {
    if (
      !location.latitude.isFinite() ||
      !location.longitude.isFinite() ||
      location.latitude !in -90.0..90.0 ||
      location.longitude !in -180.0..180.0
    ) return null
    val coordinate = if (
      AMapLocation.COORD_TYPE_WGS84.equals(location.coordType, ignoreCase = true)
    ) {
      GeographicCoordinate(location.latitude, location.longitude)
    } else {
      gcj02ToWgs84(location.latitude, location.longitude)
    }
    if (
      !coordinate.lat.isFinite() ||
      !coordinate.lng.isFinite() ||
      coordinate.lat !in -90.0..90.0 ||
      coordinate.lng !in -180.0..180.0
    ) return null
    return Location("amap").apply {
      latitude = coordinate.lat
      longitude = coordinate.lng
      time = location.time.takeIf { it > 0L } ?: System.currentTimeMillis()
      elapsedRealtimeNanos = SystemClock.elapsedRealtimeNanos()
      val reportedAccuracy = location.accuracy
      if (reportedAccuracy.isFinite() && reportedAccuracy >= 0f) accuracy = reportedAccuracy
    }
  }

  private data class GeographicCoordinate(val lat: Double, val lng: Double)

  private fun isOutsideGcjCoverage(lat: Double, lng: Double): Boolean =
    lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271

  private fun transformGcjLatitude(x: Double, y: Double): Double {
    var value = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * sqrt(abs(x))
    value += (20 * sin(6 * x * PI) + 20 * sin(2 * x * PI)) * 2 / 3
    value += (20 * sin(y * PI) + 40 * sin(y / 3 * PI)) * 2 / 3
    value += (160 * sin(y / 12 * PI) + 320 * sin(y * PI / 30)) * 2 / 3
    return value
  }

  private fun transformGcjLongitude(x: Double, y: Double): Double {
    var value = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * sqrt(abs(x))
    value += (20 * sin(6 * x * PI) + 20 * sin(2 * x * PI)) * 2 / 3
    value += (20 * sin(x * PI) + 40 * sin(x / 3 * PI)) * 2 / 3
    value += (150 * sin(x / 12 * PI) + 300 * sin(x / 30 * PI)) * 2 / 3
    return value
  }

  private fun wgs84ToGcj02(lat: Double, lng: Double): GeographicCoordinate {
    if (isOutsideGcjCoverage(lat, lng)) return GeographicCoordinate(lat, lng)
    var latitudeDelta = transformGcjLatitude(lng - 105, lat - 35)
    var longitudeDelta = transformGcjLongitude(lng - 105, lat - 35)
    val latitudeRadians = lat / 180 * PI
    val latitudeSin = sin(latitudeRadians)
    val magic = 1 - GCJ_ECCENTRICITY_SQUARED * latitudeSin * latitudeSin
    val magicRoot = sqrt(magic)
    latitudeDelta = latitudeDelta * 180 /
      ((GCJ_ELLIPSOID_A * (1 - GCJ_ECCENTRICITY_SQUARED)) / (magic * magicRoot) * PI)
    longitudeDelta = longitudeDelta * 180 /
      (GCJ_ELLIPSOID_A / magicRoot * cos(latitudeRadians) * PI)
    return GeographicCoordinate(lat + latitudeDelta, lng + longitudeDelta)
  }

  private fun gcj02ToWgs84(lat: Double, lng: Double): GeographicCoordinate {
    if (isOutsideGcjCoverage(lat, lng)) return GeographicCoordinate(lat, lng)
    var latitudeLow = lat - 0.01
    var latitudeHigh = lat + 0.01
    var longitudeLow = lng - 0.01
    var longitudeHigh = lng + 0.01
    var candidate = GeographicCoordinate(lat, lng)

    repeat(32) {
      candidate = GeographicCoordinate(
        (latitudeLow + latitudeHigh) / 2,
        (longitudeLow + longitudeHigh) / 2,
      )
      val projected = wgs84ToGcj02(candidate.lat, candidate.lng)
      if (projected.lat > lat) latitudeHigh = candidate.lat else latitudeLow = candidate.lat
      if (projected.lng > lng) longitudeHigh = candidate.lng else longitudeLow = candidate.lng
    }
    return candidate
  }
}
