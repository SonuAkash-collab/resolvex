// =====================================================================
// Embedding service (server side only).
// Model : sentence-transformers all-MiniLM-L6-v2 (ONNX build "Xenova/all-MiniLM-L6-v2")
//         run locally with Transformers.js - no paid API, no data leaves the server.
// Output: 384-dimensional vector, mean pooled and L2-normalised, so
//         cosine similarity = dot product. Stored in pgvector column vector(384).
// =====================================================================
import { pipeline, env } from "@huggingface/transformers";
import path from "node:path";

export const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "Xenova/all-MiniLM-L6-v2";
export const EMBEDDING_DIM = 384;

// Look for a local copy first (./models/Xenova/all-MiniLM-L6-v2), otherwise
// download once from the Hugging Face hub and cache it in ./.model-cache
env.localModelPath = process.env.EMBEDDING_MODEL_PATH || path.join(process.cwd(), "models");
env.cacheDir = path.join(process.cwd(), ".model-cache");
env.allowLocalModels = true;
env.allowRemoteModels = process.env.EMBEDDING_ALLOW_REMOTE !== "false";

let extractorPromise = globalThis.__resolvexExtractor;

function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = pipeline("feature-extraction", EMBEDDING_MODEL, { dtype: "fp32" });
    globalThis.__resolvexExtractor = extractorPromise; // survive Next.js hot reloads
  }
  return extractorPromise;
}

/** Text that represents an incident for semantic search. */
export function incidentText({ title, description, category }) {
  return [title, description, category].filter(Boolean).join(". ");
}

/** Returns a plain JS array of 384 numbers. */
export async function embed(text) {
  const extractor = await getExtractor();
  const output = await extractor(text, { pooling: "mean", normalize: true });
  return Array.from(output.data);
}

/** pgvector literal: '[0.1,0.2,...]' */
export function toPgVector(vec) {
  return "[" + vec.map((v) => Number(v).toFixed(6)).join(",") + "]";
}
