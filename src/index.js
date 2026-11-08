import express from 'express';
import cookieParser from 'cookie-parser';
import mongoose from 'mongoose';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config from './config.js';
import logger from './utils/logger.js';
import adminRoutes from './routes/admin.js';
import messengerRoutes from './routes/messenger.js';
import hfsqlRoutes from './routes/hfsql.js';
import { getScheduler } from './services/Scheduler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  logger.info('INICIANDO MESSENGER BOT ARENA');

  if (config.mongo.enabled) {
    try {
      await mongoose.connect(config.mongo.uri, {
        serverSelectionTimeoutMS: 60000,
        socketTimeoutMS: 60000,
        connectTimeoutMS: 30000,
        heartbeatFrequencyMS: 15000,
        maxPoolSize: 5,
        retryWrites: true,
        retryReads: true,
      });
      logger.info('MONGODB CONECTADO');

      mongoose.connection.on('disconnected', () => {
        logger.warn('MONGODB DESCONECTADO, REINTENTANDO EN 5s');
        setTimeout(() => mongoose.connect(config.mongo.uri).catch(() => {}), 5000);
      });
    } catch (err) {
      logger.error({ err }, 'ERROR AL CONECTAR A MONGODB');
      process.exit(1);
    }
  } else {
    logger.warn('MONGODB NO CONFIGURADO, FUNCIONALIDAD LIMITADA');
  }

  const app = express();

  app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Access-Control-Allow-Origin', config.server.corsOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.use('/api/admin', adminRoutes);
  app.use('/api/messenger', messengerRoutes);
  app.use('/api/hfsql', hfsqlRoutes);
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
  });

  app.get('/health', (req, res) => {
    res.json({ ok: true, timestamp: new Date().toISOString() });
  });

  app.use((req, res) => {
    res.status(404).json({ error: 'No encontrado' });
  });

  const scheduler = getScheduler();
  scheduler.start();

  const server = app.listen(config.server.port, () => {
    logger.info({ port: config.server.port }, 'SERVIDOR EN ESCUCHA');
    logger.info(`Panel admin: http://localhost:${config.server.port}/admin`);

    if (config.messenger.autoconnect) {
      logger.info('AUTOCONEXIÓN A MESSENGER ACTIVADA, INTENTANDO CONECTAR...');
      import('./services/MessengerService.js').then(({ getMessengerService }) => {
        getMessengerService().connect()
          .then((s) => logger.info({ state: s.state }, 'RESULTADO DE AUTOCONEXIÓN'))
          .catch((err) => logger.error({ err }, 'ERROR EN AUTOCONEXIÓN'));
      }).catch((err) => logger.error({ err }, 'ERROR AL CARGAR SERVICIO PARA AUTOCONEXIÓN'));
    } else {
      logger.info('AUTOCONEXIÓN DESACTIVADA (MESSENGER_AUTOCONNECT=false)');
    }
  });

  process.on('SIGINT', async () => {
    logger.info('SEÑAL SIGINT RECIBIDA, CERRANDO');
    scheduler.stop();
    server.close();
    await mongoose.disconnect();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    logger.info('SEÑAL SIGTERM RECIBIDA, CERRANDO');
    scheduler.stop();
    server.close();
    await mongoose.disconnect();
    process.exit(0);
  });
}

main().catch((err) => {
  logger.error({ err }, 'ERROR FATAL EN ARRANQUE');
  process.exit(1);
});
