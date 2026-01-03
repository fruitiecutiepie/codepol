import { logger } from './logger';

declare function doStuff(): void;

export function already() {
  logger.enter({});
  try {
    doStuff();
  } finally {
    logger.exit({});
  }
}
