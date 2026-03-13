import type { User } from "../../generated/prisma";

export interface IUserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  create(data: {
    email: string;
    passwordHash: string;
    fullName: string;
    role: "DRIVER";
  }): Promise<User>;
}
