package expo.modules.backgroundguardian

import android.Manifest
import android.app.ActivityManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.SystemClock
import androidx.core.content.PermissionChecker
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * A small Android-framework-only guardian service.
 *
 * It intentionally uses LocationManager rather than Expo Location's fused
 * provider. This keeps the Honor/MagicOS path independent of Google Play
 * Services while still allowing standard Android devices to use GPS/network
 * providers. Coordinates are consumed as raw WGS-84 latitude/longitude; no
 * GCJ-02 or other map-provider conversion is applied. The service is sticky,
 * and all state needed to resume polling is stored in SharedPreferences.
 */
class BackgroundGuardianService : Service() {
  companion object {
    const val ACTION_START = "expo.modules.backgroundguardian.START"
    const val ACTION_UPDATE = "expo.modules.backgroundguardian.UPDATE"
    const val ACTION_STOP = "expo.modules.backgroundguardian.STOP"

    private const val GUARDIAN_NOTIFICATION_ID = 0xC1D10001.toInt()
    private const val GUARDIAN_CHANNEL_ID = "cidi_guardian"
    private const val NEARBY_CHANNEL_ID = "cidi_nearby"
    private const val LIKE_CHANNEL_ID = "cidi_like"
    private const val LOCATION_INTERVAL_MS = 15_000L
    private const val LOCATION_MIN_DISTANCE_METERS = 5f
    private const val LOCATION_CHECK_THROTTLE_MS = 15_000L
    private const val MAX_LOCATION_ACCURACY_METERS = 30f
    private const val MAX_LOCATION_AGE_MS = 60_000L
    private const val MAX_LOCATION_FUTURE_MS = 5_000L
    private const val CONNECT_TIMEOUT_MS = 10_000
    private const val READ_TIMEOUT_MS = 10_000
    private const val MAX_RESPONSE_BYTES = 512 * 1024
    private const val EVENT_POLL_HANDOFF_TIMEOUT_MS = 25_000L
    private val activeEventPoll = AtomicReference<CountDownLatch?>(null)

    private fun beginEventPoll(context: Context): Boolean {
      if (!BackgroundGuardianStore.isRunning(context)) return false
      val latch = CountDownLatch(1)
      if (!activeEventPoll.compareAndSet(null, latch)) return false
      // Close the tiny check/CAS window against stop(): if ownership was
      // revoked meanwhile, publish no event after JS has read the old cursor.
      if (!BackgroundGuardianStore.isRunning(context)) {
        activeEventPoll.compareAndSet(latch, null)
        latch.countDown()
        return false
      }
      return true
    }

    private fun finishEventPoll() {
      activeEventPoll.getAndSet(null)?.countDown()
    }

    /** Wait off the UI thread until any notification delivery has saved its cursor. */
    internal fun awaitEventPollCompletion() {
      runCatching {
        activeEventPoll.get()?.await(EVENT_POLL_HANDOFF_TIMEOUT_MS, TimeUnit.MILLISECONDS)
      }
    }

    internal fun hasLocationPermission(context: Context): Boolean {
      // PermissionChecker also accounts for app-op/while-in-use restrictions
      // that a plain PackageManager permission check can miss on Android 14.
      val fine = PermissionChecker.checkSelfPermission(
        context,
        Manifest.permission.ACCESS_FINE_LOCATION,
      ) == PermissionChecker.PERMISSION_GRANTED
      val coarse = PermissionChecker.checkSelfPermission(
        context,
        Manifest.permission.ACCESS_COARSE_LOCATION,
      ) == PermissionChecker.PERMISSION_GRANTED
      return fine || coarse
    }

    internal fun hasBackgroundLocationPermission(context: Context): Boolean {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return true
      return PermissionChecker.checkSelfPermission(
        context,
        Manifest.permission.ACCESS_BACKGROUND_LOCATION,
      ) == PermissionChecker.PERMISSION_GRANTED
    }

    internal fun hasLocationServicesEnabled(context: Context): Boolean {
      val manager = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
        ?: return false
      return runCatching {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
          manager.isLocationEnabled
        } else {
          manager.isProviderEnabled(LocationManager.GPS_PROVIDER) ||
            manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
        }
      }.getOrDefault(false)
    }

