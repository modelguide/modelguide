/**
 * Shared refresh-token cookie helpers.
 * Single source of truth for cookie name and config.
 */

import { env } from "@/env";
import { parseDuration } from "@lib/jwt";
import { deleteCookie, setCookie } from "hono/cookie";

const useSecureCookies = new URL(env.APP_URL).protocol === "https:";

export const REFRESH_COOKIE = useSecureCookies
  ? "__Host-refresh_token"
  : "refresh_token";

export function setRefreshCookie(
  c: Parameters<typeof setCookie>[0],
  token: string,
) {
  const maxAge = parseDuration(env.REFRESH_TOKEN_EXPIRES_IN);
  setCookie(c, REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: useSecureCookies,
    sameSite: "Strict",
    path: "/",
    maxAge,
  });
}

export function clearRefreshCookie(c: Parameters<typeof deleteCookie>[0]) {
  deleteCookie(c, REFRESH_COOKIE, {
    httpOnly: true,
    secure: useSecureCookies,
    sameSite: "Strict",
    path: "/",
  });
}
