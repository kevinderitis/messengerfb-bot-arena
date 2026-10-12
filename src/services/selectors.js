export const facebookSelectors = {
  emailInput: 'input[name="email"]',
  passwordInput: 'input[name="pass"]',
  loginButton: 'button[name="login"]',
  loginForm: 'form[data-testid="login_form"]',
  loggedInIndicator: '[data-testid="royal_login_button"]',
  messengerLink: 'a[href*="messenger.com"]',
  messengerSearchInput: 'input[aria-label*="Buscar"], input[placeholder*="Buscar"], [role="search"] input, input[type="search"]',
  conversationList: '[role="list"], [data-testid="conversation-list"], [data-testid="chat_list"]',
  conversationItem: '[role="listitem"], [data-testid="conversation_item"], a[href*="/t/"]',
  conversationName: 'span[dir="auto"], [role="heading"] span, [data-testid="conversation_name"]',
  messageInput: '[contenteditable="true"][role="textbox"], [aria-label*="Mensaje"], [data-testid="message_input"], [data-testid="messenger_composer"]',
  sendButton: '[aria-label*="Enviar"], [data-testid="send_button"], [data-testid="composer_send_button"]',
  chatHeader: '[role="main"] [data-testid="chat_header"], h2[role="heading"], [data-testid="conversation_header"]',
  groupInfoButton: '[aria-label*="Información"], [aria-label*="Detalles"], [data-testid="group_info"]',
  logoutMenuItem: '[aria-label*="Cerrar sesión"], [data-testid="logout"]',
  groupIcon: '[data-testid="group_icon"], svg[aria-label*="grupo" i], [data-testid="stacked_avatars"]',
  userAvatar: 'img[aria-label*="foto" i], [data-testid="user_avatar"]',
};

export const messengerUrls = {
  facebook: 'https://www.facebook.com/',
  messenger: 'https://www.messenger.com/',
  login: 'https://www.facebook.com/login/',
};

export const stateLabels = {
  disconnected: 'Desconectado',
  starting: 'Iniciando navegador',
  authentication_required: 'Se requiere iniciar sesión',
  connecting: 'Conectando con Messenger',
  connected: 'Conectado',
  error: 'Error',
};

export const messageStatusLabels = {
  sent: 'Enviado',
  failed: 'Fallido',
  uncertain: 'Incierto',
  pending: 'Pendiente',
};
