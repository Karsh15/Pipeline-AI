import type { Request, Response } from "express";
import { supabaseAdmin } from "../lib/supabase";

export async function outlookDisconnectHandler(_req: Request, res: Response) {
  const db = supabaseAdmin();
  await db.from("outlook_tokens").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  res.json({ success: true });
}
