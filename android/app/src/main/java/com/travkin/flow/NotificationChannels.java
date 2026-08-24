package com.travkin.flow;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.os.Build;

public final class NotificationChannels {
    public static final String IMPORTANT = "travkinflow_important";
    public static final String AGRONOMY = "travkinflow_agronomy";

    private NotificationChannels() {}

    public static void create(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;

        NotificationChannel important = new NotificationChannel(
                IMPORTANT,
                "Важные события TravkinFlow",
                NotificationManager.IMPORTANCE_HIGH
        );
        important.setDescription("Талоны, исправления и критические рабочие события");

        NotificationChannel agronomy = new NotificationChannel(
                AGRONOMY,
                "Агрономически значимые события",
                NotificationManager.IMPORTANCE_DEFAULT
        );
        agronomy.setDescription("Влажность, первый рейс, завершение поля и значимые отклонения");

        manager.createNotificationChannels(java.util.List.of(important, agronomy));
    }
}
