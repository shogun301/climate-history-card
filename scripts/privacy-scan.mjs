import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const allowed = new Set([".js", ".mjs", ".json", ".md", ".yml", ".yaml", ".svg"]);
const deny = [
  [/\bmySCE\b/iu, "private utility identifier"],
  [/[A-Za-z]:\\Users\\/u, "absolute Windows user path"],
  [/(?:api[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]\s*["'][^"']+/iu, "possible embedded credential"],
];

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if ([".git", "node_modules", "coverage"].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (entry.name === "privacy-scan.mjs") continue;
    else if (allowed.has(extname(entry.name).toLowerCase()) || entry.name === "LICENSE") files.push(path);
  }
  return files;
}

const findings = [];
for (const file of await walk(root)) {
  const content = await readFile(file, "utf8");
  for (const [pattern, reason] of deny) {
    if (pattern.test(content)) findings.push(`${relative(root, file)}: ${reason}`);
  }
}
if (findings.length) {
  console.error(findings.join("\n"));
  process.exit(1);
}
console.log("Privacy scan passed");
