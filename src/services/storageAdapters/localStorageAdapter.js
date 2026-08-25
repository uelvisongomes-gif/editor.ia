// localStorage-backed adapter. Intended as a dev/fallback storage — for
// production plug a proper backend adapter (Supabase, Firestore, etc.).
//
// Layout:
//   crie:projects:index       → array of {id, name, updatedAt}
//   crie:projects:<id>        → the full snapshot as JSON
//
// If localStorage is unavailable (private mode, quota, some browsers),
// every function degrades to an in-memory Map for the session so the UI
// keeps working — nothing persists across reloads in that case.

const KEY_INDEX = "crie:projects:index";
const KEY_PREFIX = "crie:projects:";

let _memory = null;

function memory() {
  if (!_memory) _memory = new Map();
  return _memory;
}

function canUseLocalStorage() {
  try {
    if (typeof window === "undefined" || !window.localStorage) return false;
    const probe = "__crie_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

function readIndex() {
  if (!canUseLocalStorage()) return Array.from(memory().values()).map((p) => ({ id: p.id, name: p.name, updatedAt: p.updatedAt }));
  try {
    const raw = window.localStorage.getItem(KEY_INDEX);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeIndex(index) {
  if (!canUseLocalStorage()) return;
  try {
    window.localStorage.setItem(KEY_INDEX, JSON.stringify(index));
  } catch (err) {
    // Quota — surface as a warning; caller handles persistence failure.
    console.warn("localStorage index write failed:", err);
  }
}

export const localStorageAdapter = {
  async save(snapshot) {
    if (!snapshot?.id) throw new Error("Snapshot sem id.");
    if (!canUseLocalStorage()) {
      memory().set(snapshot.id, snapshot);
      return snapshot;
    }
    try {
      window.localStorage.setItem(KEY_PREFIX + snapshot.id, JSON.stringify(snapshot));
      const idx = readIndex().filter((p) => p.id !== snapshot.id);
      idx.unshift({ id: snapshot.id, name: snapshot.name, updatedAt: snapshot.updatedAt });
      writeIndex(idx);
      return snapshot;
    } catch (err) {
      console.warn("localStorage save failed:", err);
      memory().set(snapshot.id, snapshot); // fallback so the session keeps state
      return snapshot;
    }
  },

  async load(id) {
    if (!id) return null;
    if (!canUseLocalStorage()) return memory().get(id) || null;
    try {
      const raw = window.localStorage.getItem(KEY_PREFIX + id);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },

  async list() {
    const idx = readIndex();
    return idx.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  },

  async remove(id) {
    if (!id) return;
    if (canUseLocalStorage()) {
      try {
        window.localStorage.removeItem(KEY_PREFIX + id);
        writeIndex(readIndex().filter((p) => p.id !== id));
      } catch (err) {
        console.warn("localStorage remove failed:", err);
      }
    }
    memory().delete(id);
  },
};
