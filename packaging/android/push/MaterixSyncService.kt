package org.materix.app

// Opt-in foreground "keep sync alive" service. Materix runs entirely inside a
// WebView (matrix-js-sdk); once the app is backgrounded there is nothing
// anchoring the process, so Android's low-memory killer reclaims it (see
// issue: "Materix process is killed in the background"). When killed, the next
// launch is a cold start that re-runs the full startup path.
//
// A started foreground service holds the whole process at foreground-service
// oom priority, so the OS keeps the WebView — and matrix-js-sdk's live sync —
// resident while the user has explicitly opted in. It shows a low-importance
// ongoing notification (required by Android for any foreground service) so the
// user always knows sync is running and can turn it off.
//
// Deliberately does NOT hold a WakeLock: we don't fight Doze (that would drain
// battery for little gain and disrespect battery-conscious users). This only
// stops the *cached-process* kill; pair it with the battery-optimization
// exemption (MaterixPushBridge.requestIgnoreBatteryOptimizations) for the OS to
// schedule the app's network more aggressively while idle.
//
// Committed under packaging/android/ and copied into the (gitignored,
// regenerated) gen/android tree by scripts/apply-android-push.sh, which also
// adds the FOREGROUND_SERVICE* permissions and the <service> declaration.

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

class MaterixSyncService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        ensureChannel(this)
        val notification = buildNotification(this)
        if (Build.VERSION.SDK_INT >= 29) {
            // API 34+ requires the typed FGS permission + type; dataSync is the
            // closest fit for "keep the Matrix sync connection alive".
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            @Suppress("DEPRECATION")
            startForeground(NOTIFICATION_ID, notification)
        }
        running = true
        // If the OS kills us under extreme pressure, don't auto-restart with a
        // null intent — the app re-asserts the service on next launch/resume.
        return START_STICKY
    }

    override fun onDestroy() {
        running = false
        super.onDestroy()
    }

    companion object {
        const val CHANNEL_ID = "materix.sync"
        const val NOTIFICATION_ID = 2

        @Volatile
        private var running = false

        /** True once onStartCommand has promoted us to the foreground. */
        fun isRunning(): Boolean = running

        /** Foreground data-sync services are only safe to run on API 26+. */
        fun isSupported(): Boolean = Build.VERSION.SDK_INT >= 26

        fun start(context: Context) {
            if (!isSupported()) return
            val intent = Intent(context, MaterixSyncService::class.java)
            context.startForegroundService(intent)
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, MaterixSyncService::class.java))
            running = false
        }

        private fun ensureChannel(context: Context) {
            if (Build.VERSION.SDK_INT < 26) return
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (nm.getNotificationChannel(CHANNEL_ID) == null) {
                nm.createNotificationChannel(
                    NotificationChannel(
                        CHANNEL_ID,
                        "Background sync",
                        // LOW: silent, no heads-up — it's a passive status line.
                        NotificationManager.IMPORTANCE_LOW,
                    ).apply {
                        description = "Keeps Materix connected while it is in the background"
                        setShowBadge(false)
                    },
                )
            }
        }

        private fun buildNotification(context: Context): Notification {
            val builder = if (Build.VERSION.SDK_INT >= 26) {
                Notification.Builder(context, CHANNEL_ID)
            } else {
                @Suppress("DEPRECATION") Notification.Builder(context)
            }
            builder
                .setContentTitle("Materix")
                .setContentText("Staying connected in the background")
                .setSmallIcon(context.applicationInfo.icon)
                .setOngoing(true)
            if (Build.VERSION.SDK_INT >= 26) {
                @Suppress("DEPRECATION")
                builder.setPriority(Notification.PRIORITY_LOW)
            } else {
                @Suppress("DEPRECATION")
                builder.setPriority(Notification.PRIORITY_MIN)
            }
            context.packageManager.getLaunchIntentForPackage(context.packageName)?.let { launch ->
                val piFlags = PendingIntent.FLAG_UPDATE_CURRENT or
                    (if (Build.VERSION.SDK_INT >= 23) PendingIntent.FLAG_IMMUTABLE else 0)
                builder.setContentIntent(PendingIntent.getActivity(context, 0, launch, piFlags))
            }
            return builder.build()
        }
    }
}
