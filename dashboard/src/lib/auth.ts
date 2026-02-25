import { cookies } from "next/headers";
import { loadConfig } from "./config";

const SESSION_COOKIE = "ccdash_session";
const SESSION_TOKEN = "ccdash_authenticated";

export async function isAuthenticated(): Promise<boolean> {
  const cookieStore = await cookies();
  const session = cookieStore.get(SESSION_COOKIE);
  return session?.value === SESSION_TOKEN;
}

export function verifyPassword(password: string): boolean {
  const config = loadConfig();
  return password === config.auth.password;
}
