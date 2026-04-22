import { NextResponse } from "next/server";
import { getAuthUrl } from "@/lib/graph";

export async function GET() {
  const base = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const redirectUri = `${base}/api/outlook/callback`;
  const url = getAuthUrl(redirectUri);
  return NextResponse.redirect(url);
}
