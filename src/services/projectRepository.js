// Storage abstraction so the UI never talks to localStorage directly.
// Swap the adapter (localStorageAdapter → supabaseAdapter → ...) without
// touching App.jsx.
//
// A project snapshot is a plain JSON object; it never carries the video
// blob itself (blobs are too big and not portable across origins). We save
// the file name/size + a hash so the UI can ask the user to re-attach the
// same file when reopening.

import { localStorageAdapter } from "./storageAdapters/localStorageAdapter.js";
import { stampsForProject } from "./pipelineVersion.js";

let _adapter = localStorageAdapter;

export function setStorageAdapter(adapter) {
  _adapter = adapter;
}

export function currentAdapter() {
  return _adapter;
}

function newProjectId() {
  return "proj-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/**
 * Build a serializable snapshot of the current editor state.
 * The caller decides which fields to include — we don't presume.
 */
export function buildProjectSnapshot(fields) {
  return {
    id: fields.id || newProjectId(),
    name: fields.name || "Projeto sem nome",
    createdAt: fields.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    video: fields.video || null,          // { fileName, size, durationSec, hash? }
    intensityId: fields.intensityId || null,
    transcript: fields.transcript || null,
    words: fields.words || null,
    edl: fields.edl || null,
    segments: fields.segments || null,
    narrativeTopic: fields.narrativeTopic || null,
    metrics: fields.metrics || null,
    feedback: fields.feedback || null,
    usage: fields.usage || null,
    stamps: fields.stamps || stampsForProject(),
  };
}

export async function saveProject(snapshot) {
  const withUpdate = { ...snapshot, updatedAt: new Date().toISOString() };
  await _adapter.save(withUpdate);
  return withUpdate;
}

export async function loadProject(id) {
  return _adapter.load(id);
}

export async function listProjects() {
  return _adapter.list();
}

export async function deleteProject(id) {
  return _adapter.remove(id);
}
