// Supabase Edge Function: analizar-dispositivo-ia
// Despliegue:
//   supabase secrets set GEMINI_API_KEY="TU_CLAVE_GEMINI"
//   supabase functions deploy analizar-dispositivo-ia

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface TelemetryInput {
  manufacturer?: string;
  brand?: string;
  model?: string;
  board?: string;
  deviceCode?: string;
  cpuName?: string;
  cpuCores?: number;
  cpuMaxFreqMhz?: number;
  cpuArch?: string;
  ramTotalGb?: number | null;
  storageTotalGb?: number | null;
  gpu?: string;
  screenRes?: string;
  refreshRateHz?: number | null;
  batteryHealth?: string;
  batteryTempC?: number | null;
  buildTags?: string;
  verifiedBootState?: string;
  isRooted?: boolean;
  isEmulator?: boolean;
  os?: string;
}

function buildHeuristicFallback(t: TelemetryInput) {
  const model = `${t.manufacturer || ""} ${t.model || ""}`.trim() || "Dispositivo Android";
  const boot = (t.verifiedBootState || "unknown").toLowerCase();
  const modified = Boolean(t.isRooted) || boot === "orange" || (t.buildTags || "").includes("test-keys");
  const isEmu = Boolean(t.isEmulator);

  let veredicto = "Original Coherente";
  if (isEmu) veredicto = "Sospecha de Clon / Alteración";
  else if (modified) veredicto = "Software/Bootloader Modificado";

  return {
    origen: "heuristica",
    nombre_comercial: model,
    anio_lanzamiento: "N/D",
    veredicto,
    confianza_pct: isEmu ? 92 : 78,
    resumen:
      `Análisis heurístico completado para ${model} (${t.cpuName || "SoC ARM"}, ${t.ramTotalGb ?? "?"} GB RAM, ${t.storageTotalGb ?? "?"} GB). ` +
      (modified
        ? "Se detectaron indicios de bootloader desbloqueado, root o firma test-keys."
        : "No se detectaron alteraciones de software ni incoherencias críticas en los parámetros reportados."),
    componentes: [
      {
        parte: "Procesador / SoC",
        estado: isEmu ? "Alerta" : "Coherente",
        detalle: `${t.cpuName || "ARM"} (${t.cpuCores || "?"} núcleos, ABI ${t.cpuArch || "arm64-v8a"})`,
      },
      {
        parte: "RAM y Almacenamiento",
        estado: "Coherente",
        detalle: `${t.ramTotalGb ?? "N/D"} GB RAM / ${t.storageTotalGb ?? "N/D"} GB internos`,
      },
      {
        parte: "Pantalla y GPU",
        estado: "Coherente",
        detalle: `${t.gpu || "GPU WebGL"} · ${t.screenRes || "N/D"}`,
      },
      {
        parte: "Integridad de Sistema",
        estado: modified || isEmu ? "Alerta" : "Coherente",
        detalle: `Tags: ${t.buildTags || "N/D"} · Boot: ${t.verifiedBootState || "N/D"} · Root: ${t.isRooted ? "Sí" : "No"}`,
      },
    ],
    nota_fisica:
      "La auditoría valida el hardware reportado por el sistema operativo e integridad del firmware; repuestos físicos genéricos con idénticas especificaciones eléctricas no siempre son distinguibles por software.",
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    const body = await req.json();
    const telemetry: TelemetryInput = body?.telemetry || body || {};
    const apiKey = Deno.env.get("GEMINI_API_KEY");

    if (!apiKey) {
      return new Response(JSON.stringify(buildHeuristicFallback(telemetry)), {
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        status: 200,
      });
    }

    const systemPrompt = `Eres un auditor forense de hardware móvil Android.
Recibirás telemetría nativa real de un teléfono Android.
1. Identifica el NOMBRE COMERCIAL EXACTO del modelo a partir de manufacturer, brand, model, board y SoC (ej: SM-S938B -> "Samsung Galaxy S25 Ultra", 2312DRA50G -> "Redmi Note 13 Pro 5G").
2. Compara las especificaciones detectadas (SoC, núcleos, RAM, almacenamiento, GPU, pantalla/Hz, tags, verifiedBootState, root, emulador) contra la ficha técnica real de ese modelo.
3. Si las especificaciones NO coinciden con el modelo (ej. dice S25 Ultra pero tiene 2 GB RAM o MediaTek antiguo), marca "Sospecha de Clon / Alteración".
4. Si el hardware coincide pero tiene root, test-keys o verifiedBootState orange, marca "Software/Bootloader Modificado".
5. Si todo coincide, marca "Original Coherente".
6. Sé honesto: nunca afirmes que una pantalla o batería física nunca fue cambiada si no hay señal de software.

Responde EXCLUSIVAMENTE un objeto JSON válido con esta estructura exacta:
{
  "nombre_comercial": "string",
  "anio_lanzamiento": "string",
  "veredicto": "Original Coherente" | "Software/Bootloader Modificado" | "Sospecha de Clon / Alteración",
  "confianza_pct": number,
  "resumen": "string",
  "componentes": [
    { "parte": "Procesador / SoC", "estado": "Coherente" | "Advertencia" | "Alerta", "detalle": "string" },
    { "parte": "RAM y Almacenamiento", "estado": "Coherente" | "Advertencia" | "Alerta", "detalle": "string" },
    { "parte": "Pantalla y GPU", "estado": "Coherente" | "Advertencia" | "Alerta", "detalle": "string" },
    { "parte": "Integridad de Sistema", "estado": "Coherente" | "Advertencia" | "Alerta", "detalle": "string" }
  ],
  "nota_fisica": "string"
}`;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 14000);

    const gResp = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { text: systemPrompt },
              { text: `Telemetría del dispositivo:\n${JSON.stringify(telemetry, null, 2)}` },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.15,
          responseMimeType: "application/json",
        },
      }),
    });
    clearTimeout(timeoutId);

    if (!gResp.ok) {
      const fb = buildHeuristicFallback(telemetry);
      return new Response(
        JSON.stringify({ ...fb, aviso_ia: `Gemini HTTP ${gResp.status}; se aplicó auditoría heurística.` }),
        { headers: { ...CORS_HEADERS, "Content-Type": "application/json" }, status: 200 },
      );
    }

    const gData = await gResp.json();
    const rawText = gData?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const parsed = JSON.parse(rawText);

    return new Response(JSON.stringify({ origen: "gemini-ia", ...parsed }), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: `Error en análisis IA: ${err instanceof Error ? err.message : String(err)}`,
      }),
      { headers: { ...CORS_HEADERS, "Content-Type": "application/json" }, status: 500 },
    );
  }
});
