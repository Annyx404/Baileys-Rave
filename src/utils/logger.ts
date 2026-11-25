import pino, { Logger } from 'pino';
import prettifier from 'pino-pretty';

const build = (enabled: boolean): Logger =>
  pino(
    {
      enabled,
    },
    prettifier({
      colorize: true,
      sync: true,
    }),
  );

export let LOGGER: Logger = build(false);

let configured = false;

const initLogger = (enableLogging: boolean): Logger => {
  if (configured) return LOGGER;

  configured = true;
  return (LOGGER = build(enableLogging));
};

export default initLogger;
