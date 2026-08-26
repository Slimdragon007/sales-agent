import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const distAssets = join(process.cwd(), "dist", "assets");
const forbidden = [
  /sk-[a-zA-Z0-9_-]{20,}/,
  /OPENAI_API_KEY\s*[:=]\s*["'][^"']+["']/,
  /TWILIO_API_KEY_SECRET/,
  /PREVIEW_PASSWORD\s*[:=]/,
];

const files = readdirSync(distAssets).filter((name) =>
  /\.(js|css|map)$/.test(name),
);
const hits = [];

for (const file of files) {
  const contents = readFileSync(join(distAssets, file), "utf8");
  for (const pattern of forbidden) {
    if (pattern.test(contents)) {
      hits.push(`${file} matches ${pattern}`);
    }
  }
}

if (hits.length > 0) {
  console.error("Client bundle audit failed:\n" + hits.join("\n"));
  process.exit(1);
}

console.log(`Client bundle audit passed for ${files.length} assets.`);
