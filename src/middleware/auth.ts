import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config";
import type { UserType } from "../types";

function userTypeFromPayload(raw: unknown): UserType {
  return raw === "business" ? "business" : "customer";
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, error: "Authentication required" });
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, config.jwt.secret) as unknown as {
      sub: number;
      email: string;
      is_admin: boolean;
      user_type?: unknown;
      type?: string;
    };

    if (payload.type === "refresh") {
      return res.status(401).json({ success: false, error: "Access token required" });
    }

    req.user = {
      id: payload.sub,
      email: payload.email,
      is_admin: payload.is_admin,
      user_type: userTypeFromPayload(payload.user_type),
    };
    next();
  } catch (err: any) {
    const message = err.name === "TokenExpiredError" ? "Token expired" : "Invalid token";
    return res.status(401).json({ success: false, error: message });
  }
}

export function optionalAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return next();
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, config.jwt.secret) as unknown as {
      sub: number;
      email: string;
      is_admin: boolean;
      user_type?: unknown;
      type?: string;
    };

    if (payload.type !== "refresh") {
      req.user = {
        id: payload.sub,
        email: payload.email,
        is_admin: payload.is_admin,
        user_type: userTypeFromPayload(payload.user_type),
      };
    }
    next();
  } catch {
    // Expired/invalid access token must not block public catalog endpoints (e.g. complete-style).
    // Client still sends x-user-id for try-on / wardrobe hints when JWT is stale.
    next();
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user || !req.user.is_admin) {
    return res.status(403).json({ success: false, error: "Admin access required" });
  }
  next();
}
