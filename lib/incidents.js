// Incident helpers shared by several API routes.
import { query } from "./db";
import { embed, incidentText, toPgVector, EMBEDDING_MODEL } from "./embeddings";

/** Creates embeddings for incidents that do not have one (e.g. system generated preventive incidents). */
export async function embedMissingIncidents() {
  const rows = await query(`
      SELECT i.incident_id, i.title, i.description, c.category_name
        FROM incidents i
        JOIN asset_categories c ON c.category_id = i.category_id
       WHERE NOT EXISTS (SELECT 1 FROM incident_embeddings e WHERE e.incident_id = i.incident_id)`);
  for (const r of rows) {
    const text = incidentText({ title: r.title, description: r.description, category: r.category_name });
    const vec = await embed(text);
    await query(
      `INSERT INTO incident_embeddings (incident_id, embedding, model_name, source_text)
       VALUES ($1, $2::vector, $3, $4) ON CONFLICT (incident_id) DO NOTHING`,
      [r.incident_id, toPgVector(vec), EMBEDDING_MODEL, text]
    );
  }
  return rows.length;
}
