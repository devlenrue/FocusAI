import { buildApp } from './app.js';
import { config } from './config.js';

const app = await buildApp();

try {
  await app.listen({ host: config.host, port: config.port });
  app.log.info(`FocusAI API listening on ${config.host}:${config.port}`);
} catch (error) {
  app.log.error(error, 'FocusAI API failed to start');
  process.exit(1);
}
