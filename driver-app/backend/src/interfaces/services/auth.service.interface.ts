import type {
  AuthResponse,
  LoginDTO,
  RegisterDTO,
  UserResponse,
} from "../../types/dto";

export interface IAuthService {
  register(data: RegisterDTO): Promise<AuthResponse>;
  login(data: LoginDTO): Promise<AuthResponse>;
  getProfile(userId: string): Promise<UserResponse>;
}
