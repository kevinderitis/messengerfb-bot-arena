import { test } from 'node:test';
import assert from 'node:assert/strict';

test('INTEGRACIÓN: envío real de Messenger requiere cuenta real de Facebook', { skip: true }, async () => {
  const { getMessengerService, ConnectionState } = await import('../../src/services/MessengerService.js');
  const service = getMessengerService();

  assert.equal(service.state, ConnectionState.DISCONNECTED);

  const state = await service.connect();
  assert.ok([
    ConnectionState.CONNECTED,
    ConnectionState.AUTH_REQUIRED,
    ConnectionState.ERROR,
  ].includes(state.state));

  if (state.state === ConnectionState.CONNECTED) {
    const result = await service.sendMessage('user', 'TEST_ID', 'Mensaje de prueba');
    assert.ok(result.status === 'sent' || result.status === 'uncertain');
  }

  await service.disconnect();
  assert.equal(service.state, ConnectionState.DISCONNECTED);
});

test('INTEGRACIÓN: API /api/messenger/send requiere token válido', { skip: true }, async () => {
  const res = await fetch('http://localhost:3000/api/messenger/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipientType: 'user', recipientId: '1', message: 'test' }),
  });
  assert.equal(res.status, 401);
});
