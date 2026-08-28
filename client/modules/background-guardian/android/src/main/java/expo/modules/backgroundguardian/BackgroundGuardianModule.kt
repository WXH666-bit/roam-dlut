package expo.modules.backgroundguardian

import android.content.Context
import android.content.Intent
import expo.modules.core.arguments.ReadableArguments
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * JS-facing bridge for the Android-only background guardian.
 *
 * The service owns all long-lived work. Keeping the configuration in
 * SharedPreferences lets START_STICKY recreate the worker after the app's JS
 * process has been reclaimed.
 */
class BackgroundGuardianModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("BackgroundGuardian")

    AsyncFunction("start") { arguments: ReadableArguments ->
      val context = requireContext()
      // Reject before asking the system to create the service unless both the
      // visible and background location grants required by this feature are
      // active. This also prevents a sticky service from outliving an
      // "Allow only while using" downgrade.
      if (
        !BackgroundGuardianService.hasLocationPermission(context) ||
        !BackgroundGuardianService.hasBackgroundLocationPermission(context)
      ) {
        throw SecurityException(
          "foreground and background location permission are required before starting the guardian"
        )
      }
      BackgroundGuardianStore.saveConfig(context, GuardianConfig.fromArguments(arguments))
      BackgroundGuardianService.start(context)
    }

    AsyncFunction("updateConfig") { arguments: ReadableArguments ->
      val context = requireContext()
      BackgroundGuardianStore.saveConfig(context, GuardianConfig.fromArguments(arguments))
      if (BackgroundGuardianStore.isRunning(context)) {
        BackgroundGuardianService.update(context)
      }
    }

    AsyncFunction("stop") {
      val context = requireContext()
      BackgroundGuardianStore.setRunning(context, false)
      context.stopService(Intent(context, BackgroundGuardianService::class.java))
    }

    AsyncFunction<Boolean>("isRunning") {
      BackgroundGuardianStore.isRunning(requireContext())
    }

    AsyncFunction<Double?>("getLastEventId") {
      val context = requireContext()
      BackgroundGuardianService.awaitEventPollCompletion()
      if (BackgroundGuardianStore.isEventCursorInitialized(context)) {
        BackgroundGuardianStore.readLastEventId(context).toDouble()
      } else {
        null
      }
    }
  }

  private fun requireContext(): Context =
    appContext.reactContext ?: throw IllegalStateException("React context is unavailable")
}
