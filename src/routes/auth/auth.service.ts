import bcrypt from "bcryptjs";
import jwt, { JwtPayload, SignOptions } from "jsonwebtoken";
import {
  blacklistRefreshToken,
  deleteExpiredBlacklistedRefreshTokens,
  isRefreshTokenBlacklisted,
} from "../../lib/auth/refreshTokenBlacklist";
import { pg } from "../../lib/core/db";
import { config } from "../../config";
import { AuthUser, UserRow, UserType } from "../../types";

const SALT_ROUNDS = 12;

function signAccessToken(user: AuthUser): string {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      is_admin: user.is_admin,
      user_type: user.user_type,
      type: "access",
    },
    config.jwt.secret,
    { expiresIn: config.jwt.accessExpiresIn } as SignOptions
  );
}

function signRefreshToken(userId: number): string {
  return jwt.sign(
    { sub: userId, type: "refresh" },
    config.jwt.secret,
    { expiresIn: config.jwt.refreshExpiresIn } as SignOptions
  );
}

function verifyRefreshToken(refreshToken: string): JwtPayload & { sub: number; type: string } {
  let payload: any;
  try {
    payload = jwt.verify(refreshToken, config.jwt.secret);
  } catch {
    const err: any = new Error("Invalid or expired refresh token");
    err.statusCode = 401;
    throw err;
  }

  if (payload.type !== "refresh") {
    const err: any = new Error("Invalid token type");
    err.statusCode = 401;
    throw err;
  }

  return payload;
}

export async function signup(
  email: string,
  password: string,
  userType: UserType = "customer"
): Promise<{ user: AuthUser; accessToken: string; refreshToken: string }> {
  const normalEmail = email.toLowerCase().trim();
  const ut: UserType = userType === "business" ? "business" : "customer";

  const existing = await pg.query("SELECT id FROM users WHERE email = $1", [normalEmail]);
  if (existing.rows.length > 0) {
    const err: any = new Error("Email already registered");
    err.statusCode = 409;
    throw err;
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const result = await pg.query<{ id: number; email: string; is_admin: boolean; user_type: UserType }>(
    `INSERT INTO users (email, password_hash, user_type)
     VALUES ($1, $2, $3)
     RETURNING id, email, is_admin, user_type`,
    [normalEmail, passwordHash, ut]
  );

  const row = result.rows[0];
  const user: AuthUser = {
    id: row.id,
    email: row.email,
    is_admin: row.is_admin,
    user_type: row.user_type ?? "customer",
  };
  return {
    user,
    accessToken: signAccessToken(user),
    refreshToken: signRefreshToken(user.id),
  };
}

export async function login(
  email: string,
  password: string
): Promise<{ user: AuthUser; accessToken: string; refreshToken: string }> {
  const normalEmail = email.toLowerCase().trim();

  const result = await pg.query<UserRow>(
    "SELECT id, email, password_hash, is_active, is_admin, user_type FROM users WHERE email = $1",
    [normalEmail]
  );
  const row = result.rows[0];

  if (!row) {
    const err: any = new Error("Invalid email or password");
    err.statusCode = 401;
    throw err;
  }

  if (!row.is_active) {
    const err: any = new Error("Account is deactivated");
    err.statusCode = 403;
    throw err;
  }

  const valid = await bcrypt.compare(password, row.password_hash);
  if (!valid) {
    const err: any = new Error("Invalid email or password");
    err.statusCode = 401;
    throw err;
  }

  await pg.query("UPDATE users SET last_login = NOW() WHERE id = $1", [row.id]);

  const user: AuthUser = {
    id: row.id,
    email: row.email,
    is_admin: row.is_admin,
    user_type: row.user_type ?? "customer",
  };
  return {
    user,
    accessToken: signAccessToken(user),
    refreshToken: signRefreshToken(user.id),
  };
}

export async function refreshTokens(
  refreshToken: string
): Promise<{ accessToken: string; refreshToken: string }> {
  const payload = verifyRefreshToken(refreshToken);

  await deleteExpiredBlacklistedRefreshTokens();
  if (await isRefreshTokenBlacklisted(refreshToken)) {
    const err: any = new Error("Invalid or expired refresh token");
    err.statusCode = 401;
    throw err;
  }

  const result = await pg.query<UserRow>(
    "SELECT id, email, is_admin, is_active, user_type FROM users WHERE id = $1",
    [payload.sub]
  );
  const row = result.rows[0];
  if (!row || !row.is_active) {
    const err: any = new Error("User not found or deactivated");
    err.statusCode = 401;
    throw err;
  }

  const user: AuthUser = {
    id: row.id,
    email: row.email,
    is_admin: row.is_admin,
    user_type: row.user_type ?? "customer",
  };
  return {
    accessToken: signAccessToken(user),
    refreshToken: signRefreshToken(user.id),
  };
}

export async function logout(refreshToken: string): Promise<void> {
  const payload = verifyRefreshToken(refreshToken);
  if (!payload.exp) {
    const err: any = new Error("Refresh token is missing expiry");
    err.statusCode = 400;
    throw err;
  }

  await deleteExpiredBlacklistedRefreshTokens();
  await blacklistRefreshToken(payload.sub, refreshToken, new Date(payload.exp * 1000));
}

export async function getMe(userId: number) {
  const result = await pg.query(
    "SELECT id, email, is_active, is_admin, user_type, created_at, last_login FROM users WHERE id = $1",
    [userId]
  );
  return result.rows[0] ?? null;
}

export async function updateProfile(
  userId: number,
  updates: { email?: string; password?: string }
) {
  const sets: string[] = [];
  const values: any[] = [];
  let i = 1;

  if (updates.email !== undefined) {
    const normalEmail = updates.email.toLowerCase().trim();
    const existing = await pg.query(
      "SELECT id FROM users WHERE email = $1 AND id != $2",
      [normalEmail, userId]
    );
    if (existing.rows.length > 0) {
      const err: any = new Error("Email already in use");
      err.statusCode = 409;
      throw err;
    }
    sets.push(`email = $${i++}`);
    values.push(normalEmail);
  }

  if (updates.password !== undefined) {
    const hash = await bcrypt.hash(updates.password, SALT_ROUNDS);
    sets.push(`password_hash = $${i++}`);
    values.push(hash);
  }

  if (sets.length === 0) {
    const err: any = new Error("No fields to update");
    err.statusCode = 400;
    throw err;
  }

  values.push(userId);
  const result = await pg.query(
    `UPDATE users SET ${sets.join(", ")} WHERE id = $${i}
     RETURNING id, email, is_active, is_admin, user_type, created_at, last_login`,
    values
  );
  return result.rows[0];
}
