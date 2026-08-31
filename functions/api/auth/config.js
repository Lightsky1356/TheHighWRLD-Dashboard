import { json } from "../../_lib/auth.js";

export async function onRequestGet(context) {
  return json({
    google: !!(context.env.GOOGLE_CLIENT_ID && context.env.GOOGLE_CLIENT_SECRET),
    discord: !!(context.env.DISCORD_CLIENT_ID && context.env.DISCORD_CLIENT_SECRET),
    hcaptchaSiteKey: context.env.HCAPTCHA_SITE_KEY || "",
    hcaptchaConfigured: !!(context.env.HCAPTCHA_SITE_KEY && context.env.HCAPTCHA_SECRET),
  });
}
