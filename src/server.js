import { createApp } from './app.js';
import { createDatabase } from './db.js';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';
const db = await createDatabase();
const app = createApp(db);

const server = app.listen(port, host, () => {
  console.log(`Zafferan API listening on http://${host}:${port}`);
});

function shutdown(signal) {
  console.log(`${signal} received; shutting down.`);
  server.close(async () => {
    await db.close();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
