# Flutter Proguard & R8 Optimization Rules
-keep class io.flutter.app.** { *; }
-keep class io.flutter.plugin.**  { *; }
-keep class io.flutter.util.**  { *; }
-keep class io.flutter.view.**  { *; }
-keep class io.flutter.**  { *; }
-keep class io.flutter.plugins.**  { *; }

# Keep Application native code & Telephony Services
-keep class com.zinipay.payflow_agent.** { *; }
-keep class com.payflow.agent.** { *; }

# Keep AndroidX & FileProvider for APK installation
-keep class androidx.core.content.FileProvider { *; }
-dontwarn androidx.core.content.FileProvider

# Play Core deferred components suppression
-dontwarn com.google.android.play.core.**

