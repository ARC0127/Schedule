package io.github.arc0127.schedule;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.os.Build;
import android.util.Log;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.*;
import org.json.JSONObject;

public final class ReminderReceiver extends BroadcastReceiver {
    static final String CHANNEL = "schedule-events";
    static final String ACTION = "io.github.arc0127.schedule.REMIND";
    private static final long CATCH_UP_MS = 24 * 60 * 60 * 1000L;
    private static final int NOTIFICATION_ID = 1;

    @Override public void onReceive(Context context, Intent intent) {
        PendingResult completion = goAsync();
        new Thread(() -> {
            try {
                reconcile(context);
            } catch (Exception error) {
                Log.e("Schedule", "Reminder recovery failed", error);
            } finally {
                completion.finish();
            }
        }, "Schedule alarms").start();
    }

    static void createChannel(Context context) {
        NotificationManager notifications = context.getSystemService(NotificationManager.class);
        boolean zh = context.getResources().getConfiguration().getLocales().get(0).getLanguage().equals("zh");
        notifications.createNotificationChannel(new NotificationChannel(CHANNEL,
                zh ? "日程提醒" : "Schedule reminders", NotificationManager.IMPORTANCE_HIGH));
    }

    static boolean notificationsAllowed(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        NotificationChannel channel = manager.getNotificationChannel(CHANNEL);
        return manager.areNotificationsEnabled() && (channel == null || channel.getImportance() != NotificationManager.IMPORTANCE_NONE)
                && (Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED);
    }

    static synchronized void reconcile(Context context) throws Exception {
        Map<String, JSONObject> events = EventStore.get(context).visibleMap();
        SharedPreferences book = context.getSharedPreferences("alarms", Context.MODE_PRIVATE);
        SharedPreferences.Editor changes = book.edit();
        NotificationManager notifications = context.getSystemService(NotificationManager.class);
        AlarmManager alarms = context.getSystemService(AlarmManager.class);
        createChannel(context);
        long now = System.currentTimeMillis();
        long next = Long.MAX_VALUE;
        boolean allowed = notificationsAllowed(context);
        Set<String> eligible = new HashSet<>();
        for (Map.Entry<String, JSONObject> row : events.entrySet()) {
            String identity = row.getKey();
            JSONObject event = row.getValue();
            int minutes = event.getInt("minutes");
            if (event.getBoolean("done") || minutes < 0) continue;
            eligible.add(identity);
            long when = event.getLong("at") - minutes * 60_000L;
            // A different lead time is a different requested occurrence, even if the event title stays unchanged.
            String occurrence = event.getLong("at") + "/" + minutes;
            String previous = book.getString(identity, "");
            if (!previous.equals("fired:" + occurrence)) {
                if (!previous.isEmpty() && !previous.equals("armed:" + occurrence)) notifications.cancel(identity, NOTIFICATION_ID);
                if (when > now) {
                    changes.putString(identity, "armed:" + occurrence);
                    next = Math.min(next, when);
                } else if (previous.equals("armed:" + occurrence) && now - when <= CATCH_UP_MS) {
                    if (allowed) {
                        notify(context, notifications, identity, event);
                        changes.putString(identity, "fired:" + occurrence);
                    }
                } else {
                    changes.remove(identity);
                }
            }
        }
        for (String old : book.getAll().keySet()) {
            if (!eligible.contains(old)) {
                changes.remove(old);
                notifications.cancel(old, NOTIFICATION_ID);
            }
        }
        if (!changes.commit()) throw new IllegalStateException("Could not persist reminder state");
        Intent intent = new Intent(context, ReminderReceiver.class).setAction(ACTION);
        PendingIntent alarm = PendingIntent.getBroadcast(context, 0, intent,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        if (next == Long.MAX_VALUE) {
            alarms.cancel(alarm);
            return;
        }
        if (Build.VERSION.SDK_INT < 31 || alarms.canScheduleExactAlarms()) {
            try {
                alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, alarm);
                return;
            } catch (SecurityException revoked) {
                // Exact access may be revoked while the app is selecting the alarm API.
            }
        }
        alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, alarm);
    }

    private static void notify(Context context, NotificationManager notifications, String identity, JSONObject event) throws Exception {
        String date = event.getString("key").substring(0, 10);
        Intent open = new Intent(context, MainActivity.class)
                .setData(android.net.Uri.parse("schedule:day/" + date))
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent content = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_IMMUTABLE);
        String localTime = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm")
                .format(Instant.ofEpochMilli(event.getLong("at")).atZone(ZoneId.systemDefault()));
        notifications.notify(identity, NOTIFICATION_ID, new Notification.Builder(context, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_popup_reminder)
                .setContentTitle(event.getString("title")).setContentText(localTime)
                .setVisibility(Notification.VISIBILITY_PRIVATE)
                .setContentIntent(content).setOnlyAlertOnce(true).setAutoCancel(true).build());
    }
}

