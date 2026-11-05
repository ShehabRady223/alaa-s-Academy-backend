import { app } from './app';
import { connectDb } from './config/db';
import { env } from './config/env';
import { startJobs } from './jobs';

async function main() {
  await connectDb();
  startJobs();
  app.listen(env.PORT, () => console.log(`API listening on :${env.PORT}`));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
