// GET /api/submission-rules
// Serves the rule text for Suggestions, the Wanted Vault, and the Gallery from
// the same module that enforces them (_lib/submissionRules.js), so the rules a
// user reads in the tab are exactly the rules applied on submit.

import { publicRuleSet } from "../_lib/submissionRules.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function onRequestGet() {
  return new Response(JSON.stringify({ ok: true, surfaces: publicRuleSet() }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
      ...CORS,
    },
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}
