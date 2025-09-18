import { set, get, del, createStore } from "idb-keyval";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client"; // keeps types available

const CACHE_DB_NAME = "cnm-react-query";
const CACHE_STORE_NAME = "cache";
const CACHE_KEY = "query-cache";

function hasIndexedDB() {
  try { return typeof indexedDB !== "undefined"; } catch { return false; }
}

let idbStore = null;
if (hasIndexedDB()) {
  try { idbStore = createStore(CACHE_DB_NAME, CACHE_STORE_NAME); } catch {}
}

async function idbSet(key, value) { return set(key, value, idbStore); }
async function idbGet(key) { return get(key, idbStore); }
async function idbDel(key) { return del(key, idbStore); }

const lsPersister = {
  persistClient: async (client) => localStorage.setItem(CACHE_KEY, JSON.stringify(client)),
  restoreClient: async () => {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : undefined;
  },
  removeClient: async () => localStorage.removeItem(CACHE_KEY),
};

/** @type {import('@tanstack/react-query-persist-client').Persister} */
export const idbPersister = idbStore
  ? { persistClient: (c) => idbSet(CACHE_KEY, c), restoreClient: () => idbGet(CACHE_KEY), removeClient: () => idbDel(CACHE_KEY) }
  : lsPersister;

// Export to keep bundlers from tree-shaking plugin types
export const _PersistQueryClientProvider = PersistQueryClientProvider;
