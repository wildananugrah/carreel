import type { User } from "../../generated/prisma";
import type { DriverListQuery, PaginatedResponse } from "../../types/dto";

export interface CreateUserDTO {
  email: string;
  passwordHash: string;
  fullName: string;
  role: string;
}

export interface DriverWithInspectionCount extends User {
  _count: { inspections: number };
}

export interface IUserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  create(data: CreateUserDTO): Promise<User>;
  update(
    id: string,
    data: { fullName?: string; email?: string; passwordHash?: string },
  ): Promise<User>;
  findDrivers(
    query: DriverListQuery,
  ): Promise<PaginatedResponse<DriverWithInspectionCount>>;
}
