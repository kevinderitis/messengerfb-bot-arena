import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import config from '../config.js';
import logger from '../utils/logger.js';
import { ProfileLock } from '../utils/locks.js';
import { facebookSelectors, messengerUrls } from './selectors.js';

export const ConnectionState = {
  DISCONNECTED: 'disconnected',
  STARTING: 'starting',
  AUTH_REQUIRED: 'authentication_required',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  ERROR: 'error',
};

export class MessengerService {
  constructor() {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.state = ConnectionState.DISCONNECTED;
    this.lastError = null;
    this.lastConnectedAt = null;
    this.conversations = [];
    this.selectedConversation = null;
    this.profileLock = null;
    this.messageCounter = 0;
  }

  getState() {
    return {
      state: this.state,
      lastError: this.lastError,
      lastConnectedAt: this.lastConnectedAt,
      browserActive: this.isBrowserActive(),
      conversationCount: this.conversations.length,
      selectedConversation: this.selectedConversation,
      messagesSent: this.messageCounter,
    };
  }

  isBrowserActive() {
    return !!(this.browser && this.browser.isConnected() && this.page && !this.page.isClosed());
  }

  async connect() {
    if (this.state === ConnectionState.STARTING || this.state === ConnectionState.CONNECTING) {
      logger.warn('CONEXIÓN YA EN CURSO, SE IGNORA SOLICITUD DUPLICADA');
      return this.getState();
    }

    if (this.isBrowserActive()) {
      logger.info('NAVEGADOR YA ACTIVO, SE VERIFICA SESIÓN');
      return this.verifySession();
    }

    this.profileLock = new ProfileLock(path.join(config.messenger.browserProfile, '.lock'));
    const locked = await this.profileLock.acquire();
    if (!locked) {
      this.state = ConnectionState.ERROR;
      this.lastError = 'El perfil del navegador está siendo utilizado por otro proceso';
      logger.error(this.lastError);
      return this.getState();
    }

    this.state = ConnectionState.STARTING;
    this.lastError = null;
    logger.info({ profile: config.messenger.browserProfile }, 'INICIANDO CHROMIUM CON PERFIL PERSISTENTE');

    try {
      fs.mkdirSync(config.messenger.browserProfile, { recursive: true });

      this.context = await chromium.launchPersistentContext(config.messenger.browserProfile, {
        headless: config.messenger.headless,
        slowMo: config.messenger.slowMs,
        viewport: { width: 1280, height: 800 },
        args: ['--disable-blink-features=AutomationControlled'],
        ignoreDefaultArgs: ['--enable-automation'],
      });

      this.browser = this.context.browser();
      this.page = this.context.pages()[0] || (await this.context.newPage());

      this.page.on('close', () => {
        logger.warn('PÁGINA DEL NAVEGADOR CERRADA INESPERADAMENTE');
        this.handleUnexpectedClose();
      });

      this.context.on('close', () => {
        logger.warn('CONTEXTO DEL NAVEGADOR CERRADO');
        this.handleUnexpectedClose();
      });

      logger.info('CHROMIUM INICIADO CORRECTAMENTE');
      return this.verifySession();
    } catch (err) {
      this.state = ConnectionState.ERROR;
      this.lastError = err.message;
      logger.error({ err }, 'ERROR AL INICIAR CHROMIUM');
      await this.cleanup();
      return this.getState();
    }
  }

