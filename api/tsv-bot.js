// package.json braucht "type": "module" (siehe unten).
import OpenAI from "openai";

export default async function handler(req, res) {
  // CORS: Erlaube nur eure Domain!
  res.setHeader("Access-Control-Allow-Origin", "https://www.tsv-griedel.de"); // <- anpassen
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end("Method Not Allowed");

  try {
    const { message = "Hallo!" } = req.body || {};
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      instructions:
        "Du bist der Vereinsassistent des TSV 1899 Griedel e.V. " +
        "Antworte kurz, freundlich und konkret. Biete, wo sinnvoll, Handlungslinks an " +
        "(Mitglied werden, Spenden, Probetraining). Wenn etwas unklar ist, stelle genau eine Rückfrage.",
      input: message
    });

    res.status(200).json({ reply: response.output_text ?? "Keine Antwort verfügbar." });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Serverfehler" });
  }
}
