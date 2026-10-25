// Reads database/09_queries.sql and splits it into named queries.
// Header format inside the file:   -- @q <id> | <title> | <concepts>
import fs from "node:fs";
import path from "node:path";

export function loadShowcaseQueries() {
  const file = path.join(process.cwd(), "database", "09_queries.sql");
  const text = fs.readFileSync(file, "utf8");
  const parts = text.split(/^-- @q /m).slice(1);
  return parts.map((chunk) => {
    const [header, ...rest] = chunk.split("\n");
    const [id, title, concepts] = header.split("|").map((s) => s.trim());
    const sql = rest.join("\n").trim().replace(/;\s*$/, "");
    return { id, title, concepts: concepts.split(",").map((c) => c.trim()), sql };
  });
}
