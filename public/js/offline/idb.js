export function openDb(name = "psru_wifi", version = 1) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("outbox")) db.createObjectStore("outbox", { keyPath: "clientUuid" });
      if (!db.objectStoreNames.contains("points")) db.createObjectStore("points", { keyPath: "id" });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, store, mode) {
  return db.transaction(store, mode).objectStore(store);
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const put = (db, store, value) => wrap(tx(db, store, "readwrite").put(value));
export const getAll = (db, store) => wrap(tx(db, store, "readonly").getAll());
export const get = (db, store, key) => wrap(tx(db, store, "readonly").get(key));
export const del = (db, store, key) => wrap(tx(db, store, "readwrite").delete(key));
export const clear = (db, store) => wrap(tx(db, store, "readwrite").clear());
