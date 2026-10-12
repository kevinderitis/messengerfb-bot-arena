import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

export default {
  env: process.env.NODE_ENV || 'development',
  server: {
    port: parseInt(process.env.PORT, 10) || 3000,
    corsOrigin: process.env.CORS_ORIGIN || '*',
  },
  mongo: {
    uri: process.env.MONGODB_URI || '',
    enabled: !!process.env.MONGODB_URI,
  },
  admin: {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || 'admin',
    jwtSecret: process.env.ADMIN_JWT_SECRET || 'super-secret-change-me',
    tokenTtl: '7d',
  },
  messenger: {
    apiToken: process.env.MESSENGER_API_TOKEN || 'change-me',
    browserProfile: path.resolve(rootDir, process.env.MESSENGER_BROWSER_PROFILE || './data/messenger-profile'),
    headless: process.env.MESSENGER_HEADLESS === 'true',
    slowMs: parseInt(process.env.MESSENGER_SLOW_MS, 10) || 0,
    timezone: process.env.MESSENGER_TIMEZONE || 'Asia/Bangkok',
    messageMaxLength: parseInt(process.env.MESSAGE_MAX_LENGTH, 10) || 4000,
    sendTimeoutMs: parseInt(process.env.SEND_TIMEOUT_MS, 10) || 60000,
    autoconnect: process.env.MESSENGER_AUTOCONNECT !== 'false',
  },
  scheduler: {
    enabled: process.env.SCHEDULER_ENABLED !== 'false',
  },
  paths: {
    rootDir,
    logsDir: path.join(rootDir, 'logs'),
  },
};
