import { api } from "../core/api.js";
import { openDb } from "../offline/idb.js";
import { flush, pendingCount } from "../offline/outbox.js";

let db = null;
const listeners = [];

const sender = {
  async submit(payload) {
    return api.post("/inspections", payload);
  },
  async upload(inspectionId, photo) {
    const form = new FormData();
    form.append("kind", photo.kind);
    form.append("capturedAt", photo.capturedAt);
    form.append("file", photo.blob, `${photo.kind.toLowerCase()}.jpg`);
    return api.postForm(`/inspections/${inspectionId}/evidence`, form);
  },
};

export async function initSync() {
  if (db) return db;
  db = await openDb();
  window.addEventListener("online", () => { syncNow(); });
  setInterval(() => { if (navigator.onLine) syncNow(); }, 60000);
  await refreshBadge();
  return db;
}

export function getDb() {
  return db;
}

export async function syncNow() {
  if (!db || !navigator.onLine) return { sent: 0, failed: 0, skipped: 0 };
  const result = await flush(db, sender);
  await refreshBadge();
  return result;
}

export async function refreshBadge() {
  const count = db ? await pendingCount(db) : 0;
  listeners.forEach((cb) => cb(count));
  return count;
}

export function onBadgeChange(cb) {
  listeners.push(cb);
}
