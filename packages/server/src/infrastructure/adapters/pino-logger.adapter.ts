import pino from 'pino';

import type { LoggerPort } from '../../application/ports/logger.port.js';

export class PinoLoggerAdapter implements LoggerPort {
  private readonly logger: pino.Logger;

  constructor() {
    this.logger = pino({
      transport: {
        target: 'pino-pretty',
        options: { colorize: true },
      },
    });
  }

  info(msg: string, data?: Record<string, unknown>): void {
    if (data) {
      this.logger.info(data, msg);
    } else {
      this.logger.info(msg);
    }
  }

  error(msg: string, data?: Record<string, unknown>): void {
    if (data) {
      this.logger.error(data, msg);
    } else {
      this.logger.error(msg);
    }
  }

  warn(msg: string, data?: Record<string, unknown>): void {
    if (data) {
      this.logger.warn(data, msg);
    } else {
      this.logger.warn(msg);
    }
  }

  debug(msg: string, data?: Record<string, unknown>): void {
    if (data) {
      this.logger.debug(data, msg);
    } else {
      this.logger.debug(msg);
    }
  }
}
