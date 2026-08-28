package expo.modules.backgroundguardian

import android.content.SharedPreferences
import expo.modules.core.arguments.ReadableArguments
import org.json.JSONArray
import org.json.JSONObject

internal const val DEFAULT_RADIUS_METERS = 50.0
internal const val DEFAULT_POLL_INTERVAL_MS = 30_000L
private const val MIN_POLL_INTERVAL_MS = 15_000L
private const val MAX_POLL_INTERVAL_MS = 5 * 60_000L

/** Configuration deliberately contains no message body or location snapshot. */
internal data class GuardianConfig(
  val baseUrl: String,
  val deviceId: String,
  val deviceToken: String?,
  val readIds: Set<String>,
  val radiusMeters: Double,
  val appInForeground: Boolean,
  val pollIntervalMs: Long,
  val initialEventCursor: Long?,
) {
  fun toJson(): JSONObject = JSONObject().apply {
    put("baseUrl", baseUrl)
    put("deviceId", deviceId)
    put("deviceToken", deviceToken ?: JSONObject.NULL)
    put("readIds", JSONArray(readIds.toList()))
    put("radiusMeters", radiusMeters)
    put("appInForeground", appInForeground)
    put("pollIntervalMs", pollIntervalMs)
    put("initialEventCursor", initialEventCursor ?: JSONObject.NULL)
  }

  companion object {
    fun fromArguments(arguments: ReadableArguments): GuardianConfig {
      val baseUrl = arguments.getString("baseUrl", "").trim().trimEnd('/')
      val deviceId = arguments.getString("deviceId", "").trim()
      require(baseUrl.startsWith("http://") || baseUrl.startsWith("https://")) {
        "baseUrl must use http or https"
      }
      require(deviceId.isNotEmpty()) { "deviceId is required" }

      val readIds = linkedSetOf<String>()
      val rawReadIds = arguments.getList("readIds", null)
      rawReadIds?.forEach { value ->
        if (value is String && value.isNotBlank()) {
          readIds += value
        }
      }

      val requestedRadius = arguments.getDouble("radiusMeters", DEFAULT_RADIUS_METERS)
      val radiusMeters = if (requestedRadius.isFinite()) {
        requestedRadius.coerceIn(1.0, 1_000.0)
      } else {
        DEFAULT_RADIUS_METERS
      }

      val requestedPollInterval = arguments.getDouble(
        "pollIntervalMs",
        DEFAULT_POLL_INTERVAL_MS.toDouble()
      )
      val pollIntervalMs = if (requestedPollInterval.isFinite()) {
        requestedPollInterval.toLong().coerceIn(MIN_POLL_INTERVAL_MS, MAX_POLL_INTERVAL_MS)
      } else {
        DEFAULT_POLL_INTERVAL_MS
      }
      val requestedEventCursor = arguments.getDouble("initialEventCursor", -1.0)
      val initialEventCursor = requestedEventCursor
        .takeIf { it.isFinite() && it >= 0.0 && it <= Long.MAX_VALUE.toDouble() }
        ?.toLong()

      return GuardianConfig(
        baseUrl = baseUrl,
        deviceId = deviceId,
        deviceToken = arguments.getString("deviceToken", null)?.takeIf { it.isNotBlank() },
        readIds = readIds,
        radiusMeters = radiusMeters,
        appInForeground = arguments.getBoolean("appInForeground", false),
        pollIntervalMs = pollIntervalMs,
        initialEventCursor = initialEventCursor,
      )
    }

    fun fromJson(json: JSONObject): GuardianConfig? {
      val baseUrl = json.optString("baseUrl", "").trim().trimEnd('/')
      val deviceId = json.optString("deviceId", "").trim()
      if (
        baseUrl.isEmpty() ||
        (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) ||
        deviceId.isEmpty()
      ) {
        return null
      }

      val readIds = linkedSetOf<String>()
      json.optJSONArray("readIds")?.let { array ->
        for (index in 0 until array.length()) {
          val id = array.optString(index, "")
          if (id.isNotBlank()) readIds += id
        }
      }

      val radius = json.optDouble("radiusMeters", DEFAULT_RADIUS_METERS)
        .takeIf { it.isFinite() }
        ?.coerceIn(1.0, 1_000.0)
        ?: DEFAULT_RADIUS_METERS
      val interval = json.optLong("pollIntervalMs", DEFAULT_POLL_INTERVAL_MS)
        .coerceIn(MIN_POLL_INTERVAL_MS, MAX_POLL_INTERVAL_MS)
      val initialEventCursor = if (json.has("initialEventCursor") && !json.isNull("initialEventCursor")) {
        json.optLong("initialEventCursor", -1L).takeIf { it >= 0L }
      } else {
        null
      }

      return GuardianConfig(
        baseUrl = baseUrl,
        deviceId = deviceId,
        deviceToken = json.optString("deviceToken", "")
          .takeIf { it.isNotBlank() && it != JSONObject.NULL.toString() },
        readIds = readIds,
        radiusMeters = radius,
        appInForeground = json.optBoolean("appInForeground", false),
        pollIntervalMs = interval,
        initialEventCursor = initialEventCursor,
      )
    }
  }
}

