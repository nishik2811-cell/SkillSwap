import { createServer } from 'node:http';
import { app } from './app.js';
import { initRealtime } from './realtime.js';
import { sendReminders } from './sessions/routes.js';
import { expireUnpaidBookings, retryFailedRefunds } from './payments/service.js';

const port = Number(process.env.PORT || 4000);
const server = createServer(app);
initRealtime(server);
server.listen(port, () => console.log(`API listening on :${port}`));
setInterval(() => {
  for (const job of [sendReminders, expireUnpaidBookings, retryFailedRefunds]) job().catch((e) => console.error(`${job.name} failed`, e.message));
}, 60_000).unref();
