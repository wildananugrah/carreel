import { beforeEach, describe, expect, test } from "bun:test";
import type { User } from "../../src/generated/prisma";
import type { ILogger } from "../../src/interfaces/providers/logger.provider.interface";
import type { IUserRepository } from "../../src/interfaces/repositories/user.repository.interface";
import { AuthService } from "../../src/services/auth.service";
import type { UserScope } from "../../src/types/scope";

const mockLogger: ILogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => mockLogger,
};

function createMockUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    email: "test@example.com",
    passwordHash: "",
    fullName: "Test User",
    role: "PLANNER",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("AuthService", () => {
  let authService: AuthService;
  let mockUserRepo: IUserRepository;
  let users: Map<string, User>;

  beforeEach(() => {
    users = new Map();

    mockUserRepo = {
      findById: async (id: string) => users.get(id) ?? null,
      findByEmail: async (email: string) => {
        for (const u of users.values()) {
          if (u.email === email) return u;
        }
        return null;
      },
      create: async (data) => {
        const user = createMockUser({
          id: `user-${users.size + 1}`,
          email: data.email,
          passwordHash: data.passwordHash,
          fullName: data.fullName,
          role: data.role,
        });
        users.set(user.id, user);
        return user;
      },
      update: async (id: string, data) => {
        const existing = users.get(id)!;
        const updated = { ...existing, ...data };
        users.set(id, updated);
        return updated;
      },
      findDrivers: async (_scope: UserScope) => ({
        data: [],
        total: 0,
        page: 1,
        limit: 20,
      }),
    };

    authService = new AuthService(
      mockUserRepo,
      mockLogger,
      "test-secret",
      "7d",
    );
  });

  test("register creates a new planner and returns token", async () => {
    const result = await authService.register({
      email: "planner@example.com",
      password: "password123",
      fullName: "New Planner",
    });

    expect(result.token).toBeDefined();
    expect(result.user.email).toBe("planner@example.com");
    expect(result.user.fullName).toBe("New Planner");
    expect(result.user.role).toBe("PLANNER");
  });

  test("register throws on duplicate email", async () => {
    await authService.register({
      email: "dup@example.com",
      password: "password123",
      fullName: "Planner 1",
    });

    expect(
      authService.register({
        email: "dup@example.com",
        password: "password456",
        fullName: "Planner 2",
      }),
    ).rejects.toThrow("Email already registered");
  });

  test("login returns token for valid credentials", async () => {
    await authService.register({
      email: "login@example.com",
      password: "password123",
      fullName: "Login Planner",
    });

    const result = await authService.login({
      email: "login@example.com",
      password: "password123",
    });

    expect(result.token).toBeDefined();
    expect(result.user.email).toBe("login@example.com");
  });

  test("login throws for wrong password", async () => {
    await authService.register({
      email: "wrong@example.com",
      password: "correctpassword",
      fullName: "Wrong Pass User",
    });

    expect(
      authService.login({
        email: "wrong@example.com",
        password: "wrongpassword",
      }),
    ).rejects.toThrow("Invalid email or password");
  });

  test("login throws for non-existent email", async () => {
    expect(
      authService.login({
        email: "nonexistent@example.com",
        password: "password",
      }),
    ).rejects.toThrow("Invalid email or password");
  });

  test("getProfile returns user data", async () => {
    const { user } = await authService.register({
      email: "profile@example.com",
      password: "password123",
      fullName: "Profile Planner",
    });

    const profile = await authService.getProfile(user.id);
    expect(profile.email).toBe("profile@example.com");
    expect(profile.fullName).toBe("Profile Planner");
  });

  test("getProfile throws for non-existent user", async () => {
    expect(authService.getProfile("non-existent-id")).rejects.toThrow(
      "User not found",
    );
  });
});
