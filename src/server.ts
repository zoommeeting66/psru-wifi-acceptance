import { createApp } from "./app";
import { env } from "./config/env";
import { logger } from "./utils/logger";

createApp().listen(env.port, () => {
  logger.info(`PSRU WiFi Acceptance API listening on http://localhost:${env.port}`);
});
