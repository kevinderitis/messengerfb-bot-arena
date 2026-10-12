import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import config from '../config.js';
import logger from '../utils/logger.js';
import AdminUser from '../models/AdminUser.js';
import MessengerConversation from '../models/MessengerConversation.js';
import ScheduledMessage from '../models/ScheduledMessage.js';
import MessageLog from '../models/MessageLog.js';
import { getMessengerService } from '../services/MessengerService.js';
import { getScheduler } from '../services/Scheduler.js';

const router = Router();

function authMiddleware(req, res, next) {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'No autenticado' });
  try {
    req.user = jwt.verify(token, config.admin.jwtSecret);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
}

async function ensureAdminUser() {
  const existing = await AdminUser.findOne({ username: config.admin.username }).lean();
  if (existing) return;
  const passwordHash = await bcrypt.hash(config.admin.password, 10);
  await AdminUser.create({ username: config.admin.username, passwordHash });
  logger.info('USUARIO ADMIN CREADO DESDE VARIABLES DE ENTORNO');
}

router.post('/login', async (req, res) => {
  try {
    await ensureAdminUser();
    const { username, password } = req.body;
    logger.info({ username, hasPassword: !!password, contentType: req.headers['content-type'] }, 'LOGIN ATTEMPT');

    if (!username || !password) {
      logger.warn({ username }, 'LOGIN FAILED: missing fields');
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const user = await AdminUser.findOne({ username }).lean();
    if (!user) {
      logger.warn({ username }, 'LOGIN FAILED: user not found');
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      logger.warn({ username }, 'LOGIN FAILED: wrong password');
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    await AdminUser.findByIdAndUpdate(user._id, { lastLogin: new Date() });

    const token = jwt.sign({ username }, config.admin.jwtSecret, { expiresIn: config.admin.tokenTtl });
    res.cookie('token', token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000, sameSite: 'lax', path: '/' });
    logger.info({ username }, 'ADMIN AUTHENTICATED');

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, body: req.body }, 'ERROR IN LOGIN');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

router.get('/me', authMiddleware, (req, res) => {
  res.json({ username: req.user.username });
});

router.get('/status', authMiddleware, (req, res) => {
  const service = getMessengerService();
  res.json(service.getState());
});

router.post('/connect', authMiddleware, async (req, res) => {
  try {
    const service = getMessengerService();
    const state = await service.connect();
    res.json(state);
  } catch (err) {
    logger.error({ err }, 'ERROR AL CONECTAR');
    res.status(500).json({ error: err.message });
  }
});

router.post('/disconnect', authMiddleware, async (req, res) => {
  try {
    const service = getMessengerService();
    const state = await service.disconnect();
    res.json(state);
  } catch (err) {
    logger.error({ err }, 'ERROR AL DESCONECTAR');
    res.status(500).json({ error: err.message });
  }
});

router.post('/retry', authMiddleware, async (req, res) => {
  try {
    const service = getMessengerService();
    const state = await service.verifySession();
    res.json(state);
  } catch (err) {
    logger.error({ err }, 'ERROR AL REINTENTAR');
    res.status(500).json({ error: err.message });
  }
});

router.get('/conversations', authMiddleware, async (req, res) => {
  try {
    const service = getMessengerService();
    if (service.state === 'connected') {
      await service.refreshConversations();
    }
    const conversations = await MessengerConversation.find().sort({ updatedAt: -1 }).limit(100).lean();
    res.json({ conversations, live: service.conversations });
  } catch (err) {
    logger.error({ err }, 'ERROR AL OBTENER CONVERSACIONES');
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

router.get('/conversations/search', authMiddleware, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: 'Parámetro q requerido' });
    const service = getMessengerService();
    const results = await service.findConversation(q);
    res.json({ results });
  } catch (err) {
    logger.error({ err }, 'ERROR EN BÚSQUEDA DE CONVERSACIÓN');
    res.status(500).json({ error: err.message });
  }
});

router.post('/conversations/select', authMiddleware, async (req, res) => {
  try {
    const { conversationId } = req.body;
    if (!conversationId) return res.status(400).json({ error: 'conversationId requerido' });
    const service = getMessengerService();
    const selected = await service.openConversation(conversationId);
    res.json({ selected });
  } catch (err) {
    logger.error({ err }, 'ERROR AL SELECCIONAR CONVERSACIÓN');
    res.status(500).json({ error: err.message });
  }
});

router.get('/contacts/search', authMiddleware, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: 'Parámetro q requerido' });
    const service = getMessengerService();
    const results = await service.searchContacts(q);
    res.json({ results });
  } catch (err) {
    logger.error({ err }, 'ERROR AL BUSCAR CONTACTOS');
    res.status(500).json({ error: err.message });
  }
});

