# Flutter / R8 rules
-keep class io.flutter.app.** { *; }
-keep class io.flutter.plugin.**  { *; }
-keep class io.flutter.util.**  { *; }
-keep class io.flutter.view.**  { *; }
-keep class io.flutter.**  { *; }
-keep class io.flutter.plugins.**  { *; }

# Native SMS capture, queue and sender
-keep class ir.bolgram.forwarder.** { *; }

-dontwarn com.google.android.play.core.**
