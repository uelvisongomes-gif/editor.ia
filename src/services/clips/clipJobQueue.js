// Clip Job Queue — Item 7.28.
// Processa clips em fila sem travar UI. Guarda estado em memória (por
// enquanto). Cada job tem estados: queued → processing → rendering → qc →
// completed | failed.
//
// Uso:
//   const q = createClipQueue({ onProgress, processorFn });
//   q.enqueue(clip);
//   q.start();

/**
 * @typedef {Object} ClipJob
 * @property {string} id
 * @property {object} clip
 * @property {"queued"|"processing"|"rendering"|"qc"|"completed"|"failed"} status
 * @property {string} [error]
 * @property {object} [result]
 * @property {number} progress   - 0-100
 * @property {number} enqueuedAt
 * @property {number} [startedAt]
 * @property {number} [finishedAt]
 */

export function createClipQueue({ processorFn, onProgress, maxParallel = 1 } = {}) {
  const jobs = [];
  let running = 0;
  let paused = false;

  const emit = () => onProgress?.(getSnapshot());

  const getSnapshot = () => jobs.map((j) => ({ ...j }));

  const enqueue = (clip) => {
    const job = {
      id: `job-${clip.id}-${Date.now()}`,
      clip, status: "queued", progress: 0,
      enqueuedAt: Date.now(),
    };
    jobs.push(job);
    emit();
    return job.id;
  };

  const processNext = async () => {
    if (paused) return;
    if (running >= maxParallel) return;
    const job = jobs.find((j) => j.status === "queued");
    if (!job) return;
    running++;
    job.status = "processing";
    job.startedAt = Date.now();
    emit();
    try {
      const result = await processorFn(job.clip, (progress, phase) => {
        job.progress = progress;
        if (phase) job.status = phase; // "processing" | "rendering" | "qc"
        emit();
      });
      job.status = "completed";
      job.progress = 100;
      job.result = result;
      job.finishedAt = Date.now();
    } catch (err) {
      job.status = "failed";
      job.error = err.message || String(err);
      job.finishedAt = Date.now();
    } finally {
      running--;
      emit();
      // Segue com o próximo
      setTimeout(processNext, 50);
    }
  };

  const start = () => {
    paused = false;
    for (let i = 0; i < maxParallel; i++) processNext();
  };

  const pause = () => { paused = true; };

  const retry = (jobId) => {
    const job = jobs.find((j) => j.id === jobId);
    if (!job || job.status !== "failed") return false;
    job.status = "queued";
    job.error = undefined;
    job.progress = 0;
    emit();
    if (!paused) processNext();
    return true;
  };

  const clear = () => {
    jobs.length = 0;
    emit();
  };

  return { enqueue, start, pause, retry, clear, getSnapshot };
}
