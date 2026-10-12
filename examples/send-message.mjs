import 'dotenv/config';

const API_URL = process.env.API_URL || 'http://localhost:3000';
const API_TOKEN = process.env.MESSENGER_API_TOKEN || 'change-me';

async function sendToGroup() {
  const response = await fetch(`${API_URL}/api/messenger/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_TOKEN}`,
    },
    body: JSON.stringify({
      recipientType: 'group',
      recipientId: 'IDENTIFICADOR_REAL_DEL_GRUPO',
      message: 'El evento comienza a las 21:00.',
    }),
  });
  const result = await response.json();
  if (!response.ok || !result.success) {
    throw new Error(result.error || 'No se pudo enviar el mensaje');
  }
  console.log('Grupo:', result);
}

async function sendToUser() {
  const response = await fetch(`${API_URL}/api/messenger/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_TOKEN}`,
    },
    body: JSON.stringify({
      recipientType: 'user',
      recipientId: 'IDENTIFICADOR_REAL_DE_LA_CONVERSACION',
      message: 'Hola, te envío una actualización.',
    }),
  });
  const result = await response.json();
  if (!response.ok || !result.success) {
    throw new Error(result.error || 'No se pudo enviar el mensaje');
  }
  console.log('Usuario:', result);
}

await sendToGroup();
await sendToUser();
