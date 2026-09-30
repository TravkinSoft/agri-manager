package com.travkin.flow;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import org.junit.Test;

public final class TwaContractTest {
    private static String readProjectFile(String relativePath) throws IOException {
        Path projectDir = Paths.get(System.getProperty("user.dir"));
        return new String(
                Files.readAllBytes(projectDir.resolve(relativePath)),
                StandardCharsets.UTF_8);
    }

    @Test
    public void keepsExistingPlayIdentityAndIncrementsRelease() throws Exception {
        String build = readProjectFile("build.gradle");

        assertTrue(build.contains("applicationId \"com.travkin.flow\""));
        assertTrue(build.contains("versionCode 5"));
        assertTrue(build.contains("versionName \"4.0.1\""));
        assertTrue(build.contains("targetSdk 36"));
    }

    @Test
    public void launchesTheProductionDashboardThroughTrustedWebActivity() throws Exception {
        String build = readProjectFile("build.gradle");
        String manifest = readProjectFile("src/main/AndroidManifest.xml");

        assertTrue(build.contains("https://travkinflow.com/dashboard"));
        assertTrue(manifest.contains("com.google.androidbrowserhelper.trusted.LauncherActivity"));
        assertTrue(manifest.contains("android.support.customtabs.trusted.DEFAULT_URL"));
        assertTrue(manifest.contains("android:autoVerify=\"true\""));
        assertTrue(manifest.contains("android:host=\"@string/host_name\""));
        assertFalse(manifest.contains("android:path="));
    }

    @Test
    public void usesVerifiedBrowserRuntimeInsteadOfASecondUiOrCustomWebView() throws Exception {
        String manifest = readProjectFile("src/main/AndroidManifest.xml");
        String build = readProjectFile("build.gradle");

        assertTrue(build.contains("androidbrowserhelper:2.7.3"));
        assertTrue(build.contains("locationdelegation:1.1.2"));
        assertTrue(manifest.contains("android:value=\"@string/twa_fallback_type\""));
        assertFalse(manifest.contains("com.travkin.flow.MainActivity"));
        assertFalse(manifest.contains("android.webkit.WebView"));
    }

    @Test
    public void delegatesNotificationsAndLocationWithoutWeakeningServerRoles() throws Exception {
        String manifest = readProjectFile("src/main/AndroidManifest.xml");
        String statements = readProjectFile("src/main/res/values/twa.xml");

        assertTrue(manifest.contains("android.permission.POST_NOTIFICATIONS"));
        assertTrue(manifest.contains("android.permission.ACCESS_FINE_LOCATION"));
        assertTrue(manifest.contains("android:name=\".DelegationService\""));
        assertTrue(statements.contains("delegate_permission/common.handle_all_urls"));
        assertTrue(statements.contains("https://travkinflow.com"));
        assertFalse(statements.contains("role"));
    }
}
