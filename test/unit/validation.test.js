import { test } from 'node:test';
import assert from 'node:assert/strict';
import config from '../../src/config.js';

test('config tiene valores por defecto correctos', () => {
  assert.equal(config.server.port, 3000);
  assert.equal(config.messenger.messageMaxLength, 4000);
  assert.equal(config.messenger.timezone, 'Asia/Bangkok');
});

test('config.admin tiene credenciales por defecto', () => {
  assert.equal(config.admin.username, 'admin');
  assert.equal(config.admin.password, 'admin');
  assert.ok(config.admin.jwtSecret.length > 0);
});

test('config.messenger.apiToken tiene valor por defecto', () => {
  assert.equal(config.messenger.apiToken, 'change-me');
});

test('config.messenger.browserProfile es ruta absoluta', () => {
  assert.ok(config.messenger.browserProfile.startsWith('/'));
});

test('MessageLog schema tiene índices correctos', async () => {
  const { default: MessageLog } = await import('../../src/models/MessageLog.js');
  const indexes = MessageLog.schema.indexes();
  const hasRecipientIndex = indexes.some(([fields]) => fields.recipientId === 1);
  const hasSentAtIndex = indexes.some(([fields]) => fields.sentAt === -1);
  assert.ok(hasRecipientIndex, 'Debe tener índice en recipientId');
  assert.ok(hasSentAtIndex, 'Debe tener índice en sentAt');
});

test('ScheduledMessage schema tiene índice compuesto', async () => {
  const { default: ScheduledMessage } = await import('../../src/models/ScheduledMessage.js');
  const indexes = ScheduledMessage.schema.indexes();
  const hasCompound = indexes.some(([fields]) => fields.isActive === 1 && fields.scheduledAt === 1);
  assert.ok(hasCompound, 'Debe tener índice compuesto isActive+scheduledAt');
});

test('AdminUser schema requiere username y passwordHash', async () => {
  const { default: AdminUser } = await import('../../src/models/AdminUser.js');
  assert.ok(AdminUser.schema.path('username').isRequired);
  assert.ok(AdminUser.schema.path('passwordHash').isRequired);
});

test('ProfileLock impide doble adquisición', async () => {
  const { ProfileLock } = await import('../../src/utils/locks.js');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const tmp = path.join(os.tmpdir(), `lock-test-${Date.now()}`);
  const lock = new ProfileLock(tmp);
  assert.equal(await lock.acquire(), true);
  const lock2 = new ProfileLock(tmp);
  assert.equal(await lock2.acquire(), false);
  await lock.release();
  assert.equal(await lock2.acquire(), true);
  await lock2.release();
  fs.rmSync(tmp, { force: true });
});
