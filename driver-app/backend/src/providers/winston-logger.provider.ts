import winston from "winston";
import LokiTransport from "winston-loki";
import type { ILogger } from "../interfaces/providers/logger.provider.interface";

// User-Agent strings are noisy ("Mozilla/5.0 (Macintosh; Intel Mac OS X
// 10.15; rv:150.0) Gecko/20100101 Firefox/150.0"). Compact them to a
// single Browser/Version token so they fit inline on the log line.
function compactUserAgent(ua: string): string {
  if (!ua || ua === "unknown") return ua;
  const patterns: Array<[RegExp, string]> = [
    [/Edg\/([\d.]+)/, "Edge"],
    [/OPR\/([\d.]+)/, "Opera"],
    [/Firefox\/([\d.]+)/, "Firefox"],
    [/Chrome\/([\d.]+)/, "Chrome"],
    [/Version\/([\d.]+).*Safari\//, "Safari"],
  ];
  for (const [pattern, name] of patterns) {
    const match = ua.match(pattern);
    if (match) return `${name}/${match[1]}`;
  }
  return ua.slice(0, 40);
}

// Referer URLs include origin which is redundant when we already know
// which app emitted the request. Keep just the path + querystring.
function compactReferer(referer: string): string {
  try {
    const url = new URL(referer);
    return url.pathname + url.search;
  } catch {
    return referer.slice(0, 60);
  }
}

const simpleLineFormat = winston.format.printf(
  ({ timestamp, level, message, ...meta }) => {
    const txn = meta.transactionId ? ` [txn:${meta.transactionId}]` : "";
    const trace = meta.traceId ? ` [trace:${meta.traceId}]` : "";
    const user = meta.userId ? ` [user:${meta.userId}]` : "";
    const ip = meta.ip ? ` [ip:${meta.ip}]` : "";
    const method = meta.method ?? "";
    const uri = meta.uri ?? "";
    const status = meta.statusCode ?? "";
    const time =
      meta.processingTime !== undefined ? ` ${meta.processingTime}ms` : "";

    const httpPart = method || uri ? ` ${method} ${uri} ${status}${time}` : "";
    const messagePart = !httpPart && message ? ` ${message}` : "";

    // Inline UA + referer as compact bracket fields on the main line.
    const ua = meta.userAgent
      ? ` [ua:${compactUserAgent(meta.userAgent as string)}]`
      : "";
    const ref = meta.referer
      ? ` [ref:${compactReferer(meta.referer as string)}]`
      : "";

    const mainLine =
      `${timestamp} [${level.toUpperCase()}]${txn}${trace}${user}${ip}${httpPart}${messagePart}${ua}${ref}`.trim();

    // Extras line is reserved for fields too large to inline. UA and
    // referer used to live here but moved to the main line above so every
    // log entry has a uniform "${timestamp} [LEVEL] [...]"-prefixed shape.
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
