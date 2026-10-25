// =====================================================================
// MongoDB access layer (document store).
// The connection string comes ONLY from MONGODB_URI (.env.local). The app
// logs in as resolvex_app, whose role (resolvexAppRole, created by
// db:setup) can read/write notes, append search events and read templates,
// but cannot drop collections, change validators or indexes, or bypass
// document validation.
//
// MongoDB has no row-level security and no foreign keys to PostgreSQL, so
// lib/notes.js checks access and the incident reference in PostgreSQL
// (under RLS) before every read or write.
// =====================================================================
import { MongoClient, ObjectId } from "mongodb";
import { HttpError } from "./auth";

export const mongoConfigured = () => Boolean(process.env.MONGODB_URI);

export async function mongoDb() {
  if (!mongoConfigured()) throw new HttpError(503, "The document store (MongoDB) is not configured: set MONGODB_URI in .env.local");
  if (!globalThis.__rxMongo) {
    const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 2500, maxPoolSize: 10, appName: "resolvex-web" });
    globalThis.__rxMongo = client.connect().catch((e) => {
      globalThis.__rxMongo = null; // retry on the next request
      throw e;
    });
  }
  return (await globalThis.__rxMongo).db(); // database name comes from the URI
}

export async function collection(name) {
  return (await mongoDb()).collection(name);
}

/** Parses a note id from the URL; never passes user input to MongoDB unchecked. */
export function objectId(value, name = "Note id") {
  if (typeof value !== "string" || !ObjectId.isValid(value) || value.length !== 24) throw new HttpError(400, `${name} is not valid`);
  return new ObjectId(value);
}

export const isMongoError = (err) => typeof err?.name === "string" && err.name.startsWith("Mongo");

/** Short, user friendly message + HTTP status for a MongoDB error. */
export function mongoError(err) {
  if (/ServerSelection|Network|Topology/.test(err.name) || err.code === "ECONNREFUSED")
    return [503, "The document store (MongoDB) is not reachable. Is the resolvex-mongo container running?"];
  switch (err.code) {
    case 121: {
      const why = firstValidationReason(err.errInfo?.details);
      return [400, "MongoDB rejected the document: it breaks the collection's $jsonSchema validator" + (why ? ` (${why})` : "")];
    }
    case 11000:
      return [400, "Duplicate value (unique index " + (err.message.match(/index: (\S+)/)?.[1] || "") + ")"];
    case 13:
      return [403, "Not allowed: the MongoDB role of the app does not permit this"];
    case 18:
      return [503, "MongoDB login failed: check MONGODB_URI in .env.local"];
    case 2:
    case 9:
      return [400, "Invalid MongoDB query: " + err.message];
    default:
      return [500, "Document store error: " + err.message];
  }
}

// digs the first readable reason out of MongoDB's validation error details
function firstValidationReason(d, depth = 0) {
  if (!d || depth > 8) return "";
  if (Array.isArray(d)) {
    for (const x of d) {
      const r = firstValidationReason(x, depth + 1);
      if (r) return r;
    }
    return "";
  }
  if (typeof d !== "object") return "";
  if (d.propertyName && d.details) return `${d.propertyName}: ${firstValidationReason(d.details, depth + 1) || "invalid"}`;
  if (d.reason && !d.details && !d.propertiesNotSatisfied && !d.schemasNotSatisfied) return d.reason + (d.consideredValue !== undefined ? ` (value ${JSON.stringify(d.consideredValue)})` : "");
  for (const k of ["schemaRulesNotSatisfied", "propertiesNotSatisfied", "details", "schemasNotSatisfied"]) {
    const r = firstValidationReason(d[k], depth + 1);
    if (r) return r;
  }
  return d.operatorName ? `failed ${d.operatorName}` : "";
}
