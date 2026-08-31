import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";

await mkdir(new URL("../dist/", import.meta.url), { recursive: true });
const sourceUrl = new URL("../src/climate-history-card.js", import.meta.url);
const distUrl = new URL("../dist/climate-history-card.js", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const banner = "/* Climate History Card v0.1.1 | Apache-2.0 */\n";
await writeFile(distUrl, banner + source.replace(/^\/\* Climate History Card[^\n]*\*\/\s*/u, ""), "utf8");
console.log("Built dist/climate-history-card.js");
