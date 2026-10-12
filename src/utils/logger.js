import pino from 'pino';
import config from '../config.js';

const logger = pino({
  transport: {
    targets: [
      {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l',
          ignore: 'pid,hostname',
        },
      },
      {
        target: 'pino/file',
        options: {
          destination: `${config.paths.logsDir}/messenger-bot.log`,
          mkdir: true,
        },
      },
    ],
  },
  level: config.env === 'test' ? 'silent' : 'info',
});

export default logger;