/** Small, private persistence layer shared by the bridge and its service. */
internal object BackgroundGuardianStore {
  private const val PREFS_NAME = "cidi_background_guardian"
  private const val KEY_CONFIG = "config"
  private const val KEY_RUNNING = "running"
  private const val KEY_REMINDED_MESSAGE_IDS = "reminded_message_ids"
  private const val KEY_LAST_EVENT_ID = "last_event_id"
  private const val KEY_EVENT_CURSOR_INITIALIZED = "event_cursor_initialized"

  private fun prefs(context: android.content.Context): SharedPreferences =
    context.getSharedPreferences(PREFS_NAME, android.content.Context.MODE_PRIVATE)

  fun saveConfig(context: android.content.Context, config: GuardianConfig) {
    val preferences = prefs(context)
    val previousConfig = readConfig(context)
    val editor = preferences.edit()
    val identityChanged = previousConfig != null && previousConfig.deviceId != config.deviceId
    if (identityChanged) {
      // Device ids can change after identity recovery. Reminder/cursor state
      // belongs to the old identity and must never leak into the new one.
      editor
        .remove(KEY_REMINDED_MESSAGE_IDS)
        .remove(KEY_LAST_EVENT_ID)
        .remove(KEY_EVENT_CURSOR_INITIALIZED)
    }
    config.initialEventCursor?.let { cursor ->
      val previousCursor = if (identityChanged) 0L else readLastEventId(context)
      editor
        .putLong(KEY_LAST_EVENT_ID, maxOf(previousCursor, cursor))
        .putBoolean(KEY_EVENT_CURSOR_INITIALIZED, true)
    }
    editor.putString(KEY_CONFIG, config.toJson().toString()).apply()
  }

  fun readConfig(context: android.content.Context): GuardianConfig? {
    val raw = prefs(context).getString(KEY_CONFIG, null) ?: return null
    return runCatching { GuardianConfig.fromJson(JSONObject(raw)) }.getOrNull()
  }

  fun setRunning(context: android.content.Context, running: Boolean) {
    prefs(context).edit().putBoolean(KEY_RUNNING, running).apply()
  }

  fun isRunning(context: android.content.Context): Boolean =
    prefs(context).getBoolean(KEY_RUNNING, false)

  fun readRemindedMessageIds(context: android.content.Context): MutableSet<String> =
    HashSet(prefs(context).getStringSet(KEY_REMINDED_MESSAGE_IDS, emptySet()) ?: emptySet())

  fun saveRemindedMessageIds(context: android.content.Context, ids: Set<String>) {
    // A stale message should not grow this set without bound on a long-lived install.
    val bounded = ids.toList().takeLast(5_000).toSet()
    prefs(context).edit().putStringSet(KEY_REMINDED_MESSAGE_IDS, bounded).apply()
  }

  fun readLastEventId(context: android.content.Context): Long =
    prefs(context).getLong(KEY_LAST_EVENT_ID, 0L)

  fun saveLastEventId(context: android.content.Context, id: Long) {
    prefs(context).edit().putLong(KEY_LAST_EVENT_ID, id).apply()
  }

  fun isEventCursorInitialized(context: android.content.Context): Boolean =
    prefs(context).getBoolean(KEY_EVENT_CURSOR_INITIALIZED, false)

  fun setEventCursorInitialized(context: android.content.Context, initialized: Boolean) {
    prefs(context).edit().putBoolean(KEY_EVENT_CURSOR_INITIALIZED, initialized).apply()
  }
}
