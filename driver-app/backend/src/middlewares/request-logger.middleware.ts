import { randomUUID } from "node:crypto";
import { context, trace } from "@opentelemetry/api";
import { createMiddleware } from "hono/factory";
import type { ILogger } from "../interfaces/providers/logger.provider.interface";

interface BodyLoggingConfig {
  logRequestBody: boolean;
  logResponseBody: boolean;
}

const defaultConfig: BodyLoggingConfig = {
  logRequestBody: false,
  logResponseBody: false,
};

const routeBodyConfig: Record<string, BodyLoggingConfig> = {
  "POST /api/auth/login": { logRequestBody: false, logResponseBody: false },
  "POST /api/auth/register": { logRequestBody: false, logResponseBody: false },
  "POST /api/inspections": { logRequestBody: true, logResponseBody: true },
};

export function createRequestLoggerMiddleware(logger: ILogger) {
  return createMiddleware(async (c, next) => {
    const transactionId = randomUUID();
    const startTime = Date.now();

    const activeSpan = trace.getSpan(context.active());
    const spanContext = activeSpan?.spanContext();

    const requestLogger = logger.child({
      transactionId,
      traceId: spanContext?.traceId,
      spanId: spanContext?.spanId,
      userId: c.get("userId") ?? "anonymous",
      method: c.req.method,
      uri: c.req.path,
    });

    c.set("logger", requestLogger);
    c.set("transactionId", transactionId);

    const routeKey = `${c.req.method} ${c.req.path}`;
    const bodyConfig = routeBodyConfig[routeKey] ?? defaultConfig;

    let requestBody: unknown;
    if (bodyConfig.logRequestBody) {
      try {
        requestBody = await c.req.json();
      } catch {
        /* not JSON */
      }
    }

    await next();

    const processingTime = Date.now() - startTime;

    const logData: Record<string, unknown> = {
      statusCode: c.res.status,
      processingTime,
    };

    if (requestBody) logData.requestBody = requestBody;
    if (bodyConfig.logResponseBody) {
      try {
        const cloned = c.res.clone();
        logData.responseBody = await cloned.json();
      } catch {
        /* not JSON */
      }
    }

    if (c.res.status >= 500) {
      requestLogger.error("Request failed", logData);
    } else if (c.res.status >= 400) {
      requestLogger.warn("Client error", logData);
    } else {
      requestLogger.info("Request completed", logData);
    }
  });
}
