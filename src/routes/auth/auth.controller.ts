import { Request, Response, NextFunction } from "express";
import { signup, login, refreshTokens, getMe, updateProfile } from "./auth.service";

export async function signupHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password } = req.body;
    const result = await signup(email, password);
    res.status(201).json({
      success: true,
      user: result.user,
      access_token: result.accessToken,
      refresh_token: result.refreshToken,
    });
  } catch (err: any) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, error: err.message });
    next(err);
  }
}

export async function loginHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password } = req.body;
    const result = await login(email, password);
    res.json({
      success: true,
      user: result.user,
      access_token: result.accessToken,
      refresh_token: result.refreshToken,
    });
  } catch (err: any) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, error: err.message });
    next(err);
  }
}

export async function refreshHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { refresh_token } = req.body;
    const result = await refreshTokens(refresh_token);
    res.json({
      success: true,
      access_token: result.accessToken,
      refresh_token: result.refreshToken,
    });
  } catch (err: any) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, error: err.message });
    next(err);
  }
}

export async function meHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await getMe(req.user!.id);
    if (!user) return res.status(404).json({ success: false, error: "User not found" });
    res.json({ success: true, user });
  } catch (err) {
    next(err);
  }
}

export async function updateProfileHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await updateProfile(req.user!.id, req.body);
    res.json({ success: true, user });
  } catch (err: any) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, error: err.message });
    next(err);
  }
}
