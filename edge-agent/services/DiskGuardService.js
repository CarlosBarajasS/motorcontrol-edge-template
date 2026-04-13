const fs   = require('fs');
const path = require('path');

const DEFAULT_RECORDINGS_PATH  = process.env.RECORDINGS_PATH  || '/data/recordings';
const DEFAULT_WARN_THRESHOLD   = parseInt(process.env.DISK_WARN_THRESHOLD)  || 75; // %
const DEFAULT_CRIT_THRESHOLD   = parseInt(process.env.DISK_CRIT_THRESHOLD)  || 90; // %
const DEFAULT_INTERVAL_MS      = parseInt(process.env.DISK_GUARD_INTERVAL_MS) || 60 * 60 * 1000; // 1 h

class DiskGuardService {
  /**
   * @param {object} opts
   * @param {string}   [opts.recordingsPath]   Absolute path to the recordings directory
   * @param {number}   [opts.warnThreshold]    Disk usage % that triggers a warning (default 75)
   * @param {number}   [opts.critThreshold]    Disk usage % that triggers auto-cleanup (default 90)
   * @param {number}   [opts.intervalMs]       How often to run the check (default 1 h)
   * @param {Function} [opts.onWarn]           Callback(usedPercent) when warn threshold is crossed
   * @param {Function} [opts.onCleanup]        Callback(freedBytes, deletedDirs) after cleanup
   */
  constructor(opts = {}) {
    this.recordingsPath = opts.recordingsPath ?? DEFAULT_RECORDINGS_PATH;
    this.warnThreshold  = opts.warnThreshold  ?? DEFAULT_WARN_THRESHOLD;
    this.critThreshold  = opts.critThreshold  ?? DEFAULT_CRIT_THRESHOLD;
    this.intervalMs     = opts.intervalMs     ?? DEFAULT_INTERVAL_MS;
    this.onWarn         = opts.onWarn         ?? null;
    this.onCleanup      = opts.onCleanup      ?? null;
    this._timer         = null;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  start() {
    console.log(
      `[DiskGuard] Started — recordings: ${this.recordingsPath}, ` +
      `warn: ${this.warnThreshold}%, crit: ${this.critThreshold}%, ` +
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

  // ── Core logic ───────────────────────────────────────────────────────────

  async _runCheck() {
    const usage = this._getDiskUsage(this.recordingsPath);
    if (usage === null) return;

    const { usedPercent, availableBytes } = usage;

    console.log(`[DiskGuard] Disk usage: ${usedPercent.toFixed(1)}% (${this._formatBytes(availableBytes)} free)`);

    if (usedPercent >= this.critThreshold) {
      console.warn(`[DiskGuard] ⚠️  Critical threshold reached (${usedPercent.toFixed(1)}%) — starting cleanup`);
      await this._cleanup(usedPercent);
    } else if (usedPercent >= this.warnThreshold) {
      console.warn(`[DiskGuard] ⚠️  Warning threshold reached (${usedPercent.toFixed(1)}%)`);
      if (this.onWarn) this.onWarn(usedPercent);
    }
  }

  async _cleanup(currentUsed) {
    if (!fs.existsSync(this.recordingsPath)) {
      console.warn(`[DiskGuard] Recordings path does not exist: ${this.recordingsPath}`);
      return;
    }

    // Collect all dated sub-directories (YYYY-MM-DD) across all channel folders,
    // sorted oldest-first. Today's directory is never deleted.
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const candidates = this._collectDateDirs(today);

    if (candidates.length === 0) {
      console.warn('[DiskGuard] No old recording directories to clean up');
      return;
    }

    let freedBytes   = 0;
    const deleted    = [];
    let usedPercent  = currentUsed;

    for (const dir of candidates) {
      if (usedPercent < this.warnThreshold) break;

      const dirSize = this._dirSize(dir);
      try {
        fs.rmSync(dir, { recursive: true, force: true });
        freedBytes  += dirSize;
        deleted.push(dir);
        usedPercent  = this._getDiskUsage(this.recordingsPath)?.usedPercent ?? usedPercent;
        console.log(`[DiskGuard] 🗑  Deleted ${dir} (${this._formatBytes(dirSize)}), disk now ${usedPercent.toFixed(1)}%`);
      } catch (err) {
        console.error(`[DiskGuard] Failed to delete ${dir}:`, err.message);
      }
    }

    console.log(
      `[DiskGuard] Cleanup done — freed ${this._formatBytes(freedBytes)} ` +
      `across ${deleted.length} director${deleted.length === 1 ? 'y' : 'ies'}`
    );

    if (this.onCleanup) this.onCleanup(freedBytes, deleted);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Returns all YYYY-MM-DD subdirectories inside each channel folder,
   * excluding today, sorted oldest-first.
   *
   * Structure expected:
   *   recordings/
   *     canal-1/
   *       2026-04-10/  ← candidate
   *       2026-04-11/  ← candidate
   *     canal-1-low/
   *       ...
   */
  _collectDateDirs(today) {
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    const result  = [];

    let channelDirs;
    try {
      channelDirs = fs.readdirSync(this.recordingsPath, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => path.join(this.recordingsPath, e.name));
    } catch (err) {
      console.error('[DiskGuard] Cannot read recordings path:', err.message);
      return [];
    }

    for (const channelDir of channelDirs) {
      try {
        const dateDirs = fs.readdirSync(channelDir, { withFileTypes: true })
          .filter(e => e.isDirectory() && DATE_RE.test(e.name) && e.name !== today)
          .map(e => ({ fullPath: path.join(channelDir, e.name), date: e.name }));
        result.push(...dateDirs);
      } catch {
        // Non-critical — skip unreadable channel dirs
      }
    }

    // Sort oldest first so we free the most stale data first
    result.sort((a, b) => a.date.localeCompare(b.date));
    return result.map(e => e.fullPath);
  }

  /**
   * Returns disk usage for the filesystem containing `targetPath`.
   * Uses Node's fs.statfsSync (Node 18+); falls back to null on error.
   */
  _getDiskUsage(targetPath) {
    try {
      const stat = fs.statfsSync(targetPath);
      const total     = stat.blocks  * stat.bsize;
      const available = stat.bavail  * stat.bsize;
      const used      = total - available;
      return {
        totalBytes:     total,
        usedBytes:      used,
        availableBytes: available,
        usedPercent:    (used / total) * 100,
      };
    } catch (err) {
      console.error('[DiskGuard] Could not read disk stats:', err.message);
      return null;
    }
  }

  /** Recursively sum the size of a directory in bytes. */
  _dirSize(dirPath) {
    let total = 0;
    try {
      for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          total += this._dirSize(fullPath);
        } else {
          try { total += fs.statSync(fullPath).size; } catch { /* skip */ }
        }
      }
    } catch { /* skip unreadable dirs */ }
    return total;
  }

  _formatBytes(bytes) {
    if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
    if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
    return `${(bytes / 1e3).toFixed(0)} KB`;
  }
}

module.exports = DiskGuardService;
