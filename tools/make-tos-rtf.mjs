// Build the NSIS license page as RTF so the site address is a real hyperlink.
// Plain .txt shown in the NSIS license dialog is not clickable.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(process.cwd(), "electron-app", "build");
const text = readFileSync(join(dir, "TOS.txt"), "utf8").replace(/\r\n/g, "\n");
const url = "https://thehighwrlddashboard.pages.dev";

const esc = (s) => s.replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}");
const link = `{\\field{\\*\\fldinst{HYPERLINK "${url}"}}{\\fldrslt{\\cf1\\ul thehighwrlddashboard.pages.dev\\ul0\\cf0}}}`;

const body = text
  .split("\n")
  .map((line) => esc(line).replace("thehighwrlddashboard.pages.dev", link))
  .join("\\par\n");

const rtf = `{\\rtf1\\ansi\\ansicpg1252\\deff0
{\\fonttbl{\\f0\\fswiss\\fcharset0 Arial;}}
{\\colortbl;\\red0\\green0\\blue255;}
\\viewkind4\\uc1\\pard\\f0\\fs20
${body}
\\par
}`;

writeFileSync(join(dir, "TOS.rtf"), rtf, "ascii");
console.log(`TOS.rtf written (${rtf.length} bytes)`);