    fun start(context: Context) {
      if (
        !hasLocationPermission(context) ||
        !hasBackgroundLocationPermission(context) ||
        !hasLocationServicesEnabled(context)
      ) {
        throw SecurityException(
          "foreground/background location permission and system location services are required"
        )
      }
      val intent = Intent(context, BackgroundGuardianService::class.java).apply {
        action = ACTION_START
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }

    fun update(context: Context) {
      val intent = Intent(context, BackgroundGuardianService::class.java).apply {
        action = ACTION_UPDATE
      }
      context.startService(intent)
    }
  }

  private lateinit var workerThread: HandlerThread
  private lateinit var worker: Handler
  private lateinit var locationManager: LocationManager
  private lateinit var notificationManager: NotificationManager

  private var config: GuardianConfig? = null
  private var lastLocation: Location? = null
  private var nextLocationCheckAt = 0L
  private var permissionUnavailable = false

  private val locationListener = object : LocationListener {
    override fun onLocationChanged(location: Location) {
      // Keep only a fresh, useful fix in memory. Coarse provider callbacks are
      // rejected by the 30 m gate before they can displace the current fix.
      if (!rememberBestLocation(location)) return
      val now = SystemClock.elapsedRealtime()
      if (now < nextLocationCheckAt) return
      nextLocationCheckAt = now + LOCATION_CHECK_THROTTLE_MS
      val currentConfig = config ?: return
      lastLocation?.let { fetchNearbyMessages(currentConfig, it) }
    }

    override fun onProviderEnabled(provider: String) {
      if (::worker.isInitialized) worker.post { restartMonitoring() }
    }

    override fun onProviderDisabled(provider: String) {
      if (::worker.isInitialized) worker.post { restartMonitoring() }
    }

    @Suppress("DEPRECATION")
    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
  }

  private val pollRunnable = object : Runnable {
    override fun run() {
      if (!hasGuardianPrerequisites()) {
        BackgroundGuardianStore.setRunning(this@BackgroundGuardianService, false)
        stopSelf()
        return
      }
      pollServer()
      val delay = config?.pollIntervalMs ?: DEFAULT_POLL_INTERVAL_MS
      if (::worker.isInitialized) worker.postDelayed(this, delay)
    }
  }

