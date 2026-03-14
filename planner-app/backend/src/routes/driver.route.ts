import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { IUserRepository } from "../interfaces/repositories/user.repository.interface";
import type { AppEnv } from "../types/dto";

export function createDriverRoutes(
  userRepository: IUserRepository,
  authMiddleware: MiddlewareHandler<AppEnv>,
) {
  const app = new Hono<AppEnv>();

  app.use("*", authMiddleware);

  // GET /api/drivers
  app.get("/", async (c) => {
    const query = {
      page: c.req.query("page") ? Number(c.req.query("page")) : undefined,
      limit: c.req.query("limit") ? Number(c.req.query("limit")) : undefined,
      search: c.req.query("search"),
    };
    const result = await userRepository.findDrivers(query);
    return c.json(result);
  });

  return app;
}