router.get('/groups', authMiddleware, async (req, res) => {
  try {
    const service = getMessengerService();
    const groups = await service.getAllGroups();
    res.json({ groups });
  } catch (err) {
    logger.error({ err }, 'ERROR AL OBTENER GRUPOS');
    res.status(500).json({ error: err.message });
  }
});

router.post('/send', authMiddleware, async (req, res) => {
  try {
    const { recipientType = 'user', recipientId, message } = req.body;
    if (!recipientId || !message) {
      return res.status(400).json({ error: 'recipientId and message are required' });
    }

    const service = getMessengerService();
    const result = await service.sendMessage(recipientType, recipientId, message);

    const log = await MessageLog.create({
      recipientId,
      recipientName: service.selectedConversation?.name || null,
      recipientType,
      message,
      status: result.status === 'sent' ? 'sent' : 'uncertain',
      messageId: result.messageId || null,
      source: 'panel',
    });

    res.json({ ...result, logId: log._id });
  } catch (err) {
    logger.error({ err }, 'ERROR AL ENVIAR DESDE PANEL');
    res.status(500).json({ error: err.message });
  }
});

router.get('/scheduled', authMiddleware, async (req, res) => {
  try {
    const scheduled = await ScheduledMessage.find().sort({ scheduledAt: -1 }).limit(100).lean();
    res.json({ scheduled });
  } catch (err) {
    logger.error({ err }, 'ERROR AL OBTENER PROGRAMACIONES');
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

router.post('/scheduled', authMiddleware, async (req, res) => {
  try {
    const { name, message, recipientType = 'user', recipientId, recipientName, scheduledAt, timezone } = req.body;
    if (!name || !message || !recipientId || !recipientName || !scheduledAt) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const doc = await ScheduledMessage.create({
      name,
      message,
      recipientType,
      recipientId,
      recipientName,
      scheduledAt: new Date(scheduledAt),
      timezone: timezone || config.messenger.timezone,
    });
    logger.info({ id: doc._id, name }, 'PROGRAMACIÓN CREADA');
    res.json({ message: doc });
  } catch (err) {
    logger.error({ err }, 'ERROR AL CREAR PROGRAMACIÓN');
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

router.put('/scheduled/:id', authMiddleware, async (req, res) => {
  try {
    const { isActive } = req.body;
    const doc = await ScheduledMessage.findByIdAndUpdate(
      req.params.id,
      { isActive: !!isActive },
      { new: true },
    ).lean();
    if (!doc) return res.status(404).json({ error: 'No encontrada' });
    res.json({ message: doc });
  } catch (err) {
    logger.error({ err }, 'ERROR AL ACTUALIZAR PROGRAMACIÓN');
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

router.delete('/scheduled/:id', authMiddleware, async (req, res) => {
  try {
    const doc = await ScheduledMessage.findByIdAndDelete(req.params.id).lean();
    if (!doc) return res.status(404).json({ error: 'No encontrada' });
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, 'ERROR AL ELIMINAR PROGRAMACIÓN');
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

router.get('/logs', authMiddleware, async (req, res) => {
  try {
    const logs = await MessageLog.find().sort({ sentAt: -1 }).limit(50).lean();
    res.json({ logs });
  } catch (err) {
    logger.error({ err }, 'ERROR AL OBTENER LOGS');
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

export default router;
