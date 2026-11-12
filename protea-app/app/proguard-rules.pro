# ML Kit finds its parts by reflection (ComponentDiscovery builds each registrar with its no-argument constructor), so shrinking
# must keep them. Without this the release build starts but the QR scanner cannot work.
-keep class * implements com.google.firebase.components.ComponentRegistrar { <init>(); }
-keep class com.google.mlkit.**.*Registrar { <init>(); }
