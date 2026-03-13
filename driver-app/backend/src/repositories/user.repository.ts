import type { PrismaClient, User } from "../generated/prisma";
import type { IUserRepository } from "../interfaces/repositories/user.repository.interface";

export class UserRepository implements IUserRepository {
  constructor(private prisma: PrismaClient) {}

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async create(data: {
    email: string;
    passwordHash: string;
    fullName: string;
    role: "DRIVER";
  }): Promise<User> {
    return this.prisma.user.create({ data });
  }
}
