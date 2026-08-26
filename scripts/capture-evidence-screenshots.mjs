import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const baseUrl = process.env.EVIDENCE_BASE_URL ?? "http://127.0.0.1:4173";
const outputDir = resolve("docs/evidence/v1");

await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch();
const desktopContext = await browser.newContext({
  viewport: { width: 1568, height: 1003 },
  deviceScaleFactor: 1,
});
const desktopPage = await desktopContext.newPage();
await desktopPage.goto(baseUrl, { waitUntil: "networkidle" });
await desktopPage.waitForTimeout(500);
await desktopPage.screenshot({
  path: resolve(outputDir, "desktop-command-center.png"),
  fullPage: false,
});
await desktopContext.close();

const mobileContext = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  isMobile: true,
});
const mobilePage = await mobileContext.newPage();
await mobilePage.goto(baseUrl, { waitUntil: "networkidle" });
await mobilePage.waitForTimeout(500);
await mobilePage.screenshot({
  path: resolve(outputDir, "mobile-390-command-center.png"),
  fullPage: false,
});
await mobileContext.close();

await browser.close();
console.log(`Captured screenshots in ${outputDir}`);
