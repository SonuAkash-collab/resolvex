// =====================================================================
// Generates sentence embeddings for every incident that does not have
// one yet (or whose text changed) and stores them in incident_embeddings.
// Usage: npm run db:embed
// =====================================================================
import dotenv from "dotenv";
import pg from "pg";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline, env } from "@huggingface/transformers";

dotenv.config({ path: ".env.local" });
dotenv.config();

const MODEL = process.env.EMBEDDING_MODEL || "Xenova/all-MiniLM-L6-v2";
env.localModelPath = process.env.EMBEDDING_MODEL_PATH || path.join(process.cwd(), "models");
env.cacheDir = path.join(process.cwd(), ".model-cache");
env.allowRemoteModels = process.env.EMBEDDING_ALLOW_REMOTE !== "false";

export async function embedAll(connectionString = process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL) {
  console.log(`loading embedding model ${MODEL} (first run downloads ~90 MB) ...`);
  const extractor = await pipeline("feature-extraction", MODEL, { dtype: "fp32" });
  const client = new pg.Client({ connectionString });
  await client.connect();

  const { rows } = await client.query(`
      SELECT i.incident_id, i.title, i.description, c.category_name
        FROM incidents i
        JOIN asset_categories c ON c.category_id = i.category_id
        LEFT JOIN incident_embeddings e ON e.incident_id = i.incident_id
       WHERE e.incident_id IS NULL
          OR e.source_text <> concat_ws('. ', i.title, i.description, c.category_name)
       ORDER BY i.incident_id`);

  let n = 0;
  for (const r of rows) {
    const text = [r.title, r.description, r.category_name].join(". ");
    const out = await extractor(text, { pooling: "mean", normalize: true });
    const vec = "[" + Array.from(out.data).map((v) => v.toFixed(6)).join(",") + "]";
    await client.query(
      `INSERT INTO incident_embeddings (incident_id, embedding, model_name, source_text)
       VALUES ($1, $2::vector, $3, $4)
       ON CONFLICT (incident_id) DO UPDATE
         SET embedding = EXCLUDED.embedding, model_name = EXCLUDED.model_name,
             source_text = EXCLUDED.source_text, embedded_at = now()`,
      [r.incident_id, vec, MODEL, text]
    );
    n++;
    if (n % 25 === 0) process.stdout.write(`  embedded ${n}/${rows.length}\n`);
  }
  await client.end();
  console.log(`embeddings stored for ${n} incident(s)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  embedAll().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
