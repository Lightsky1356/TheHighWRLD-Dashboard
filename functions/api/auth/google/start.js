import { json, randomHex } from "../../../_lib/auth.js";

export async function onRequestGet(context) {
  const clientId = context.env.GOOGLE_CLIENT_ID || "";
  const clientSecret = context.env.GOOGLE_CLIENT_SECRET || "";
  if (!clientId || !clientSecret) {
    return json({ error: "Google login not configured yet" }, 503);
  }
  const redirectUri = "https://thehighwrlddashboard.pages.dev/api/auth/google/callback";
  const state = randomHex(16);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: state,
    prompt: "select_account",
    access_type: "online",
  });
  return new Response(null, {
    status: 302,
    headers: {
      Location: "https://accounts.google.com/o/oauth2/v2/auth?" + params.toString(),
      "Set-Cookie": "oauth_state=" + state + "; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=600",
    },
  });
}
