import { createMiddleware } from "hono/factory";
import type { ILogger } from "../interfaces/providers/logger.provider.interface";

export function createErrorHandlerMiddleware(logger: ILogger) {
  return createMiddleware(async (c, next) => {
    try {
      await next();
    } catch (err) {
      const requestLogger = (c.get("logger") as ILogger) ?? logger;

      const message = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;

      requestLogger.error("Unhandled exception", {
        error: message,
        stack,
        statusCode: 500,
      });

      // Return user-friendly error for known business errors
      const knownErrors = [
        "Email already registered",
        "Invalid email or password",
        "User not found",
        "Inspection not found",
        "Step not found",
        "Unauthorized access to inspection",
        "Only DRAFT inspections can be updated",
        "Only DRAFT inspections can be submitted",
      ];

      if (knownErrors.includes(message)) {
        const status = message.includes("not found")
          ? 404
          : message.includes("Unauthorized")
            ? 403
            : message.includes("Invalid") || message.includes("already")
              ? 400
              : message.includes("Only DRAFT")
                ? 409
                : 400;
        return c.json({ error: message }, status);
      }

      return c.json({ error: "Internal server error" }, 500);
    }
  });
}