  override fun onCreate() {
    super.onCreate()
    if (!hasGuardianPrerequisites()) {
      permissionUnavailable = true
      BackgroundGuardianStore.setRunning(this, false)
      stopSelf()
      return
    }
    config = BackgroundGuardianStore.readConfig(this)
    notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    createNotificationChannels()
    if (!startAsForeground()) {
      permissionUnavailable = true
      BackgroundGuardianStore.setRunning(this, false)
      stopSelf()
      return
    }

    BackgroundGuardianStore.setRunning(this, true)
    workerThread = HandlerThread("cidi-background-guardian")
    workerThread.start()
    worker = Handler(workerThread.looper)
    locationManager = getSystemService(Context.LOCATION_SERVICE) as LocationManager
    worker.post { restartMonitoring() }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (permissionUnavailable || !hasGuardianPrerequisites()) {
      BackgroundGuardianStore.setRunning(this, false)
      stopSelf()
      return START_NOT_STICKY
    }
    when (intent?.action) {
      ACTION_STOP -> {
        stopSelf()
        return START_NOT_STICKY
      }
      ACTION_START, ACTION_UPDATE -> {
        if (::worker.isInitialized) {
          worker.post { restartMonitoring() }
        }
      }
      // A sticky restart arrives with a null intent. onCreate already restores
      // the persisted config and starts the monitoring loop in that case.
    }
    return START_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onDestroy() {
    if (::worker.isInitialized) {
      worker.removeCallbacksAndMessages(null)
    }
    if (::locationManager.isInitialized) {
      removeLocationUpdates()
    }
    if (::workerThread.isInitialized) {
      workerThread.quitSafely()
    }
    BackgroundGuardianStore.setRunning(this, false)
    if (::notificationManager.isInitialized) {
      stopForeground(true)
    }
    super.onDestroy()
  }

  private fun restartMonitoring() {
    if (!hasGuardianPrerequisites()) {
      BackgroundGuardianStore.setRunning(this, false)
      stopSelf()
      return
    }
    removeLocationUpdates()
    worker.removeCallbacks(pollRunnable)
    config = BackgroundGuardianStore.readConfig(this)
    lastLocation = null
    nextLocationCheckAt = 0L

    if (config == null) return
    requestLocationUpdates()
    worker.post(pollRunnable)
  }

  private fun hasLocationPermission(): Boolean {
    return Companion.hasLocationPermission(this)
  }

  private fun hasGuardianPrerequisites(): Boolean =
    hasLocationPermission() &&
      Companion.hasBackgroundLocationPermission(this) &&
      Companion.hasLocationServicesEnabled(this)

  private fun requestLocationUpdates() {
    if (!hasLocationPermission()) return

    val providers = listOf(
      LocationManager.GPS_PROVIDER,
      LocationManager.NETWORK_PROVIDER,
    )
    for (provider in providers) {
      val enabled = runCatching { locationManager.isProviderEnabled(provider) }.getOrDefault(false)
      if (!enabled) continue
      try {
        locationManager.requestLocationUpdates(
          provider,
          LOCATION_INTERVAL_MS,
          LOCATION_MIN_DISTANCE_METERS,
          locationListener,
          worker.looper,
        )
        // A recent system-provider fix lets the first server check happen
        // immediately instead of waiting for the next GPS callback.
        val lastKnown = locationManager.getLastKnownLocation(provider)
        if (lastKnown != null) rememberBestLocation(lastKnown)
      } catch (_: SecurityException) {
        // Permission can be revoked while the service is alive. The next
        // foreground start/config update will try again.
      } catch (_: IllegalArgumentException) {
        // A provider may disappear on an OEM build; keep the other provider.
      }
    }

    lastLocation?.let { location ->
      nextLocationCheckAt = SystemClock.elapsedRealtime() + LOCATION_CHECK_THROTTLE_MS
      config?.let { currentConfig -> fetchNearbyMessages(currentConfig, location) }
    }
  }

  private fun isRecentEnough(location: Location, now: Long = System.currentTimeMillis()): Boolean =
    location.time >= now - MAX_LOCATION_AGE_MS &&
      location.time <= now + MAX_LOCATION_FUTURE_MS

  private fun accuracyMeters(location: Location): Float? {
    if (!location.hasAccuracy()) return null
    val accuracy = location.accuracy
    return accuracy.takeIf { it.isFinite() && it >= 0f }
  }

  private fun isUsableLocation(location: Location): Boolean {
    if (!location.latitude.isFinite() || !location.longitude.isFinite()) return false
    if (!isRecentEnough(location)) return false
    // An absent uncertainty is not safe for a 50 m decision.  Framework
    // provider fixes normally carry it; rejecting unknown accuracy prevents a
    // coarse/OEM payload from bypassing the precision gate.
    return accuracyMeters(location)?.let { it <= MAX_LOCATION_ACCURACY_METERS } ?: false
  }

  /** Prefer the newest usable fix; at an equal timestamp keep better accuracy. */
  private fun shouldReplaceLocation(current: Location, candidate: Location): Boolean {
    if (!isUsableLocation(current)) return true
    if (candidate.time > current.time) return true
    if (candidate.time < current.time) return false
    return (accuracyMeters(candidate) ?: Float.MAX_VALUE) <=
      (accuracyMeters(current) ?: Float.MAX_VALUE)
  }

  private fun rememberBestLocation(candidate: Location): Boolean {
    val current = lastLocation
    if (!isUsableLocation(candidate)) {
      // A newer coarse/invalid callback means we no longer know whether the
      // previous precise point still represents the user's current position.
      // Drop it rather than producing a false 50 m alert while the user moves.
      if (current != null && candidate.time > current.time) lastLocation = null
      return false
    }
    if (current != null && !shouldReplaceLocation(current, candidate)) return false
    // Precise coordinates stay in memory only; they are never persisted by the
    // guardian's SharedPreferences store.
    lastLocation = Location(candidate)
    return true
  }

  private fun removeLocationUpdates() {
    if (!::locationManager.isInitialized) return
    try {
      locationManager.removeUpdates(locationListener)
    } catch (_: SecurityException) {
      // Nothing else is needed when access was revoked.
    }
  }

  private fun pollServer() {
    val currentConfig = config ?: return
    // All callbacks and the polling runnable share the worker looper, so the
    // synchronous HTTP calls below cannot overlap one another.
    lastLocation?.let { fetchNearbyMessages(currentConfig, it) }
    fetchNotificationEvents(currentConfig)
  }

  private fun fetchNearbyMessages(currentConfig: GuardianConfig, location: Location) {
    // Approximate/coarse or stale fixes can be hundreds of metres away. It is
    // safer to wait for a usable fix than to tell the user a message is within
    // 50 m.
    if (!isUsableLocation(location)) return
    val root = getJson(apiUrl(currentConfig, "/messages"), currentConfig.deviceToken) ?: return
    val reminded = BackgroundGuardianStore.readRemindedMessageIds(this)
    var changed = false
    for (message in records(root)) {
      val id = message.optString("id", "").trim()
      if (id.isEmpty() || id in currentConfig.readIds || id in reminded) continue

      val lat = number(message, "lat", "latitude") ?: continue
      val lng = number(message, "lng", "longitude") ?: continue
      if (haversineMeters(location.latitude, location.longitude, lat, lng) > currentConfig.radiusMeters) {
        continue
      }

      // The service's own foreground notification makes the process appear as
      // IMPORTANCE_FOREGROUND_SERVICE. Only an actually visible Activity is
      // treated as foreground, so stale JS state cannot swallow a later alert.
      if (!isAppUiForeground()) {
        postNearbyNotification(id)
        reminded += id
        changed = true
      }
    }
    if (changed) BackgroundGuardianStore.saveRemindedMessageIds(this, reminded)
  }

  private fun fetchNotificationEvents(currentConfig: GuardianConfig) {
    if (!beginEventPoll(this)) return
    try {
      val afterId = BackgroundGuardianStore.readLastEventId(this)
      val encodedDeviceId = URLEncoder.encode(currentConfig.deviceId, StandardCharsets.UTF_8.name())
      val path = "/notifications?device_id=$encodedDeviceId&after_id=$afterId"
      val root = getJson(apiUrl(currentConfig, path), currentConfig.deviceToken) ?: return

      val cursorInitialized = BackgroundGuardianStore.isEventCursorInitialized(this)
      var latestId = afterId
      var playForegroundSound = false
      val events = records(root).sortedBy { it.optLong("id", Long.MIN_VALUE) }
      val advertisedLatestId = (root as? JSONObject)?.optLong("latest_id", afterId) ?: afterId

      // A newly-installed service must not replay every historical like. The
      // first successful response establishes the cursor (including zero for an
      // empty inbox), then only newer events are eligible for notifications.
      if (!cursorInitialized) {
        if (advertisedLatestId > latestId) latestId = advertisedLatestId
        for (event in events) {
          val eventId = event.optLong("id", Long.MIN_VALUE)
          if (eventId > latestId) latestId = eventId
        }
        BackgroundGuardianStore.saveLastEventId(this, latestId)
        BackgroundGuardianStore.setEventCursorInitialized(this, true)
        return
      }

      for (event in events) {
        val eventId = event.optLong("id", Long.MIN_VALUE)
        if (eventId <= afterId) continue

        val type = event.optString("type", "")
        val messageId = event.optString("message_id", "").ifBlank {
          event.optString("messageId", "")
        }.trim()
        if (type == "message_like" && messageId.isNotEmpty()) {
          if (isAppUiForeground()) {
            playForegroundSound = true
          } else {
            postLikeNotification(messageId, eventId)
          }
        }
        // Advance the cursor even while the app is foreground so an event cannot
        // be replayed as a system banner after the next background transition.
        if (eventId > latestId) latestId = eventId
      }
      if (playForegroundSound) playLikeSound()
      if (latestId > afterId) BackgroundGuardianStore.saveLastEventId(this, latestId)
    } finally {
      finishEventPoll()
    }
  }

  private fun playLikeSound() {
    runCatching {
      val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
      RingtoneManager.getRingtone(this, uri)?.play()
    }
  }

  private fun isAppUiForeground(): Boolean {
    val state = ActivityManager.RunningAppProcessInfo()
    ActivityManager.getMyMemoryState(state)
    return state.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
  }

  /**
   * Parse both the current `{list: [...]}` API envelope and a plain array.
   * The extra keys make this worker tolerant of a rolling server deployment.
   */
  private fun records(root: Any?): List<JSONObject> {
    val array = when (root) {
      is JSONArray -> root
      is JSONObject -> root.optJSONArray("list")
        ?: root.optJSONArray("events")
        ?: root.optJSONArray("notifications")
        ?: root.optJSONArray("data")
      else -> null
    } ?: return emptyList()

    val result = ArrayList<JSONObject>(array.length())
    for (index in 0 until array.length()) {
      array.optJSONObject(index)?.let(result::add)
    }
    return result
  }

  private fun number(json: JSONObject, vararg names: String): Double? {
    for (name in names) {
      val value = json.optDouble(name, Double.NaN)
      if (value.isFinite()) return value
    }
    return null
  }

  private fun apiUrl(currentConfig: GuardianConfig, path: String): String {
    val base = currentConfig.baseUrl.trimEnd('/')
    val apiBase = when {
      base.endsWith("/api/v1") -> base
      base.endsWith("/api") -> "$base/v1"
      else -> "$base/api/v1"
    }
    return "$apiBase$path"
  }

  private fun getJson(url: String, token: String?): Any? {
    val connection = try {
      (URL(url).openConnection() as HttpURLConnection).apply {
        requestMethod = "GET"
        connectTimeout = CONNECT_TIMEOUT_MS
        readTimeout = READ_TIMEOUT_MS
        useCaches = false
        setRequestProperty("Accept", "application/json")
        if (!token.isNullOrBlank()) setRequestProperty("x-device-token", token)
      }
    } catch (_: Exception) {
      return null
    }

    return try {
      val status = connection.responseCode
      if (status !in 200..299) return null
      val stream = connection.inputStream
      val reader = BufferedReader(InputStreamReader(stream, StandardCharsets.UTF_8))
      val builder = StringBuilder()
      var total = 0
      while (true) {
        val line = reader.readLine() ?: break
        total += line.toByteArray(StandardCharsets.UTF_8).size + 1
        if (total > MAX_RESPONSE_BYTES) return null
        builder.append(line)
      }
      JSONTokener(builder.toString()).nextValue()
    } catch (_: Exception) {
      null
    } finally {
      connection.disconnect()
    }
  }

  private fun createNotificationChannels() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

    val guardian = NotificationChannel(
      GUARDIAN_CHANNEL_ID,
      "守候服务",
      NotificationManager.IMPORTANCE_LOW,
    ).apply {
      description = "持续守候附近留言与互动"
      setShowBadge(false)
      setSound(null, null)
    }
    val nearby = NotificationChannel(
      NEARBY_CHANNEL_ID,
      "附近留言",
      NotificationManager.IMPORTANCE_DEFAULT,
    ).apply {
      description = "附近有新的未读留言时提醒"
      setSound(null, null)
    }
    val like = NotificationChannel(
      LIKE_CHANNEL_ID,
      "留言互动",
      NotificationManager.IMPORTANCE_DEFAULT,
    ).apply {
      description = "有人喜欢你的留言时提醒"
      val sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
      val attributes = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_NOTIFICATION)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .build()
      setSound(sound, attributes)
    }
    notificationManager.createNotificationChannels(listOf(guardian, nearby, like))
  }

  private fun startAsForeground(): Boolean {
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, GUARDIAN_CHANNEL_ID)
    } else {
      Notification.Builder(this)
    }
    val notification = builder
      .setSmallIcon(smallIcon())
      .setContentTitle("Here 正在守候")
      .setContentText("正在守候附近留言和互动")
      .setContentIntent(appPendingIntent(null, null))
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setShowWhen(false)
      .setCategory(Notification.CATEGORY_SERVICE)
      .build()

    return try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(
          GUARDIAN_NOTIFICATION_ID,
          notification,
          ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION,
        )
      } else {
        startForeground(GUARDIAN_NOTIFICATION_ID, notification)
      }
      true
    } catch (_: SecurityException) {
      // Location may be switched off between the JS preflight and service
      // creation. Stop cleanly instead of entering a sticky crash loop.
      false
    }
  }

  private fun smallIcon(): Int = R.drawable.cidi_notification

  private fun postNearbyNotification(messageId: String) {
    val notification = notificationBuilder(
      NEARBY_CHANNEL_ID,
      "附近有一条新留言",
      "打开应用查看附近的留言",
      "nearby_message",
      messageId,
      withSound = false,
    )
    notificationManager.notify(notificationId("nearby", messageId), notification)
  }

  private fun postLikeNotification(messageId: String, eventId: Long) {
    val notification = notificationBuilder(
      LIKE_CHANNEL_ID,
      "有人喜欢了你的留言",
      "打开应用查看互动",
      "message_like",
      messageId,
      withSound = true,
    )
    notificationManager.notify(notificationId("like", "$eventId:$messageId"), notification)
  }

  private fun notificationBuilder(
    channelId: String,
    title: String,
    text: String,
    notificationType: String,
    messageId: String,
    withSound: Boolean,
  ): Notification {
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, channelId)
    } else {
      Notification.Builder(this)
    }
    builder
      .setSmallIcon(smallIcon())
      .setContentTitle(title)
      .setContentText(text)
      .setContentIntent(appPendingIntent(notificationType, messageId))
      .setAutoCancel(true)
      .setCategory(Notification.CATEGORY_MESSAGE)
      .setShowWhen(true)
    if (withSound && Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      builder.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION))
      builder.setDefaults(Notification.DEFAULT_SOUND)
    }
    return builder.build()
  }

  private fun appPendingIntent(notificationType: String?, messageId: String?): PendingIntent? {
    val launchIntent = packageManager.getLaunchIntentForPackage(packageName) ?: return null
    val deepLink = if (!notificationType.isNullOrBlank() && !messageId.isNullOrBlank()) {
      "cidi:///?notificationType=${Uri.encode(notificationType)}&messageId=${Uri.encode(messageId)}"
    } else {
      "cidi:///"
    }
    launchIntent.action = Intent.ACTION_VIEW
    launchIntent.data = Uri.parse(deepLink)
    launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)

    var flags = PendingIntent.FLAG_UPDATE_CURRENT
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      flags = flags or PendingIntent.FLAG_IMMUTABLE
    }
    return PendingIntent.getActivity(
      this,
      notificationId("intent", "$notificationType:$messageId"),
      launchIntent,
      flags,
    )
  }

  private fun notificationId(prefix: String, value: String): Int {
    val hash = ("$prefix:$value").hashCode() and 0x0FFFFFFF
    return 0x10000000 or hash
  }

  private fun haversineMeters(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
    val earthRadiusMeters = 6_371_000.0
    val dLat = Math.toRadians(lat2 - lat1)
    val dLng = Math.toRadians(lng2 - lng1)
    val a = sin(dLat / 2) * sin(dLat / 2) +
      cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) *
      sin(dLng / 2) * sin(dLng / 2)
    return earthRadiusMeters * 2 * atan2(sqrt(a), sqrt(1 - a))
  }
}
