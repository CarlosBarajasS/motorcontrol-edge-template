const si = require('systeminformation');
const os = require('os');

class SystemMonitorService {
  constructor() {
    this.stats = {};
  }

  /**
   * Obtener estadísticas del sistema
   */
  async getSystemStats() {
    try {
      const [cpu, mem, disk, network] = await Promise.all([
        si.currentLoad(),
        si.mem(),
        si.fsSize(),
        si.networkStats(),
      ]);

      this.stats = {
        cpu: {
          usage: cpu.currentLoad.toFixed(2),
          cores: os.cpus().length,
          temperature: await this.getCpuTemperature(),
        },
        memory: {
          total: (mem.total / 1024 / 1024).toFixed(0), // MB
          used: (mem.used / 1024 / 1024).toFixed(0),
          free: (mem.free / 1024 / 1024).toFixed(0),
          usagePercent: ((mem.used / mem.total) * 100).toFixed(2),
        },
        disk: disk.map(d => ({
          fs: d.fs,
          mount: d.mount,
          size: (d.size / 1024 / 1024 / 1024).toFixed(2), // GB
          used: (d.used / 1024 / 1024 / 1024).toFixed(2),
          available: (d.available / 1024 / 1024 / 1024).toFixed(2),
          usagePercent: d.use.toFixed(2),
        })),
        network: network.map(n => ({
          iface: n.iface,
          rx_bytes: n.rx_bytes,
          tx_bytes: n.tx_bytes,
          rx_sec: n.rx_sec,
          tx_sec: n.tx_sec,
        })),
        uptime: process.uptime(),
        hostname: os.hostname(),
        platform: os.platform(),
        arch: os.arch(),
      };

      return this.stats;
    } catch (error) {
      console.error('[SystemMonitor] Error getting system stats:', error.message);
      return null;
    }
  }

  /**
   * Obtener temperatura de CPU (si está disponible)
   */
  async getCpuTemperature() {
    try {
      const temp = await si.cpuTemperature();
      return temp.main || null;
    } catch {
      return null;
    }
  }

  /**
   * Obtener estadísticas ligeras (para heartbeat)
   */
  async getLightStats() {
    try {
      const [cpu, mem] = await Promise.all([
        si.currentLoad(),
        si.mem(),
      ]);

      return {
        cpu: parseFloat(cpu.currentLoad.toFixed(2)),
        memory: parseInt((mem.used / 1024 / 1024).toFixed(0)),
        memoryPercent: parseFloat(((mem.used / mem.total) * 100).toFixed(2)),
        uptime: Math.floor(process.uptime()),
      };
    } catch (error) {
      console.error('[SystemMonitor] Error getting light stats:', error.message);
      return {
        cpu: 0,
        memory: 0,
        memoryPercent: 0,
        uptime: Math.floor(process.uptime()),
      };
    }
  }

  /**
   * Verificar salud del sistema
   */
  async checkHealth() {
    const stats = await this.getLightStats();

    const health = {
      healthy: true,
      warnings: [],
      errors: [],
    };

    // Verificar CPU
    if (stats.cpu > 90) {
      health.healthy = false;
      health.errors.push(`High CPU usage: ${stats.cpu}%`);
    } else if (stats.cpu > 70) {
      health.warnings.push(`Elevated CPU usage: ${stats.cpu}%`);
    }

    // Verificar memoria
    if (stats.memoryPercent > 90) {
      health.healthy = false;
      health.errors.push(`High memory usage: ${stats.memoryPercent}%`);
    } else if (stats.memoryPercent > 75) {
      health.warnings.push(`Elevated memory usage: ${stats.memoryPercent}%`);
    }

    return health;
  }
}

module.exports = SystemMonitorService;
