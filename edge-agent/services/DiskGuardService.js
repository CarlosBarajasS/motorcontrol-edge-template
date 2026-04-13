const fs   = require('fs');
const path = require('path');

// ── Defaults (all overridable via env) ────────────────────────────────────────
const DEFAULT_RECORDINGS_PATH  = process.env.RECORDINGS_PATH         || '/data/recordings';
const DEFAULT_TARGET_FREE_GB   = parseFloat(process.env.DISK_TARGET_FREE_GB)   || 8;    // GB to keep free
const DEFAULT_EMERGENCY_FREE_GB= parseFloat(process.env.DISK_EMERGENCY_FREE_GB)|| 2;    // GB — emergency mode
const DEFAULT_MAX_RETENTION_DAYS= parseInt(process.env.DISK_MAX_RETENTION_DAYS)|| 7;    // hard cap
const DEFAULT_INTERVAL_MS      = parseInt(process.env.DISK_GUARD_INTERVAL_MS)  || 15 * 60 * 1000; // 15 min

const GB = 1024 ** 3;

class DiskGuardService {
  /**
   * Proactive disk manager for edge recording nodes.
   *
   * Strategy (executed every `intervalMs`):
   *   1. Read real available bytes from the filesystem.
   *   2. Enforce max-retention cap: delete hour-dirs older than MAX_RETENTION_DAYS.
   *   3. If free < TARGET_FREE_GB  → incremental cleanup (oldest hour-dirs first)
   *      until free >= TARGET_FREE_GB or nothing left to delete.
   *   4. If free < EMERGENCY_FREE_GB → emergency cleanup: keep only the last 2 hours
   *      across all channels, then notify.
   *
   * Directory structure expected:
   *   recordings/
   *     canal-1/
   *       2026-04-12/
   *         14-00-00.mp4   (or sub-hour dirs — both handled)
   *       2026-04-13/
   *     canal-1-low/
   *       ...
   *
   * @param {object}   opts
   * @param {string}   [opts.recordingsPath]     Path to recordings root
   * @param {number}   [opts.targetFreeGb]       GB to always keep free (default 8)
   * @param {number}   [opts.emergencyFreeGb]    GB below which emergency mode triggers (default 2)
   * @param {number}   [opts.maxRetentionDays]   Hard cap — never keep more than N days (default 7)
   * @param {number}   [opts.intervalMs]         Check interval in ms (default 15 min)
   * @param {Function} [opts.onCleanup]          Callback(freedBytes, deletedCount, mode)
   */
  constructor(opts = {}) {
    this.recordingsPath   = opts.recordingsPath    ?? DEFAULT_RECORDINGS_PATH;
    this.targetFreeGb     = opts.targetFreeGb      ?? DEFAULT_TARGET_FREE_GB;
    this.emergencyFreeGb  = opts.emergencyFreeGb   ?? DEFAULT_EMERGENCY_FREE_GB;
    this.maxRetentionDays = opts.maxRetentionDays  ?? DEFAULT_MAX_RETENTION_DAYS;
    this.intervalMs       = opts.intervalMs        ?? DEFAULT_INTERVAL_MS;
    this.onCleanup        = opts.onCleanup         ?? null;
    this._timer           = null;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  start() {
    console.log(
      `[DiskGuard] Started — target free: ${this.targetFreeGb} GB, ` +
      `emergency: ${this.emergencyFreeGb} GB, ` +
      `max retention: ${this.maxRetentionDays} days, ` +
      `interval: ${this.intervalMs / 60000} min`
    );
    this._runCheck();
    this._timer = setInterval(() => this._runCheck(), this.intervalMs);
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  // ── Core logic ────────────────────────────────────────────────────────────

  async _runCheck() {
    if (!fs.existsSync(this.recordingsPath)) return;

    const usage = this._getDiskUsage(this.recordingsPath);
    if (!usage) return;

    const freeGb = usage.availableBytes / GB;
    console.log(
      `[DiskGuard] Free: ${freeGb.toFixed(2)} GB / ${(usage.totalBytes / GB).toFixed(1)} GB ` +
      `(${usage.usedPercent.toFixed(1)}% used)`
    );

    // Step 1 — enforce hard retention cap regardless of free space
    const retentionFreed = await this._enforceRetentionCap();
    if (retentionFreed > 0) {
      console.log(`[DiskGuard] Retention cap freed ${this._fmt(retentionFreed)}`);
    }

    // Re-read after retention cleanup
    const fresh = this._getDiskUsage(this.recordingsPath);
    if (!fresh) return;
    const freshFreeGb = fresh.availableBytes / GB;

    // Step 2 — emergency mode
    if (freshFreeGb < this.emergencyFreeGb) {
      console.error(`[DiskGuard] 🚨 Emergency — only ${freshFreeGb.toFixed(2)} GB free, keeping last 2 hours only`);
      await this._emergencyCleanup();
      return;
    }

    // Step 3 — incremental cleanup toward target
    if (freshFreeGb < this.targetFreeGb) {
      const needed = (this.targetFreeGb - freshFreeGb) * GB;
      console.warn(`[DiskGuard] ⚠️  Below target — need to free ${this._fmt(needed)}`);
      await this._incrementalCleanup(this.targetFreeGb);
    }
  }

  // ── Cleanup strategies ────────────────────────────────────────────────────

  /**
   * Delete day-directories older than maxRetentionDays across all channels.
   * Returns total bytes freed.
   */
  async _enforceRetentionCap() {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - this.maxRetentionDays);
    const cutoffStr = cutoff.toISOString().slice(0, 10); // YYYY-MM-DD

    const oldDays = this._collectDayDirs().filter(d => d.date < cutoffStr);
    let freed = 0;
    for (const { fullPath, date } of oldDays) {
      freed += await this._deleteDir(fullPath, `retention cap (>${this.maxRetentionDays}d, date: ${date})`);
    }
    return freed;
  }

  /**
   * Delete oldest hour-entries (across ALL channels for the same date+hour slot)
   * until free space reaches targetFreeGb.
   */
  async _incrementalCleanup(targetFreeGb) {
    const slots    = this._collectHourSlots(); // [{dateHour, paths[]}] oldest-first
    let freedBytes = 0;
    let deleted    = 0;

    for (const slot of slots) {
      const current = this._getDiskUsage(this.recordingsPath);
      if (!current || current.availableBytes / GB >= targetFreeGb) break;

      for (const p of slot.paths) {
        freedBytes += await this._deleteDir(p, `incremental (slot ${slot.dateHour})`);
        deleted++;
      }
    }

    if (freedBytes > 0) {
      const afterFree = (this._getDiskUsage(this.recordingsPath)?.availableBytes ?? 0) / GB;
      console.log(`[DiskGuard] Incremental cleanup freed ${this._fmt(freedBytes)} (${deleted} entries), free now ${afterFree.toFixed(2)} GB`);
      if (this.onCleanup) this.onCleanup(freedBytes, deleted, 'incremental');
    }
  }

  /**
   * Emergency: delete everything except recordings from the last 2 hours.
   */
  async _emergencyCleanup() {
    const now         = Date.now();
    const keepAfterMs = now - 2 * 60 * 60 * 1000;
    const slots       = this._collectHourSlots();
    let freedBytes    = 0;
    let deleted       = 0;

    for (const slot of slots) {
      // Parse slot "YYYY-MM-DD/HH" as UTC for comparison
      const [datePart, hourPart] = slot.dateHour.split('/');
      const slotMs = new Date(`${datePart}T${hourPart}:00:00Z`).getTime();
      if (slotMs >= keepAfterMs) continue; // keep last 2 h

      for (const p of slot.paths) {
        freedBytes += await this._deleteDir(p, `emergency`);
        deleted++;
      }
    }

    const afterFree = (this._getDiskUsage(this.recordingsPath)?.availableBytes ?? 0) / GB;
    console.error(`[DiskGuard] 🚨 Emergency cleanup freed ${this._fmt(freedBytes)} (${deleted} entries), free now ${afterFree.toFixed(2)} GB`);
    if (this.onCleanup) this.onCleanup(freedBytes, deleted, 'emergency');
  }

  // ── Directory collection ──────────────────────────────────────────────────

  /**
   * Returns all YYYY-MM-DD day-directories across all channel folders.
   * [{fullPath, date}] — unsorted.
   */
  _collectDayDirs() {
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    const result  = [];
    for (const channelDir of this._channelDirs()) {
      try {
        for (const e of fs.readdirSync(channelDir, { withFileTypes: true })) {
          if (e.isDirectory() && DATE_RE.test(e.name)) {
            result.push({ fullPath: path.join(channelDir, e.name), date: e.name });
          }
        }
      } catch { /* skip */ }
    }
    return result;
  }

  /**
   * Groups recording content by (date, hour) slot across all channels.
   * Within each slot, `paths` contains one entry per channel (day-dir if no
   * hour subdirs, or individual hour-subdir).
   *
   * Returns [{dateHour: "YYYY-MM-DD/HH", paths: []}] sorted oldest-first.
   * The current date+hour slot is excluded (never delete ongoing recordings).
   */
  _collectHourSlots() {
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    const HOUR_RE = /^\d{2}(-\d{2}-\d{2})?$/; // HH or HH-MM-SS

    const now         = new Date();
    const currentDate = now.toISOString().slice(0, 10);
    const currentHour = now.getUTCHours().toString().padStart(2, '0');
    const currentSlot = `${currentDate}/${currentHour}`;

    // map: "YYYY-MM-DD/HH" → [absPath, ...]
    const slotMap = new Map();

    const addToSlot = (key, absPath) => {
      if (!slotMap.has(key)) slotMap.set(key, []);
      slotMap.get(key).push(absPath);
    };

    for (const channelDir of this._channelDirs()) {
      try {
        for (const dayEntry of fs.readdirSync(channelDir, { withFileTypes: true })) {
          if (!dayEntry.isDirectory() || !DATE_RE.test(dayEntry.name)) continue;
          const dayPath = path.join(channelDir, dayEntry.name);

          // Check if day-dir contains hour subdirs
          let hourEntries = [];
          try {
            hourEntries = fs.readdirSync(dayPath, { withFileTypes: true })
              .filter(e => e.isDirectory() && HOUR_RE.test(e.name));
          } catch { /* skip */ }

          if (hourEntries.length > 0) {
            for (const hourEntry of hourEntries) {
              const hour = hourEntry.name.slice(0, 2);
              const slotKey = `${dayEntry.name}/${hour}`;
              if (slotKey === currentSlot) continue;
              addToSlot(slotKey, path.join(dayPath, hourEntry.name));
            }
          } else {
            // No hour subdirs — treat the whole day-dir as one slot per hour "00"
            const slotKey = `${dayEntry.name}/00`;
            if (slotKey === currentSlot) continue;
            addToSlot(slotKey, dayPath);
          }
        }
      } catch { /* skip */ }
    }

    return Array.from(slotMap.entries())
      .map(([dateHour, paths]) => ({ dateHour, paths }))
      .sort((a, b) => a.dateHour.localeCompare(b.dateHour));
  }

  _channelDirs() {
    try {
      return fs.readdirSync(this.recordingsPath, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => path.join(this.recordingsPath, e.name));
    } catch {
      return [];
    }
  }

  // ── Low-level helpers ─────────────────────────────────────────────────────

  async _deleteDir(absPath, reason) {
    const size = this._dirSize(absPath);
    try {
      fs.rmSync(absPath, { recursive: true, force: true });
      console.log(`[DiskGuard] 🗑  ${absPath} (${this._fmt(size)}) [${reason}]`);
      return size;
    } catch (err) {
      console.error(`[DiskGuard] Failed to delete ${absPath}:`, err.message);
      return 0;
    }
  }

  _getDiskUsage(targetPath) {
    try {
      const stat          = fs.statfsSync(targetPath);
      const total         = stat.blocks * stat.bsize;
      const available     = stat.bavail * stat.bsize;
      return {
        totalBytes:     total,
        usedBytes:      total - available,
        availableBytes: available,
        usedPercent:    ((total - available) / total) * 100,
      };
    } catch (err) {
      console.error('[DiskGuard] Could not read disk stats:', err.message);
      return null;
    }
  }

  _dirSize(dirPath) {
    let total = 0;
    try {
      for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
        const full = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          total += this._dirSize(full);
        } else {
          try { total += fs.statSync(full).size; } catch { /* skip */ }
        }
      }
    } catch { /* skip */ }
    return total;
  }

  _fmt(bytes) {
    if (bytes >= GB)      return `${(bytes / GB).toFixed(2)} GB`;
    if (bytes >= 1e6)     return `${(bytes / 1e6).toFixed(1)} MB`;
    return `${(bytes / 1e3).toFixed(0)} KB`;
  }
}

module.exports = DiskGuardService;
