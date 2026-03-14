import jwt from "jsonwebtoken";

export interface JWTPayload {
  userId: string;
  role: string;
}

export function signToken(
  payload: JWTPayload,
  secret: string,
  expiresIn: string,
): string {
  return jwt.sign(payload, secret, {
    expiresIn: expiresIn as jwt.SignOptions["expiresIn"],
  });
}

export function verifyToken(token: string, secret: string): JWTPayload {
  return jwt.verify(token, secret) as JWTPayload;
}
