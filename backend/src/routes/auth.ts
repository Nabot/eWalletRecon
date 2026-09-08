import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { config } from "../config/env";
import { writeAuditLog } from "../lib/audit";
import { requireStaff } from "../middleware/auth";

export const authRouter = Router();

authRouter.post("/login", async (req, res) => {
  const body = z
    .object({ email: z.string().email(), password: z.string().min(1) })
    .safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: body.error.flatten() });

  const staff = await prisma.staffUser.findUnique({ where: { email: body.data.email } });
  const passwordOk = staff ? await bcrypt.compare(body.data.password, staff.passwordHash) : false;

  if (!staff || !passwordOk) {
    await writeAuditLog({
      actorType: staff ? "STAFF" : "SYSTEM",
      actorId: staff?.id ?? "anonymous",
      action: "STAFF_LOGIN_FAILED",
      entityType: "StaffUser",
      entityId: staff?.id ?? "unknown",
      metadata: { email: body.data.email },
    });
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const token = jwt.sign(
    { staffId: staff.id, email: staff.email, role: staff.role },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn } as jwt.SignOptions
  );

  await writeAuditLog({
    actorType: "STAFF",
    actorId: staff.id,
    action: "STAFF_LOGIN",
    entityType: "StaffUser",
    entityId: staff.id,
  });

  res.json({
    token,
    staff: { id: staff.id, email: staff.email, role: staff.role },
  });
});

authRouter.post("/logout", requireStaff, async (req, res) => {
  await writeAuditLog({
    actorType: "STAFF",
    actorId: req.staff!.staffId,
    action: "STAFF_LOGOUT",
    entityType: "StaffUser",
    entityId: req.staff!.staffId,
  });
  res.json({ ok: true });
});

authRouter.get("/me", requireStaff, async (req, res) => {
  const staff = await prisma.staffUser.findUnique({
    where: { id: req.staff!.staffId },
    select: { id: true, email: true, role: true, createdAt: true },
  });
  if (!staff) return res.status(404).json({ error: "Not found" });
  res.json(staff);
});
