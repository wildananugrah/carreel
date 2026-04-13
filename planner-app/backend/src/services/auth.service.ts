import type { ILogger } from "../interfaces/providers/logger.provider.interface";
import type { IUserRepository } from "../interfaces/repositories/user.repository.interface";
import type { IAuthService } from "../interfaces/services/auth.service.interface";
import type {
  AuthResponse,
  ChangePasswordDTO,
  LoginDTO,
  RegisterDTO,
  UpdateProfileDTO,
  UserResponse,
} from "../types/dto";
import { badRequest, conflict, notFound, unauthorized } from "../utils/http-error";
import { signToken } from "../utils/jwt";

export class AuthService implements IAuthService {
  constructor(
    private userRepository: IUserRepository,
    private logger: ILogger,
    private jwtSecret: string,
    private jwtExpiresIn: string,
  ) {}

  async register(data: RegisterDTO): Promise<AuthResponse> {
    const existing = await this.userRepository.findByEmail(data.email);
    if (existing) {
      throw conflict("Email already registered");
    }

    const passwordHash = await Bun.password.hash(data.password, {
      algorithm: "bcrypt",
    });

    const user = await this.userRepository.create({
      email: data.email,
      passwordHash,
      fullName: data.fullName,
      role: "PLANNER",
    });

    this.logger.info("Planner registered", {
      userId: user.id,
      email: user.email,
    });

    const token = signToken(
      { userId: user.id, role: user.role },
      this.jwtSecret,
      this.jwtExpiresIn,
    );

    return {
      token,
      user: this.toUserResponse(user),
    };
  }

  async login(data: LoginDTO): Promise<AuthResponse> {
    const user = await this.userRepository.findByEmail(data.email);
    if (!user) {
      throw unauthorized("Invalid email or password");
    }

    const validPassword = await Bun.password.verify(
      data.password,
      user.passwordHash,
    );
    if (!validPassword) {
      throw unauthorized("Invalid email or password");
    }

    this.logger.info("Planner logged in", { userId: user.id });

    const token = signToken(
      { userId: user.id, role: user.role },
      this.jwtSecret,
      this.jwtExpiresIn,
    );

    return {
      token,
      user: this.toUserResponse(user),
    };
  }

  async getProfile(userId: string): Promise<UserResponse> {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw notFound("User not found");
    }
    return this.toUserResponse(user);
  }

  async updateProfile(
    userId: string,
    data: UpdateProfileDTO,
  ): Promise<UserResponse> {
    if (data.email) {
      const existing = await this.userRepository.findByEmail(data.email);
      if (existing && existing.id !== userId) {
        throw conflict("Email already in use");
      }
    }

    const updated = await this.userRepository.update(userId, {
      ...(data.fullName && { fullName: data.fullName }),
      ...(data.email && { email: data.email }),
    });

    this.logger.info("Profile updated", { userId });

    return this.toUserResponse(updated);
  }

  async changePassword(userId: string, data: ChangePasswordDTO): Promise<void> {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw notFound("User not found");
    }

    const valid = await Bun.password.verify(
      data.currentPassword,
      user.passwordHash,
    );
    if (!valid) {
      throw badRequest("Current password is incorrect");
    }

    const passwordHash = await Bun.password.hash(data.newPassword, {
      algorithm: "bcrypt",
    });

    await this.userRepository.update(userId, { passwordHash });

    this.logger.info("Password changed", { userId });
  }

  private toUserResponse(user: {
    id: string;
    email: string;
    fullName: string;
    role: string;
    createdAt: Date;
  }): UserResponse {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      createdAt: user.createdAt,
    };
  }
}
