import { Router } from 'express';
import config from '../config.js';
import logger from '../utils/logger.js';
import MessageLog from '../models/MessageLog.js';
import { getMessengerService } from '../services/MessengerService.js';

const router = Router();

function apiAuthMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token de API requerido' });
  }
  const token = authHeader.slice(7);
  if (token !== config.messenger.apiToken) {
    logger.warn('INTENTO DE ACCESO CON TOKEN INVÁLIDO');
    return res.status(401).json({ error: 'Token inválido' });
  }
  next();
}

router.post('/send', apiAuthMiddleware, async (req, res) => {
  try {
    const recipientType = req.body.recipientType || 'user';
    const recipientId = req.body.recipientId || req.body.chatId;
    const { message } = req.body;

    if (!['user', 'group'].includes(recipientType)) {
      return res.status(400).json({ success: false, error: 'Tipo de destinatario inválido. Use "user" o "group"' });
    }
    if (!recipientId || typeof recipientId !== 'string' || !recipientId.trim()) {
      return res.status(400).json({ success: false, error: 'Se requiere un chatId (o recipientId) válido' });
    }
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ success: false, error: 'El mensaje no puede estar vacío' });
    }
    if (message.length > config.messenger.messageMaxLength) {
      return res.status(400).json({ success: false, error: `Mensaje demasiado largo (máx ${config.messenger.messageMaxLength})` });
    }

    const service = getMessengerService();
    if (service.state !== 'connected') {
      return res.status(503).json({
        success: false,
        provider: 'messenger',
        recipientType,
        recipientId,
        status: 'error',
        error: `Messenger no conectado (estado: ${service.state})`,
      });
    }

    const result = await service.sendMessage(recipientType, recipientId, message);

    const log = await MessageLog.create({
      recipientId,
      recipientName: service.selectedConversation?.name || null,
      recipientType,
      message,
      status: result.status === 'sent' ? 'sent' : 'uncertain',
      messageId: result.messageId || null,
      source: 'api',
    });

    res.json({
      success: result.status === 'sent',
      provider: 'messenger',
      recipientType,
      recipientId,
      chatId: recipientId,
      status: result.status,
      messageId: result.messageId || null,
      error: result.status === 'sent' ? null : 'No se pudo verificar el envío',
      logId: log._id,
    });
  } catch (err) {
    logger.error({ err }, 'ERROR EN API /send');
    res.status(500).json({
      success: false,
      provider: 'messenger',
      status: 'error',
      error: err.message,
    });
  }
});

router.get('/send', (req, res) => {
  res.status(405).json({ success: false, error: 'Use POST with JSON body { chatId, message } and Authorization: Bearer <MESSENGER_API_TOKEN>' });
});

router.get('/status', apiAuthMiddleware, (req, res) => {
  const service = getMessengerService();
  res.json({
    provider: 'messenger',
    ...service.getState(),
  });
});

export default router;
