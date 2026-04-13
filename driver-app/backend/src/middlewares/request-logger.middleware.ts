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

function extractClientIp(c: {
  req: { header: (name: string) => string | undefined; raw: Request };
}): string {
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  const realIp = c.req.header("x-real-ip");
  if (realIp) return realIp;
  const cfIp = c.req.header("cf-connecting-ip");
  if (cfIp) return cfIp;
  return "unknown";
}

export function createRequestLoggerMiddleware(logger: ILogger) {
  return createMiddleware(async (c, next) => {
    const transactionId = randomUUID();
    const startTime = Date.now();

    const activeSpan = trace.getSpan(context.active());
    const spanContext = activeSpan?.spanContext();

    const ip = extractClientIp(c);
    const userAgent = c.req.header("user-agent") ?? "unknown";
    const referer = c.req.header("referer") ?? undefined;

    const requestLogger = logger.child({
      transactionId,
      traceId: spanContext?.traceId,
      spanId: spanContext?.spanId,
      method: c.req.method,
      uri: c.req.path,
      ip,
      userAgent,
      ...(referer && { referer }),
    });

    c.set("clientIp", ip);
    c.set("userAgent", userAgent);

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
      userId: c.get("userId") ?? "anonymous",
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
