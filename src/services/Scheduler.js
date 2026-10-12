import cron from 'node-cron';
import moment from 'moment-timezone';
import config from '../config.js';
import logger from '../utils/logger.js';
import ScheduledMessage from '../models/ScheduledMessage.js';
import MessageLog from '../models/MessageLog.js';
import { getMessengerService } from './MessengerService.js';

export class Scheduler {
  constructor() {
    this.task = null;
    this.running = false;
  }

  start() {
    if (this.running) return;
    if (!config.scheduler.enabled) {
      logger.info('SCHEDULER DESACTIVADO POR CONFIGURACIÓN');
      return;
    }

    this.task = cron.schedule('* * * * *', () => this.tick(), {
      timezone: config.messenger.timezone,
    });
    this.running = true;
    logger.info({ timezone: config.messenger.timezone }, 'SCHEDULER INICIADO');

    this.recoverPending().catch((err) => logger.error({ err }, 'ERROR AL RECUPERAR PROGRAMACIONES'));
  }

  stop() {
    if (this.task) {
      this.task.stop();
      this.task = null;
    }
    this.running = false;
    logger.info('SCHEDULER DETENIDO');
  }

  async tick() {
    const now = new Date();
    logger.debug('VERIFICANDO MENSAJES PROGRAMADOS');

    try {
      const pending = await ScheduledMessage.find({
        isActive: true,
        status: 'pending',
        scheduledAt: { $lte: now },
      }).lean();

      if (pending.length === 0) return;

      logger.info({ count: pending.length }, 'MENSAJES PROGRAMADOS PENDIENTES DE EJECUCIÓN');

      for (const msg of pending) {
        await this.executeScheduled(msg);
      }
    } catch (err) {
      logger.error({ err }, 'ERROR EN TICK DEL SCHEDULER');
    }
  }

  async executeScheduled(scheduledMsg) {
    const service = getMessengerService();

    try {
      const result = await service.sendMessage(
        scheduledMsg.recipientType,
        scheduledMsg.recipientId,
        scheduledMsg.message,
      );

      await ScheduledMessage.findByIdAndUpdate(scheduledMsg._id, {
        status: result.status,
        executedAt: new Date(),
        messageId: result.messageId || null,
        result: result,
        isActive: false,
      });

      await MessageLog.create({
        recipientId: scheduledMsg.recipientId,
        recipientName: scheduledMsg.recipientName,
        recipientType: scheduledMsg.recipientType,
        message: scheduledMsg.message,
        status: result.status === 'sent' ? 'sent' : 'uncertain',
        messageId: result.messageId || null,
        source: 'scheduler',
      });

      logger.info({ id: scheduledMsg._id, status: result.status }, 'PROGRAMACIÓN EJECUTADA');
    } catch (err) {
      logger.error({ err, id: scheduledMsg._id }, 'ERROR AL EJECUTAR PROGRAMACIÓN');

      await ScheduledMessage.findByIdAndUpdate(scheduledMsg._id, {
        status: 'failed',
        executedAt: new Date(),
        result: { error: err.message },
        isActive: false,
      });

      await MessageLog.create({
        recipientId: scheduledMsg.recipientId,
        recipientName: scheduledMsg.recipientName,
        recipientType: scheduledMsg.recipientType,
        message: scheduledMsg.message,
        status: 'failed',
        error: err.message,
        source: 'scheduler',
      });
    }
  }

  async recoverPending() {
    try {
      const stuck = await ScheduledMessage.find({
        isActive: true,
        status: 'pending',
        scheduledAt: { $lte: new Date() },
      }).lean();

      if (stuck.length > 0) {
        logger.info({ count: stuck.length }, 'RECUPERANDO PROGRAMACIONES PENDIENTES TRAS REINICIO');
        for (const msg of stuck) {
          await this.executeScheduled(msg);
        }
      }
    } catch (err) {
      logger.error({ err }, 'ERROR AL RECUPERAR PROGRAMACIONES');
    }
  }

  getNextRuns(limit = 10) {
    return ScheduledMessage.find({ isActive: true, status: 'pending' })
      .sort({ scheduledAt: 1 })
      .limit(limit)
      .lean();
  }
}

let instance = null;

export function getScheduler() {
  if (!instance) {
    instance = new Scheduler();
  }
  return instance;
}
