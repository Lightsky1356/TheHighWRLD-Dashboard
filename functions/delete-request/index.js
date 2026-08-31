const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Delete request - The High Wrld</title>
<style>
  :root { color-scheme: dark; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #020617; color: #e2e8f0; font-family: "Segoe UI", system-ui, sans-serif; padding: 24px; }
  .box { width: 100%; max-width: 480px; background: #0b1220; border: 1px solid #1e293b; border-radius: 18px; padding: 34px 30px; text-align: center; box-shadow: 0 24px 60px rgba(0,0,0,.5); }
  .ico { width: 64px; height: 64px; margin: 0 auto 18px; border-radius: 50%; background: linear-gradient(135deg,#ef4444,#f97316); display: flex; align-items: center; justify-content: center; font-size: 26px; }
  h1 { font-size: 22px; margin-bottom: 10px; }
  p { font-size: 14px; line-height: 1.65; color: #94a3b8; margin-bottom: 8px; }
  ol { text-align: left; margin: 16px 0 22px 20px; font-size: 14px; line-height: 2; color: #cbd5e1; }
  a.btn { display: inline-flex; align-items: center; gap: 8px; background: linear-gradient(135deg,#5865f2,#7289da); color: #fff; text-decoration: none; padding: 12px 20px; border-radius: 12px; font-weight: 600; font-size: 14px; }
  .muted { margin-top: 16px; font-size: 12px; color: #64748b; }
</style>
</head>
<body>
  <div class="box">
    <div class="ico">&#128465;</div>
    <h1>Request account deletion</h1>
    <p>To keep your data safe, accounts are only removed manually after a verified request.</p>
    <ol>
      <li>Join the server using the button below.</li>
      <li>Open the <b>#delete-requests</b> channel.</li>
      <li>Post your <b>@username</b> (the one shown in your account settings).</li>
    </ol>
    <p>Our team processes requests within 48 hours. You will be notified once your account has been removed.</p>
    <a class="btn" href="https://discord.gg/thehighwrld" target="_blank" rel="noopener nofollow">Join the server</a>
    <div class="muted">Questions? Ask in the server or reach out on Discord.</div>
  </div>
</body>
</html>`;

export async function onRequest() {
  return new Response(HTML, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