  async verifySession() {
    if (!this.isBrowserActive()) {
      this.state = ConnectionState.DISCONNECTED;
      return this.getState();
    }

    this.state = ConnectionState.CONNECTING;
    logger.info('VERIFICANDO ESTADO DE AUTENTICACIÓN');

    try {
      await this.page.goto(messengerUrls.facebook, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await this.page.waitForTimeout(2000);

      const isLoggedIn = await this.checkLoginStatus();

      if (!isLoggedIn) {
        this.state = ConnectionState.AUTH_REQUIRED;
        logger.info('SE REQUIERE INICIO DE SESIÓN MANUAL');
        return this.getState();
      }

      logger.info('SESIÓN DE FACEBOOK AUTENTICADA, NAVEGANDO A MESSENGER');
      await this.navigateToMessenger();

      const messengerReady = await this.checkMessengerAvailable();
      if (!messengerReady) {
        this.state = ConnectionState.ERROR;
        this.lastError = 'No se pudo acceder a la interfaz de Messenger';
        logger.error(this.lastError);
        return this.getState();
      }

      this.state = ConnectionState.CONNECTED;
      this.lastConnectedAt = new Date();
      logger.info('MESSENGER CONECTADO Y DISPONIBLE');

      await this.refreshConversations();
      return this.getState();
    } catch (err) {
      this.state = ConnectionState.ERROR;
      this.lastError = err.message;
      logger.error({ err }, 'ERROR AL VERIFICAR SESIÓN');
      return this.getState();
    }
  }

  async checkLoginStatus() {
    try {
      const loginForm = await this.page.$(facebookSelectors.loginForm);
      if (loginForm) return false;

      const emailInput = await this.page.$(facebookSelectors.emailInput);
      if (emailInput) return false;

      const cookies = await this.context.cookies();
      const hasSessionCookie = cookies.some((c) => c.name === 'c_user' && c.domain.includes('facebook.com'));
      return hasSessionCookie;
    } catch (err) {
      logger.error({ err }, 'ERROR AL VERIFICAR ESTADO DE LOGIN');
      return false;
    }
  }

  async navigateToMessenger() {
    logger.info('NAVEGANDO A MESSENGER');
    await this.page.goto(messengerUrls.messenger, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await this.page.waitForTimeout(3000);
  }

  async checkMessengerAvailable() {
    try {
      const messageList = await this.page.$('[role="main"]');
      const searchInput = await this.page.$(facebookSelectors.messengerSearchInput);
      return !!(messageList || searchInput);
    } catch {
      return false;
    }
  }

  async refreshConversations() {
    if (!this.isBrowserActive() || this.state !== ConnectionState.CONNECTED) {
      logger.warn('NO SE PUEDEN OBTENER CONVERSACIONES: SERVICIO NO CONECTADO');
      return [];
    }

    logger.info('OBTENIENDO CONVERSACIONES DISPONIBLES');
    try {
      await this.page.waitForSelector('a[href*="/t/"]', { timeout: 10000 });

      for (let i = 0; i < 10; i++) {
        await this.page.mouse.wheel(0, 2000);
        await this.page.waitForTimeout(500);
      }

      const conversations = await this.page.evaluate(() => {
        const results = [];
        const seen = new Set();
        const links = document.querySelectorAll('a[href*="/t/"]');

        for (const link of links) {
          try {
            const href = link.getAttribute('href');
            if (!href || seen.has(href)) continue;
            seen.add(href);

            const idMatch = href.match(/\/t\/([^/?#]+)/);
            if (!idMatch) continue;
            const conversationId = idMatch[1];

            const nameEl = link.querySelector('span[dir="auto"], [role="heading"] span, h3 span, h4 span');
            const name = nameEl?.textContent?.trim();
            if (!name) continue;

            const groupIcon = link.querySelector('[data-testid="group_icon"], [data-testid="stacked_avatars"]');
            const isGroup = !!groupIcon;

            results.push({
              conversationId,
              name,
              type: isGroup ? 'group' : 'user',
              url: href,
            });
          } catch {
            // ignorar elementos individuales con error
          }
        }
        return results;
      });

      this.conversations = conversations;
      logger.info({ count: conversations.length }, 'CONVERSACIONES OBTENIDAS');
      return conversations;
    } catch (err) {
      logger.error({ err }, 'ERROR AL OBTENER CONVERSACIONES');
      return [];
    }
  }

  async findConversation(searchTerm) {
    if (!this.isBrowserActive() || this.state !== ConnectionState.CONNECTED) {
      throw new Error('Servicio no conectado');
    }

    logger.info({ searchTerm }, 'BUSCANDO CONVERSACIÓN');

    const searchInput = await this.page.$(facebookSelectors.messengerSearchInput);
    if (searchInput) {
      await searchInput.click({ timeout: 5000 });
      await searchInput.fill('');
      await searchInput.type(searchTerm, { delay: 80 });
      await this.page.waitForTimeout(2500);
    }

    const results = await this.page.evaluate((term) => {
      const matches = [];
      const seen = new Set();
      const links = document.querySelectorAll('a[href*="/t/"]');
      const lower = term.toLowerCase();

      for (const link of links) {
        try {
          const href = link.getAttribute('href');
          if (!href || seen.has(href)) continue;
          seen.add(href);

          const idMatch = href.match(/\/t\/([^/?#]+)/);
          if (!idMatch) continue;
          const conversationId = idMatch[1];

          const nameEl = link.querySelector('span[dir="auto"], [role="heading"] span, h3 span, h4 span');
          const name = nameEl?.textContent?.trim();
          if (!name || !name.toLowerCase().includes(lower)) continue;

          const groupIcon = link.querySelector('[data-testid="group_icon"], [data-testid="stacked_avatars"]');

          matches.push({
            conversationId,
            name,
            type: groupIcon ? 'group' : 'user',
            url: href,
          });
        } catch {
          // ignorar elementos individuales con error
        }
      }
      return matches;
    }, searchTerm);

    logger.info({ results: results.length }, 'RESULTADOS DE BÚSQUEDA');
    return results;
  }

  async searchContacts(searchTerm) {
    if (!this.isBrowserActive() || this.state !== ConnectionState.CONNECTED) {
      throw new Error('Servicio no conectado');
    }

    logger.info({ searchTerm }, 'BUSCANDO CONTACTOS Y GRUPOS');

    const searchInput = await this.page.$(facebookSelectors.messengerSearchInput);
    if (!searchInput) {
      throw new Error('No se encontró el campo de búsqueda de Messenger');
    }

    await searchInput.click({ timeout: 5000 });
    await searchInput.fill('');
    await searchInput.type(searchTerm, { delay: 80 });
    await this.page.waitForTimeout(3000);

    const results = await this.page.evaluate((term) => {
      const matches = [];
      const seen = new Set();
      const lower = term.toLowerCase();

      const allLinks = document.querySelectorAll('a[href*="/t/"], a[href*="/groups/"]');
      for (const link of allLinks) {
        try {
          const href = link.getAttribute('href');
          if (!href || seen.has(href)) continue;
          seen.add(href);

          const idMatch = href.match(/\/t\/([^/?#]+)/) || href.match(/\/groups\/([^/?#]+)/);
          if (!idMatch) continue;
          const conversationId = idMatch[1];

          const nameEl = link.querySelector('span[dir="auto"], [role="heading"] span, h3 span, h4 span, [data-testid="contact_name"]');
          const name = nameEl?.textContent?.trim();
          if (!name || !name.toLowerCase().includes(lower)) continue;

          const groupIcon = link.querySelector('[data-testid="group_icon"], [data-testid="stacked_avatars"]');
          const isGroup = !!groupIcon || href.includes('/groups/');

          matches.push({
            conversationId,
            name,
            type: isGroup ? 'group' : 'user',
            url: href,
          });
        } catch {
          // ignorar elementos individuales con error
        }
      }

      const contactItems = document.querySelectorAll('[data-testid="contact_item"], [role="option"], [role="listitem"]');
      for (const item of contactItems) {
        try {
          const nameEl = item.querySelector('span[dir="auto"], [role="heading"] span, [data-testid="contact_name"]');
          const name = nameEl?.textContent?.trim();
          if (!name || !name.toLowerCase().includes(lower)) continue;

          const href = item.getAttribute('href') || item.closest('a')?.getAttribute('href');
          if (!href || seen.has(href)) continue;
          seen.add(href);

          const idMatch = href.match(/\/t\/([^/?#]+)/) || href.match(/\/groups\/([^/?#]+)/);
          if (!idMatch) continue;

          const groupIcon = item.querySelector('[data-testid="group_icon"], [data-testid="stacked_avatars"]');
          const isGroup = !!groupIcon || href.includes('/groups/');

          matches.push({
            conversationId: idMatch[1],
            name,
            type: isGroup ? 'group' : 'user',
            url: href,
          });
        } catch {
          // ignorar elementos individuales con error
        }
      }

      return matches;
    }, searchTerm);

    logger.info({ results: results.length }, 'CONTACTOS Y GRUPOS ENCONTRADOS');
    return results;
  }

  async getAllGroups() {
    if (!this.isBrowserActive() || this.state !== ConnectionState.CONNECTED) {
      throw new Error('Servicio no conectado');
    }

    logger.info('OBTENIENDO TODOS LOS GRUPOS');

    try {
      await this.page.goto('https://www.messenger.com/groups', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await this.page.waitForTimeout(3000);

      for (let i = 0; i < 15; i++) {
        await this.page.mouse.wheel(0, 3000);
        await this.page.waitForTimeout(600);
      }

      const groups = await this.page.evaluate(() => {
        const results = [];
        const seen = new Set();
        const links = document.querySelectorAll('a[href*="/groups/"], a[href*="/t/"]');

        for (const link of links) {
          try {
            const href = link.getAttribute('href');
            if (!href || seen.has(href)) continue;
            seen.add(href);

            const idMatch = href.match(/\/groups\/([^/?#]+)/) || href.match(/\/t\/([^/?#]+)/);
            if (!idMatch) continue;
            const conversationId = idMatch[1];

            const nameEl = link.querySelector('span[dir="auto"], [role="heading"] span, h3 span, h4 span');
            const name = nameEl?.textContent?.trim();
            if (!name) continue;

            const groupIcon = link.querySelector('[data-testid="group_icon"], [data-testid="stacked_avatars"]');
            const isGroup = !!groupIcon || href.includes('/groups/');

            if (isGroup) {
              results.push({
                conversationId,
                name,
                type: 'group',
                url: href,
              });
            }
          } catch {
            // ignorar elementos individuales con error
          }
        }
        return results;
      });

      logger.info({ count: groups.length }, 'GRUPOS OBTENIDOS');
      return groups;
    } catch (err) {
      logger.error({ err }, 'ERROR AL OBTENER GRUPOS');
      return [];
    }
  }

  async openConversation(conversationId) {
    if (!this.isBrowserActive() || this.state !== ConnectionState.CONNECTED) {
      throw new Error('Servicio no conectado');
    }

    logger.info({ conversationId }, 'ABRIENDO CONVERSACIÓN');

    const targetUrl = conversationId
      ? `${messengerUrls.messenger}t/${conversationId}`
      : messengerUrls.messenger;

    await this.page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await this.page.waitForTimeout(2000);

    const messageInput = await this.page.$(facebookSelectors.messageInput);
    if (!messageInput) {
      throw new Error('No se encontró el campo de mensaje');
    }

    const headerText = await this.getChatHeader();
    this.selectedConversation = { conversationId, name: headerText };

    logger.info({ headerText }, 'CONVERSACIÓN ABIERTA');
    return this.selectedConversation;
  }

  async findMessageInput() {
    const candidates = await this.page.$$(
      'div[contenteditable="true"][role="textbox"], div[contenteditable="true"], '
      + '[role="textbox"][contenteditable], textarea, input[type="text"], '
      + '[data-testid="message_input"], [data-testid="messenger_composer"]',
    );
    for (const el of candidates) {
      try {
        if (await el.isVisible() && await el.isEditable()) return el;
      } catch {
        // elemento obsoleto, probar el siguiente
      }
    }
    return null;
  }

  async getChatHeader() {
    try {
      const header = await this.page.$(facebookSelectors.chatHeader);
      if (header) return (await header.textContent())?.trim() || null;
      const heading = await this.page.$('[role="main"] h2');
      return heading ? (await heading.textContent())?.trim() : null;
    } catch {
      return null;
    }
  }

  async sendMessage(recipientType, recipientId, message) {
    if (!message || !message.trim()) {
      throw new Error('El mensaje no puede estar vacío');
    }
    if (message.length > config.messenger.messageMaxLength) {
      throw new Error(`El mensaje excede la longitud máxima de ${config.messenger.messageMaxLength} caracteres`);
    }
    if (!recipientId) {
      throw new Error('Se requiere un identificador de destinatario');
    }
    if (!this.isBrowserActive()) {
      throw new Error('El navegador no está disponible');
    }
    if (this.state !== ConnectionState.CONNECTED) {
      throw new Error('Messenger no está conectado');
    }

    logger.info({ recipientType, recipientId, length: message.length }, 'INTENTANDO ENVÍO DE MENSAJE');

    try {
      await this.openConversation(recipientId);

      const messageInput = await this.findMessageInput();
      if (!messageInput) {
        throw new Error('No se encontró el campo de composición del mensaje');
      }

      await messageInput.click();
      try {
        await messageInput.fill('');
      } catch {
        await this.page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
        await this.page.keyboard.press('Backspace');
      }
      await messageInput.type(message, { delay: 50 });
      await this.page.waitForTimeout(500);

      const sendButton = await this.page.$(facebookSelectors.sendButton);
      if (sendButton) {
        await sendButton.click();
      } else {
        await this.page.keyboard.press('Enter');
      }

      await this.page.waitForTimeout(2000);

      const verified = await this.verifyMessageSent(message);
      this.messageCounter += 1;

      if (verified) {
        logger.info('MENSAJE ENVIADO Y VERIFICADO');
        return { success: true, status: 'sent', verified: true };
      }

      logger.warn('ENVÍO SIN CONFIRMACIÓN, ESTADO INCIERTO');
      return { success: false, status: 'uncertain', verified: false };
    } catch (err) {
      logger.error({ err }, 'ERROR AL ENVIAR MENSAJE');
      throw err;
    }
  }

  async verifyMessageSent(message) {
    try {
      const messages = await this.page.$$('[data-testid="message"], [role="main"] [dir="auto"]');
      const lastMessages = messages.slice(-5);
      for (const msg of lastMessages) {
        const text = (await msg.textContent())?.trim();
        if (text && text.includes(message.substring(0, 50))) {
          return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  async disconnect() {
    logger.info('CERRANDO NAVEGADOR DE MANERA CONTROLADA');
    await this.cleanup();
    this.state = ConnectionState.DISCONNECTED;
    this.lastError = null;
    logger.info('SERVICIO DESCONECTADO');
    return this.getState();
  }

  async cleanup() {
    try {
      if (this.context) {
        await this.context.close();
      }
    } catch (err) {
      logger.warn({ err }, 'ERROR AL CERRAR CONTEXTO');
    }
    try {
      if (this.profileLock) {
        await this.profileLock.release();
      }
    } catch (err) {
      logger.warn({ err }, 'ERROR AL LIBERAR BLOQUEO');
    }
    this.browser = null;
    this.context = null;
    this.page = null;
    this.profileLock = null;
  }

  handleUnexpectedClose() {
    this.state = ConnectionState.DISCONNECTED;
    this.lastError = 'El navegador se cerró inesperadamente';
    this.browser = null;
    this.context = null;
    this.page = null;
  }
}

let instance = null;

export function getMessengerService() {
  if (!instance) {
    instance = new MessengerService();
  }
  return instance;
}
