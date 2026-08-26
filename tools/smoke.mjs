/**
 * Browser smoke test: boots the built app in real Chrome, waits for the kernel,
 * presses Interpret and checks that solids actually appeared. Run against a
 * preview server: `node tools/smoke.mjs http://localhost:4173/`
 */
import puppeteer from "puppeteer-core";

const url = process.argv[2] ?? "http://localhost:4173/";
const chrome =
  process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: "new",
  args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-gl=swiftshader"],
});

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
page.on("requestfailed", (r) => logs.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));

await page.goto(url, { waitUntil: "networkidle2", timeout: 120_000 });

const status = () => page.$eval("#status", (el) => el.textContent ?? "");

// wait for the kernel loader to disappear
await page.waitForFunction(() => document.getElementById("loading")?.hidden === true, {
  timeout: 180_000,
});
console.log("kernel ready:", await status());

const strokes = await page.$$eval("#panel .section:nth-of-type(1) .row", (r) => r.length);
console.log("example strokes:", strokes);

await page.click("#intent + .btn, .intent .btn");
await page.waitForFunction(
  () => (document.querySelectorAll("#panel .section:nth-of-type(2) .row").length ?? 0) > 0,
  { timeout: 60_000 },
);
await new Promise((r) => setTimeout(r, 4000));

const summary = await page.evaluate(() => {
  const sections = [...document.querySelectorAll("#panel .section")];
  const grab = (i) =>
    [...(sections[i]?.querySelectorAll(".row") ?? [])].map((r) => r.textContent.trim());
  return {
    status: document.getElementById("status")?.textContent,
    history: grab(1),
    solids: grab(2),
    counts: document.querySelectorAll(".hud .chip")[1]?.textContent,
  };
});
console.log(JSON.stringify(summary, null, 2));

await page.screenshot({ path: "tools/smoke.png" });

const bad = logs.filter((l) => l.startsWith("[pageerror]") || l.startsWith("[requestfailed]"));
if (bad.length) {
  console.log("\nPROBLEMS:");
  for (const l of bad) console.log(" ", l);
}
console.log("\nall console output:");
for (const l of logs.slice(-40)) console.log(" ", l);

await browser.close();
process.exit(summary.solids.length ? 0 : 1);
