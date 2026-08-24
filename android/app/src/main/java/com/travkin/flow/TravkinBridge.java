package com.travkin.flow;

import android.app.Activity;
import android.content.Intent;
import android.webkit.JavascriptInterface;

public final class TravkinBridge {
    private final Activity activity;

    TravkinBridge(Activity activity) {
        this.activity = activity;
    }

    @JavascriptInterface
    public String platform() {
        return "android";
    }

    @JavascriptInterface
    public String channel() {
        return BuildConfig.APP_CHANNEL;
    }

    @JavascriptInterface
    public void share(String title, String text, String url) {
        activity.runOnUiThread(() -> {
            Intent shareIntent = new Intent(Intent.ACTION_SEND);
            shareIntent.setType("text/plain");
            shareIntent.putExtra(Intent.EXTRA_SUBJECT, title == null ? "TravkinFlow" : title);
            String message = ((text == null ? "" : text) + "\n" + (url == null ? "" : url)).trim();
            shareIntent.putExtra(Intent.EXTRA_TEXT, message);
            activity.startActivity(Intent.createChooser(shareIntent, "Поделиться"));
        });
    }
}
