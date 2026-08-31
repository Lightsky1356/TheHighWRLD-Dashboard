import { randomHex, json } from "../../_lib/auth.js";

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const uid = (url.searchParams.get("uid") || "").slice(0, 40);
    const mode = url.searchParams.get("mode") || "";
    const clientId = context.env.DISCORD_CLIENT_ID || "";
    if (!clientId) {
      return json({ error: "Discord login not configured yet" }, 503);
    }
    const redirectUri = "https://thehighwrlddashboard.pages.dev/api/discord/callback";
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      redirect_uri: redirectUri,
    });

    let state = uid;
    let setCookie = "";
    if (mode === "login") {
      const csrf = randomHex(16);
      state = "login:" + csrf;
      params.set("scope", "identify email");
      setCookie = "oauth_state=" + csrf + "; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=600";
    } else {
      params.set("scope", "identify");
      state = uid + (mode === "popup" ? ":popup" : "");
    }
    params.set("state", state);

    const headers = { Location: "https://discord.com/oauth2/authorize?" + params.toString() };
    if (setCookie) headers["Set-Cookie"] = setCookie;
    return new Response(null, { status: 302, headers });
  } catch (err) {
    return new Response("Login error: " + String(err && err.message || err), { status: 500 });
  }
}
