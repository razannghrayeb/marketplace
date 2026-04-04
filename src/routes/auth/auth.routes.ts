import { Router } from "express";
import { z } from "zod";
import { validateBody } from "../../middleware/validate";
import { requireAuth } from "../../middleware/auth";
import {
  signupHandler,
  loginHandler,
  refreshHandler,
  logoutHandler,
  meHandler,
  updateProfileHandler,
} from "./auth.controller";

const router = Router();

const signupSchema = z.object({
  email: z.string().email("Invalid email format"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  user_type: z.enum(["customer", "business"]).optional().default("customer"),
});

const loginSchema = z.object({
  email: z.string().email("Invalid email format"),
  password: z.string().min(1, "Password is required"),
});

const refreshSchema = z.object({
  refresh_token: z.string().min(1, "Refresh token is required"),
});

const logoutSchema = z.object({
  refresh_token: z.string().min(1, "Refresh token is required"),
});

const updateProfileSchema = z.object({
  email: z.string().email("Invalid email format").optional(),
  password: z.string().min(8, "Password must be at least 8 characters").optional(),
}).refine(data => data.email !== undefined || data.password !== undefined, {
  message: "At least one field (email or password) must be provided",
});

router.post("/signup", validateBody(signupSchema), signupHandler);
router.post("/login", validateBody(loginSchema), loginHandler);
router.post("/refresh", validateBody(refreshSchema), refreshHandler);
router.post("/logout", validateBody(logoutSchema), logoutHandler);

router.get("/me", requireAuth, meHandler);
router.patch("/me", requireAuth, validateBody(updateProfileSchema), updateProfileHandler);

export default router;
export { router as authRouter };
