import winston from "winston";
import LokiTransport from "winston-loki";
import type { ILogger } from "../interfaces/providers/logger.provider.interface";

const simpleLineFormat = winston.format.printf(
  ({ timestamp, level, message, ...meta }) => {
    const txn = meta.transactionId ? ` [txn:${meta.transactionId}]` : "";
    const trace = meta.traceId ? ` [trace:${meta.traceId}]` : "";
    const user = meta.userId ? ` [user:${meta.userId}]` : "";
    const method = meta.method ?? "";
    const uri = meta.uri ?? "";
    const status = meta.statusCode ?? "";
    const time =
      meta.processingTime !== undefined ? ` ${meta.processingTime}ms` : "";

    const httpPart = method || uri ? ` ${method} ${uri} ${status}${time}` : "";
    const messagePart = !httpPart && message ? ` ${message}` : "";

    const mainLine =
      `${timestamp} [${level.toUpperCase()}]${txn}${trace}${user}${httpPart}${messagePart}`.trim();

    const extras: Record<string, unknown> = {};
    if (meta.requestBody) extras.requestBody = meta.requestBody;
    if (meta.responseBody) extras.responseBody = meta.responseBody;
    if (meta.error) extras.error = meta.error;
    if (meta.stack) extras.stack = meta.stack;

    const extrasLine =
      Object.keys(extras).length > 0 ? `\n${JSON.stringify(extras)}` : "";

    return `${mainLine}${extrasLine}`;
  },
);

export class WinstonLogger implements ILogger {
  private logger: winston.Logger;

  constructor(serviceName: string, lokiUrl?: string) {
    const transports: winston.transport[] = [new winston.transports.Console()];

    if (lokiUrl) {
      transports.push(
        new LokiTransport({
          host: lokiUrl,
          labels: { app: serviceName },
          json: false,
          format: winston.format.combine(
            winston.format.timestamp(),
            simpleLineFormat,
          ),
        }),
      );
    }

    this.logger = winston.createLogger({
      format: winston.format.combine(
        winston.format.timestamp(),
        simpleLineFormat,
      ),
      defaultMeta: { service: serviceName },
      transports,
    });
  }

  info(message: string, meta?: Record<string, unknown>) {
    this.logger.info(message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>) {
    this.logger.warn(message, meta);
  }

  error(message: string, meta?: Record<string, unknown>) {
    this.logger.error(message, meta);
  }

  debug(message: string, meta?: Record<string, unknown>) {
    this.logger.debug(message, meta);
  }

  child(meta: Record<string, unknown>): ILogger {
    const childLogger = this.logger.child(meta);
    const child = Object.create(this) as WinstonLogger;
    child.logger = childLogger;
    return child;
  }
}
