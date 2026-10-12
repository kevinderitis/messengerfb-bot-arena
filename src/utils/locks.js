import fs from 'node:fs';
import path from 'node:path';
import logger from './logger.js';

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export class ProfileLock {
  constructor(lockPath) {
    this.lockPath = lockPath;
    this.acquired = false;
  }

  async acquire() {
    const dir = path.dirname(this.lockPath);
    fs.mkdirSync(dir, { recursive: true });
    try {
      fs.writeFileSync(this.lockPath, String(process.pid), { flag: 'wx' });
      this.acquired = true;
      logger.info({ lockPath: this.lockPath }, 'BLOQUEO DE PERFIL ADQUIRIDO');
      return true;
    } catch (err) {
      if (err.code === 'EEXIST') {
        const existingPid = parseInt(fs.readFileSync(this.lockPath, 'utf8').trim(), 10);
        if (!isProcessAlive(existingPid)) {
          logger.warn({ existingPid }, 'BLOQUEO OBSOLETO DETECTADO, LIBERANDO');
          try {
            fs.unlinkSync(this.lockPath);
          } catch {
            // ignorar
          }
          return this.acquire();
        }
        logger.warn({ existingPid }, 'PERFIL DE NAVEGADOR YA EN USO POR OTRO PROCESO');
        return false;
      }
      throw err;
    }
  }

  async release() {
    if (!this.acquired) return;
    try {
      fs.unlinkSync(this.lockPath);
      this.acquired = false;
      logger.info('BLOQUEO DE PERFIL LIBERADO');
    } catch (err) {
      if (err.code !== 'ENOENT') logger.error({ err }, 'ERROR AL LIBERAR BLOQUEO DE PERFIL');
    }
  }
}
