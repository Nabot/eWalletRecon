import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { StaffRole } from "@prisma/client";
import { config } from "../config/env";
import { prisma } from "../lib/prisma";
import { hashApiKey } from "../lib/crypto";

export interface StaffAuth {
  staffId: string;
  email: string;
  role: StaffRole;
}

export interface DeviceAuth {
  deviceId: string;
  name: string;
  walletNumberId: string;
}

declare global {
  namespace Express {
    interface Request {
      staff?: StaffAuth;
      device?: DeviceAuth;
    }
  }
}

export function requireStaff(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing bearer token" });
  }
  try {
    const payload = jwt.verify(header.slice(7), config.jwtSecret) as StaffAuth;
    req.staff = payload;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function requireRole(...roles: StaffRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.staff) return res.status(401).json({ error: "Unauthorized" });
    if (!roles.includes(req.staff.role)) {
      return res.status(403).json({ error: "Insufficient role" });
    }
    next();
  };
}

export async function requireDevice(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.headers["x-api-key"];
  if (!apiKey || typeof apiKey !== "string") {
    return res.status(401).json({ error: "Missing X-Api-Key" });
  }
  const hash = hashApiKey(apiKey);
  const device = await prisma.captureDevice.findFirst({
    where: { apiKeyHash: hash },
  });
  if (!device) return res.status(401).json({ error: "Invalid API key" });

  req.device = {
    deviceId: device.id,
    name: device.name,
    walletNumberId: device.walletNumberId,
  };
  next();
}
