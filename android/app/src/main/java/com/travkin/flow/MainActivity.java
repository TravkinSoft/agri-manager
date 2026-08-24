package com.travkin.flow;

import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.view.Gravity;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.MimeTypeMap;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.NonNull;
import androidx.core.content.FileProvider;
import androidx.core.graphics.Insets;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;

import java.io.File;
import java.io.IOException;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public final class MainActivity extends ComponentActivity {
    private WebView webView;
    private View offlineView;
    private boolean mainFrameFailed;
    private ValueCallback<Uri[]> fileCallback;
    private Uri pendingCameraUri;
    private ConnectivityManager connectivityManager;
    private ConnectivityManager.NetworkCallback networkCallback;

    private final ActivityResultLauncher<Intent> filePicker = registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(),
            result -> {
                if (fileCallback == null) return;
                Uri[] results = null;
                if (result.getResultCode() == RESULT_OK) {
                    Intent data = result.getData();
                    if (data == null || data.getData() == null) {
                        if (pendingCameraUri != null) results = new Uri[]{pendingCameraUri};
                    } else {
                        results = WebChromeClient.FileChooserParams.parseResult(result.getResultCode(), data);
                    }
                }
                fileCallback.onReceiveValue(results);
                fileCallback = null;
                pendingCameraUri = null;
            }
    );

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        SplashScreen.installSplashScreen(this);
        super.onCreate(savedInstanceState);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        NotificationChannels.create(this);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(12, 17, 26));
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return insets;
        });

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(12, 17, 26));
        root.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
        ));

        offlineView = createOfflineView();
        root.addView(offlineView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
        ));
        offlineView.setVisibility(View.GONE);
        setContentView(root);

        configureWebView();
        registerNetworkState();
        configureBackNavigation();
        loadIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        loadIntent(intent);
    }

    @Override
    protected void onDestroy() {
        if (networkCallback != null && connectivityManager != null) {
            try {
                connectivityManager.unregisterNetworkCallback(networkCallback);
            } catch (IllegalArgumentException ignored) {
                // The callback can already be detached during process shutdown.
            }
        }
        if (webView != null) {
            webView.removeJavascriptInterface("TravkinAndroid");
            webView.destroy();
        }
        super.onDestroy();
    }

    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setUserAgentString(settings.getUserAgentString() + " TravkinFlowAndroid/3");
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(settings, false);
        }

        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, false);

        webView.addJavascriptInterface(new TravkinBridge(this), "TravkinAndroid");
        webView.setWebViewClient(new AppWebViewClient());
        webView.setWebChromeClient(new AppWebChromeClient());
        webView.setDownloadListener(createDownloadListener());
    }

    private void loadIntent(Intent intent) {
        String candidate = intent != null && intent.getDataString() != null
                ? intent.getDataString()
                : BuildConfig.BASE_URL + "/dashboard";
        String normalized = NativeRoutePolicy.normalizeDeepLink(candidate, BuildConfig.BASE_URL);
        webView.loadUrl(normalized == null ? BuildConfig.BASE_URL + "/dashboard" : normalized);
    }

    private void configureBackNavigation() {
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                String script = "(() => {" +
                        "const d=document.querySelector('[role=dialog][data-state=open]');" +
                        "if(!d||d.closest('[data-operator-session-gate]'))return false;" +
                        "document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true}));" +
                        "return true;})()";
                webView.evaluateJavascript(script, handled -> {
                    if ("true".equals(handled)) return;
                    if (webView.canGoBack()) {
                        webView.goBack();
                    } else {
                        moveTaskToBack(true);
                    }
                });
            }
        });
    }

    private View createOfflineView() {
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setGravity(Gravity.CENTER);
        panel.setPadding(48, 48, 48, 48);
        panel.setBackgroundColor(Color.rgb(12, 17, 26));

        TextView title = new TextView(this);
        title.setText("Нет связи");
        title.setTextColor(Color.WHITE);
        title.setTextSize(24);
        title.setGravity(Gravity.CENTER);
        panel.addView(title);

        TextView description = new TextView(this);
        description.setText("TravkinFlow сохранит подтверждённые сервером данные. Проверьте интернет и повторите подключение.");
        description.setTextColor(Color.rgb(181, 190, 204));
        description.setTextSize(15);
        description.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams textParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
        );
        textParams.setMargins(0, 20, 0, 28);
        panel.addView(description, textParams);

        Button retry = new Button(this);
        retry.setText("Повторить");
        retry.setMinHeight(56);
        retry.setOnClickListener(view -> {
            mainFrameFailed = false;
            offlineView.setVisibility(View.GONE);
            webView.reload();
        });
        panel.addView(retry, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
        ));
        return panel;
    }

    private void registerNetworkState() {
        connectivityManager = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        networkCallback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(@NonNull Network network) {
                runOnUiThread(() -> {
                    if (mainFrameFailed) {
                        mainFrameFailed = false;
                        offlineView.setVisibility(View.GONE);
                        webView.reload();
                    }
                    webView.evaluateJavascript("window.dispatchEvent(new Event('online'))", null);
                });
            }

            @Override
            public void onLost(@NonNull Network network) {
                runOnUiThread(() -> webView.evaluateJavascript("window.dispatchEvent(new Event('offline'))", null));
            }
        };
        connectivityManager.registerDefaultNetworkCallback(networkCallback);
    }

    private DownloadListener createDownloadListener() {
        return (url, userAgent, contentDisposition, mimeType, contentLength) -> {
            if (url == null || !url.startsWith("https://")) return;
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            request.addRequestHeader("Cookie", CookieManager.getInstance().getCookie(url));
            request.addRequestHeader("User-Agent", userAgent);
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setAllowedOverMetered(true);
            request.setAllowedOverRoaming(false);
            String extension = MimeTypeMap.getSingleton().getExtensionFromMimeType(mimeType);
            String filename = "TravkinFlow-" + System.currentTimeMillis() + (extension == null ? "" : "." + extension);
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename);
            DownloadManager manager = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
            manager.enqueue(request);
        };
    }

    private final class AppWebViewClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            String normalized = NativeRoutePolicy.normalizeDeepLink(uri.toString(), BuildConfig.BASE_URL);
            if (normalized != null) {
                if (!normalized.equals(uri.toString())) view.loadUrl(normalized);
                return !normalized.equals(uri.toString());
            }
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
            } catch (ActivityNotFoundException ignored) {
                // Keep the current app state when no external handler exists.
            }
            return true;
        }

        @Override
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
            mainFrameFailed = false;
            offlineView.setVisibility(View.GONE);
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) {
                mainFrameFailed = true;
                offlineView.setVisibility(View.VISIBLE);
            }
        }
    }

    private final class AppWebChromeClient extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(
                WebView webView,
                ValueCallback<Uri[]> filePathCallback,
                FileChooserParams fileChooserParams
        ) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = filePathCallback;

            Intent captureIntent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            if (captureIntent.resolveActivity(getPackageManager()) != null) {
                try {
                    File image = File.createTempFile(
                            "travkinflow-" + new SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(new Date()),
                            ".jpg",
                            getExternalCacheDir()
                    );
                    pendingCameraUri = FileProvider.getUriForFile(
                            MainActivity.this,
                            BuildConfig.APPLICATION_ID + ".files",
                            image
                    );
                    captureIntent.putExtra(MediaStore.EXTRA_OUTPUT, pendingCameraUri);
                    captureIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                } catch (IOException error) {
                    captureIntent = null;
                    pendingCameraUri = null;
                }
            } else {
                captureIntent = null;
            }

            Intent contentIntent = fileChooserParams.createIntent();
            contentIntent.addCategory(Intent.CATEGORY_OPENABLE);
            Intent chooser = Intent.createChooser(contentIntent, "Выберите файл");
            if (captureIntent != null) chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{captureIntent});
            filePicker.launch(chooser);
            return true;
        }
    }
}
