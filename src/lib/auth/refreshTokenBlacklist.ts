import crypto from "crypto";
import { pg } from "../core/db";

function hashRefreshToken(refreshToken: string): string {
  return crypto.createHash("sha256").update(refreshToken).digest("hex");
}

export async function blacklistRefreshToken(
  userId: number,
  refreshToken: string,
  expiresAt: Date
): Promise<void> {
  const tokenHash = hashRefreshToken(refreshToken);
  await pg.query(
    `INSERT INTO refresh_token_blacklist (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (token_hash) DO NOTHING`,
    [userId, tokenHash, expiresAt]
  );
}

export async function isRefreshTokenBlacklisted(refreshToken: string): Promise<boolean> {
  const tokenHash = hashRefreshToken(refreshToken);
  const result = await pg.query(
    `SELECT 1
     FROM refresh_token_blacklist
     WHERE token_hash = $1 AND expires_at > NOW()
     LIMIT 1`,
    [tokenHash]
  );

  return result.rows.length > 0;
}

export async function deleteExpiredBlacklistedRefreshTokens(): Promise<void> {
  await pg.query("DELETE FROM refresh_token_blacklist WHERE expires_at <= NOW()");
}
