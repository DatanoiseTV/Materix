package org.materix.app

// UnifiedPush BroadcastReceiver: the distributor (e.g. ntfy) delivers here even
// when Materix's own process is dead. See MaterixPush.kt for the design.
//
// Committed under packaging/android/ and copied into gen/android by
// scripts/apply-android-push.sh; declared in the merged AndroidManifest with
// intent-filters for the four org.unifiedpush.android.connector.* actions.

import android.content.Context
import org.json.JSONObject
import org.unifiedpush.android.connector.MessagingReceiver

class MaterixUnifiedPushReceiver : MessagingReceiver() {
    override fun onNewEndpoint(context: Context, endpoint: String, instance: String) {
        // Persist so the app can register the Matrix pusher at next launch even
        // if it wasn't running when the endpoint was (re)issued.
        MaterixPush.saveEndpoint(context, endpoint)
        MaterixPush.dispatchToJs("materix-up-endpoint", endpoint)
    }

    override fun onRegistrationFailed(context: Context, instance: String) {
        MaterixPush.dispatchToJs("materix-up-registration-failed", instance)
    }

    override fun onUnregistered(context: Context, instance: String) {
        MaterixPush.saveEndpoint(context, null)
        MaterixPush.dispatchToJs("materix-up-unregistered", instance)
    }

    override fun onMessage(context: Context, message: ByteArray, instance: String) {
        val text = try {
            String(message, Charsets.UTF_8)
        } catch (_: Throwable) {
            ""
        }
        if (MaterixPush.hasLiveWebView()) {
            // App is running: hand the raw gateway payload to matrix-js-sdk, which
            // syncs the referenced event and posts the rich, decrypted notification.
            MaterixPush.dispatchToJs("materix-up-message", text)
        } else {
            // Dead process: we can't decrypt here. Wake the user with a generic
            // notification; opening the app syncs and shows the message.
            val (title, body) = summarize(text)
            MaterixPush.notifyGeneric(context, title, body)
        }
    }

    /**
     * Best-effort title from the Matrix push-gateway payload. With the
     * `event_id_only` pusher format the payload carries no content, so this is
     * usually just "Materix" / "New message".
     */
    private fun summarize(text: String): Pair<String, String> {
        return try {
            val n = JSONObject(text).optJSONObject("notification")
            // sender_display_name / room_name are attacker-influenced (a sender
            // controls their own display name, and the payload is only as
            // trustworthy as the chosen gateway). Strip control characters and
            // clamp the length before showing them as a notification title.
            val sender = n?.optString("sender_display_name")?.takeIf { it.isNotEmpty() }?.let(::clean)
            val room = n?.optString("room_name")?.takeIf { it.isNotEmpty() }?.let(::clean)
            Pair(sender ?: room ?: "Materix", "New message")
        } catch (_: Throwable) {
            Pair("Materix", "New message")
        }
    }

    private fun clean(s: String): String =
        s.replace(Regex("""\p{Cntrl}"""), " ").trim().take(100)
}
