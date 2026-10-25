// Per-request context (who is logged in for THIS API request).
// route() opens a context, requireRole() stores the verified session in it,
// and lib/db.js reads it so every SQL statement runs with
// app.current_user_id set -> PostgreSQL Row-Level Security applies.
import { AsyncLocalStorage } from "node:async_hooks";

export const requestContext = globalThis.__rxRequestContext || new AsyncLocalStorage();
globalThis.__rxRequestContext = requestContext;

export function currentSession() {
  return requestContext.getStore()?.session || null;
}

export function setCurrentSession(session) {
  const store = requestContext.getStore();
  if (store) store.session = session;
}
