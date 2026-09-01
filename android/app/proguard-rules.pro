-keepclassmembers class com.travkin.flow.TravkinBridge {
    @android.webkit.JavascriptInterface <methods>;
}
# Gson maps these network DTOs reflectively in release builds.
-keep class com.travkin.flow.data.** { *; }
-keep class com.travkin.flow.domain.** { *; }
-keepattributes Signature
