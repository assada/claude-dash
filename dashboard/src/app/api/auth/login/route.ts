import { NextRequest, NextResponse } from "next/server";
import { verifyPassword } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { password } = body;

  if (!password || !verifyPassword(password)) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set("ccdash_session", "ccdash_authenticated", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });

  return response;
}
