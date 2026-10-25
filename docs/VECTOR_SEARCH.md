# ResolveX: vector database and semantic search design

This document answers the five questions in requirement 8 of the brief.

## The problem it solves

People describe the same fault in very different words:

| Report | Shared keywords with "AC not cooling" |
|---|---|
| "AC blowing warm air" | AC |
| "Room is extremely hot, everyone is sweating" | none |
| "Lab feels like an oven" | none |

Keyword search (even PostgreSQL full-text search) would treat these as unrelated. The result would be duplicate tickets, an underestimated number of affected people, and lost knowledge of how the problem was fixed last time. Sentence embeddings map text to points in a 384-dimensional space where texts with similar meaning sit close together.

## 1. What is converted into embeddings

One embedding per incident, built from **title + description + category name**:

```
"AC blowing warm air. The air conditioner in Computer Lab 1 (B-301) is blowing warm air instead of cold air
 even at an 18 degree setting. HVAC / Air Conditioning"
```

The exact text is stored in `incident_embeddings.source_text` (metadata). This lets `npm run db:embed` detect when an incident's text changed and re-embed it. Search queries and the draft text of a report being typed are embedded the same way, on the fly, and are not stored.

## 2. Embedding model

| Property | Value |
|---|---|
| Model | `sentence-transformers/all-MiniLM-L6-v2` (ONNX build `Xenova/all-MiniLM-L6-v2`) |
| Runtime | Transformers.js (`@huggingface/transformers`) inside the Next.js server: no paid API, no data leaves the campus server |
| Output | 384 dimensions, mean pooling, L2 normalised |
| Speed | about 5-20 ms per sentence on a laptop CPU after the model loads (the app displays the measured time) |
| Size | about 90 MB, downloaded once into `.model-cache/` |

This model was trained for semantic similarity on over 1 billion sentence pairs. It is small enough to run locally on a student laptop, which keeps the project free and works offline.

## 3. How vectors are stored

```sql
CREATE TABLE incident_embeddings (
    incident_id  INT PRIMARY KEY REFERENCES incidents(incident_id) ON DELETE CASCADE,
    embedding    vector(384) NOT NULL,           -- pgvector type
    model_name   VARCHAR(60) NOT NULL,           -- metadata: which model produced it
    source_text  TEXT NOT NULL,                  -- metadata: exactly what was embedded
    embedded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_incident_embeddings_hnsw
    ON incident_embeddings USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
```

- 1:1 with `incidents` and deleted with it (`ON DELETE CASCADE`).
- When an incident is reported, the incident row and its embedding are inserted in the **same transaction**. An incident can never exist without its vector.
- **HNSW** (Hierarchical Navigable Small World) is a graph index for approximate nearest-neighbour search. `m` is the number of links per node and `ef_construction` is the candidate list size at build time. Queries of the form `ORDER BY embedding <=> $1 LIMIT k` use it.

## 4. Similarity metric

**Cosine similarity.** pgvector's `<=>` operator returns cosine distance, so `similarity = 1 - (a <=> b)`. The vectors are L2-normalised, so cosine similarity equals the dot product and ranges from about 0 (unrelated) to 1 (same meaning). The thresholds below were tuned on the seed data.

| Use | Threshold |
|---|---|
| Possible duplicate while typing | match score ≥ 0.55 (similarity plus a location bonus) |
| Similar past fixes | similarity ≥ 0.45 |
| Similar incidents on a detail page | similarity ≥ 0.50 |
| Hybrid search, semantic-only hits | similarity ≥ 0.30 |

## 5. How relevant results are retrieved

Three SQL functions do all retrieval inside PostgreSQL. Each one joins the vector hits with the relational data in a single query.

### a) Duplicate detection while typing: `fn_detect_duplicates(vector, room_id, asset_id)`
1. The browser sends the draft (debounced at 650 ms) to `POST /api/incidents/similar`.
2. The server embeds the draft.
3. The function compares it only with **active** incidents from the **last 14 days**.
4. It adds a location bonus: +0.15 same asset, +0.10 same room, +0.05 same building. Physical closeness makes a duplicate much more likely.
5. The user sees each match with its similarity and can press **"I have this problem too"**. That inserts into `incident_reporters`, and a trigger chain raises `affected_users` and recomputes the priority.

### b) Known fixes: `fn_similar_incidents(vector, k, min_similarity)`
1. The nearest neighbours come from the HNSW index (`ORDER BY embedding <=> $1 LIMIT k*4+5`).
2. They are joined to rooms, buildings, categories and assets, plus the resolution notes of the completed work order.
3. Results are filtered by threshold, and duplicates and cancelled incidents are excluded.
4. Technicians see "How it was fixed before" on the report form and the incident page.

### c) Search page: `fn_hybrid_search(query, vector, k, mode)`
- `semantic`: top 50 by cosine distance.
- `keyword`: top 50 by `ts_rank_cd` on the GIN-indexed `tsvector` column (`websearch_to_tsquery`).
- `hybrid`: **Reciprocal Rank Fusion**, `score = 1/(60 + rank_semantic) + 1/(60 + rank_keyword)`. Results that both methods agree on rise to the top, while exact part numbers or names still match.

The search page shows each result's semantic rank, keyword rank and fused score, so the examiner can switch modes and see the difference live.

## Evidence

- `T28`: the five nearest neighbours of an AC incident are all HVAC incidents (similarity 0.95 down to 0.71).
- `A19`: the API finds a new "Water leaking from AC" report as a duplicate of "AC dripping water" (similarity 0.91, SAME_ASSET).
- Screenshots `03_report_duplicate_detection.png` and `04_semantic_search.png`. The search "room is too hot" ranks "AC blowing warm air" and "AC not cooling" incidents even though they share no keywords.
