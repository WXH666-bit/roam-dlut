# Official AMap Location SDK keep rules for release/R8 builds. Keep these here
# as well as in the foreground bridge because this service owns an independent
# native AMap client after the JS process leaves the foreground.
-keep class com.amap.api.location.** { *; }
-keep class com.amap.api.fence.** { *; }
-keep class com.loc.** { *; }
-keep class com.autonavi.aps.amapapi.model.** { *; }
-dontwarn com.amap.api.location.**
