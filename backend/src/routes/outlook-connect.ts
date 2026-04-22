import type { Request, Response } from "express";
import { getAuthUrl } from "../lib/graph";

export function outlookConnectHandler(req: Request, res: Response) {
  const base = process.env.APP_URL ?? "http://localhost:5173";
  const redirectUri = `${process.env.APP_URL ?? "http://localhost:4000"}/api/outlook/callback`;
  const url = getAuthUrl(redirectUri);
  res.redirect(url);
}
