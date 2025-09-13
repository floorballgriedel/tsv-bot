// api/tsv-bot.js
import OpenAI from "openai";

/** Erlaubte Ursprünge (WP-Domains) */
const ALLOWED_ORIGINS = new Set([
  "https://www.tsv-griedel.de",
  "https://tsv-griedel.de",
  "http://www.tsv-griedel.de",
  "http://tsv-griedel.de",
  "https://www.floorballgriedel.de",
  "https://floorballgriedel.de",
  "http://www.floorballgriedel.de",
  "http://floorballgriedel.de",
  "http://localhost:3000"
]);

/** Dein Vector Store (aus deinem Upload) */
const VECTOR_STORE_ID = "vs_68c4739fd58481919479080b69780dfa";

/** Body robust einlesen */
async function readJsonBody(req) {
  try {
    if (req.body) {
      if (typeof req.body === "object") return req.body;
      if (typeof req.body === "string") return JSON.parse(req.body || "{}");
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.error("Body parse error:", e);
    return {};
  }
}

/** Einfaches Polling bis der Assistant-Run fertig ist */
async function pollRunUntilDone(client, threadId, runId) {
  for (let i = 0; i < 40; i++) {            // ~30s Timeout
    const r = await client.beta.threads.runs.retrieve(threadId, runId);
    if (r.status === "completed") return r;
    if (["failed", "cancelled", "expired"].includes(r.status)) {
      throw new Error(`Assistant run ${r.status}`);
    }
    await new Promise(res => setTimeout(res, 750));
  }
  throw new Error("Assistant run timeout");
}

/** Einmaliger Assistant-Call mit File Search (Vector Store) */
async function runAssistantWithFileSearch({ client, message }) {
  // 1) Assistant ad-hoc erstellen (einfach für den Start)
  const today = new Date().toISOString().slice(0, 10); // z. B. "2025-09-13"

const assistant = await client.beta.assistants.create({
  model: "gpt-4.1-mini",
  instructions:
    "Du bist der Vereinsassistent des TSV 1899 Griedel e.V. " +
    "Antworte kurz, freundlich und konkret. " +
    "Nutze die Vereinsdokumente per Datei-Suche; wenn du daraus antwortest, füge am Ende 'Quelle: <Dokumentname>' an. " +
    "Wichtige Links: Mitglied werden https://www.tsv-griedel.de/mitglied-werden | " +
    "Spenden https://tsv-griedel.de/verein/foerdervereine/handballfoerderverein-des-tsv-1899-griedel-e-v/ | " +
    "Probetraining info@tsv-griedel.de | Floorball https//www.floorballgriedel.de. " +

    // ---- Datum & Terminlogik ----
    "Heutiges Datum (ISO): " + today + ". " +
    "Wenn nach kommenden Spielen/Terminen gefragt wird: " +
    "1) Verwende ausschließlich Termine mit Datum ≥ heutigem Datum. " +
    "2) Ignoriere ältere/archivierte Spielberichte oder Saisonartikel mit Datum < heutigem Datum. " +
    "3) Bevorzuge IMMER die offiziellen Saison-Spielpläne: " +
    "   - 'Floorball_Saison_2025_2026.pdf' für Floorball " +
    "   - 'Handball_Saison_2025_2026.pdf' für Handball. " +
    "4) Bei Widersprüchen nutze die Daten aus diesen Saison-Dateien, NICHT aus Artikeln. " +
    "5) Wenn keine zukünftigen Termine gefunden werden, sage das klar und verweise auf den jeweiligen Spielplan-Link. " +
    "6) Falls unklar (Team/Altersklasse/Zeitraum), stelle genau EINE präzise Rückfrage. " +

    // ---- Sportartspezifisch ----
    "Handball: Nutze nach Möglichkeit Team- und Ligenbezeichnungen (z. B. 1. Herren, 1. Damen, Jugendstaffeln). " +
    "Floorball: Nutze Altersklassen (U7/U9/U11/U13/U15/U17) und weise auf Heim/Auswärts sowie Turnierformate hin. " +

    // ---- Ausgabeformat ----
    "Formatiere Ausgaben zu Terminen als Liste mit maximal 5 Einträgen, jeder Eintrag als: " +
    "• <Datum (TT.MM.JJJJ), Uhrzeit> – <Team> vs. <Gegner> – <Ort/Spielstätte> – <Wettbewerb/Liga>. " +
    "Wenn Uhrzeit/Ort fehlen, formuliere das explizit. " +

    // ---- Allgemein ----
    "Wenn etwas unklar ist, stelle genau EINE Rückfrage.",
  tools: [{ type: "file_search" }],
  tool_resources: { file_search: { vector_store_ids: [VECTOR_STORE_ID] } }
});
  // 2) Thread mit User-Nachricht
  const thread = await client.beta.threads.create({
    messages: [{ role: "user", content: message }]
  });

  // 3) Run starten
  const run = await client.beta.threads.runs.create(thread.id, {
    assistant_id: assistant.id
  });

  // 4) Warten bis fertig
  await pollRunUntilDone(client, thread.id, run.id);

  // 5) Letzte Assistant-Antwort holen
  const msgs = await client.beta.threads.messages.list(thread.id, { order: "desc", limit: 1 });
  const latest = msgs.data?.[0];
  const textPart = latest?.content?.find(c => c.type === "text");
  return textPart?.text?.value || "Keine Antwort verfügbar.";
}

export default async function handler(req, res) {
  try {
    // --- CORS ---
    const origin = req.headers.origin || "";
    if (ALLOWED_ORIGINS.has(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.status(200).end();

    if (req.method !== "POST") return res.status(405).end("Method Not Allowed");

    // --- API-Key vorhanden? ---
    if (!process.env.OPENAI_API_KEY) {
      console.error("OPENAI_API_KEY fehlt");
      return res.status(500).json({ error: "API key missing on server" });
    }

    // --- Body lesen ---
    const body = await readJsonBody(req);
    const message = (body && body.message) ? String(body.message) : "Hallo!";

    // --- OpenAI-Client ---
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // --- 429-robuster Aufruf ---
    async function askOnce() {
      const output = await runAssistantWithFileSearch({ client, message });
      return { output_text: output };
    }

    let resp;
    try {
      resp = await askOnce();
    } catch (e) {
      if (e?.status === 429) {
        try { resp = await askOnce(); }
        catch {
          return res.status(503).json({
            error:
              "Momentan sind unsere KI-Kontingente erschöpft. Bitte nutze die Links: " +
              "Mitglied werden: https://www.tsv-griedel.de/mitglied-werden · " +
              "Spenden: https://www.tsv-griedel.de/spenden · " +
              "Probetraining: info@tsv-griedel.de"
          });
        }
      } else {
        throw e;
      }
    }

    const text = resp.output_text || "Keine Antwort verfügbar.";
    return res.status(200).json({ reply: text });

  } catch (e) {
    console.error("Server error:", e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
}
