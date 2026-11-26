# Reglas R8/ProGuard estrictas: ofusca clases y métodos internos preservando
# únicamente el punto de entrada MainActivity y los endpoints Capacitor.
-keepattributes *Annotation*
-keep public class com.indiserv.analytica.MainActivity { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin public class * {
    public <init>();
}
-keepclassmembers class * extends com.getcapacitor.Plugin {
    @com.getcapacitor.PluginMethod <methods>;
}
