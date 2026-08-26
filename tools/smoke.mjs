/**
 * Browser smoke test. Boots the built app in real Chrome and drives the things
 * unit tests cannot reach: the kernel worker, drawing, push/pull, history
 * scalar editing, share links and export.
 *
 *   npx vite preview --port 4173 &
 *   node tools/smoke.mjs http://localhost:4173/
 */
import puppeteer from "puppeteer-core";

const url = process.argv[2] ?? "http://localhost:4173/";
const chrome = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: "new",
  args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-gl=swiftshader"],
});

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

const problems = [];
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
page.on("requestfailed", (r) => problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
page.on("console", (m) => {
  if (m.type() === "error") problems.push(`console: ${m.text()}`);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const status = () => page.$eval("#status", (el) => el.textContent?.trim() ?? "");
const rows = (sectionIndex) =>
  page.evaluate(
    (i) =>
      [...document.querySelectorAll("#panel .section")[i].querySelectorAll(".row")].map((r) =>
        r.textContent.trim(),
      ),
    sectionIndex,
  );

await page.goto(url, { waitUntil: "networkidle2", timeout: 120_000 });
await page.waitForFunction(() => document.getElementById("loading")?.hidden === true, {
  timeout: 180_000,
});
check("kernel loads in a worker", true, await status());

check("example scene loads", (await rows(0)).length === 4);

/* ---------------------------------------------------------------- drawing */

await page.keyboard.press("2"); // top view
await sleep(700);
await page.keyboard.press("d"); // draw tool

const box = await page.$eval("#view", (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
const cx = box.x + box.w * 0.28;
const cy = box.y + box.h * 0.72;
const s = 70;

const corners = [
  [0, 0],
  [s, 0],
  [s, s],
  [0, s],
  [0, 0],
];
await page.mouse.move(cx, cy);
await page.mouse.down();
for (let c = 1; c < corners.length; c++) {
  const [ax, ay] = corners[c - 1];
  const [bx, by] = corners[c];
  for (let i = 1; i <= 10; i++) {
    const t = i / 10;
    await page.mouse.move(cx + ax + (bx - ax) * t, cy + ay + (by - ay) * t);
  }
}
await page.mouse.up();
await sleep(500);

const strokeRows = await rows(0);
check("a drawn stroke is captured", strokeRows.length === 5, strokeRows[4] ?? "(none)");
check(
  "freehand is beautified into a shape",
  /closed (rect|polygon|circle|ellipse)/.test(strokeRows[4] ?? ""),
  strokeRows[4] ?? "",
);

await page.keyboard.down("Control");
await page.keyboard.press("z");
await page.keyboard.up("Control");
await sleep(300);
check("undo removes the stroke", (await rows(0)).length === 4);

await page.keyboard.down("Control");
await page.keyboard.down("Shift");
await page.keyboard.press("z");
await page.keyboard.up("Shift");
await page.keyboard.up("Control");
await sleep(400);
check("redo brings it back", (await rows(0)).length === 5);

/* ------------------------------------------------------- stroke editing */

await page.keyboard.press("v"); // select tool
await page.mouse.click(cx + s / 2, cy); // on the top edge of the drawn square
await sleep(200);
const selected = await page.$$eval("#panel .section:nth-of-type(1) .row[aria-selected=true]", (r) =>
  r.map((x) => x.textContent.trim()),
);
check("clicking a stroke selects it", selected.length === 1, selected[0] ?? "(none)");
check(
  "selection actions appear",
  await page.$$eval("#panel .section:nth-of-type(1) .buttons .btn", (b) => b.length >= 3),
);

const link = () =>
  page.evaluate(() => {
    [...document.querySelectorAll("#panel .btn")].find((b) => b.textContent === "share link").click();
    const value = document.querySelector("dialog input")?.value;
    document.querySelector("dialog").close();
    return value;
  });
const beforeMove = await link();
await page.mouse.move(cx + s / 2, cy);
await page.mouse.down();
for (let i = 1; i <= 8; i++) await page.mouse.move(cx + s / 2 + i * 5, cy + i * 3);
await page.mouse.up();
await sleep(300);
check("dragging moves the stroke in its plane", beforeMove !== (await link()));

// the share dialog above left focus inside its input; shortcuts ignore those
await page.evaluate(() => document.activeElement?.blur());
await sleep(300);
await page.keyboard.down("Control");
await page.keyboard.press("d");
await page.keyboard.up("Control");
await sleep(500);
check("Ctrl+D duplicates the selection", (await rows(0)).length === 6);

await page.keyboard.down("Control");
await page.keyboard.press("z");
await page.keyboard.up("Control");
await sleep(300);
check("undo covers stroke edits too", (await rows(0)).length === 5);

// undo cleared the selection along with the duplicate, so pick the stroke again
await page.evaluate(() => {
  document.querySelectorAll("#panel .section:nth-of-type(1) .row")[4].click();
});
await sleep(200);
await page.keyboard.press("]");
await sleep(400);
check(
  "re-levelling moves a stroke along its plane normal",
  ((await rows(0))[4] ?? "").includes("ground@0.5"),
  (await rows(0))[4] ?? "",
);
await page.keyboard.press("[");
await sleep(300);
await page.keyboard.press("d");

/* ------------------------------------------------------------- interpret */

await page.keyboard.press("1"); // iso
await sleep(700);
await page.click(".intent .btn");
await page.waitForFunction(
  () => document.querySelectorAll("#panel .section")[1].querySelectorAll(".row").length > 0,
  { timeout: 60_000 },
);
await sleep(3000);

const history = await rows(1);
const solids = await rows(2);
check("interpret builds history nodes", history.length >= 3, history.join(" | "));
check("solids are evaluated", solids.length >= 3, solids.join(" | "));
check(
  "no node is in an error state",
  await page.$$eval("#panel .row.error", (e) => e.length === 0),
);

// keep the proposal, the way a user would before carrying on
await page.evaluate(() => {
  const btn = [...document.querySelectorAll(".proposal .btn")].find(
    (b) => b.textContent === "keep",
  );
  btn?.click();
});
await sleep(500);
check("proposals can be kept", await page.$$eval(".proposal", (e) => e.length === 0));

/* ------------------------------------------------- history scalar editing */

const before = solids.join(" | ");
const edited = await page.evaluate(() => {
  const input = document.querySelector("#panel .scalars input");
  const label = input.closest("label").textContent.trim();
  input.value = String(Number(input.value) * 2);
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return label;
});
await sleep(3000);
const after = (await rows(2)).join(" | ");
check("editing a history scalar re-evaluates the model", before !== after, `${edited}: ${after}`);

/* ------------------------------------------------------------- push/pull */

await page.keyboard.press("p");
const mid = { x: box.x + box.w * 0.5, y: box.y + box.h * 0.45 };
await page.mouse.move(mid.x, mid.y);
await page.mouse.down();
await sleep(400);
for (let i = 1; i <= 10; i++) await page.mouse.move(mid.x, mid.y - i * 6);
await page.mouse.up();
await sleep(2500);
const afterPush = await rows(1);
check(
  "push/pull records an op in history",
  afterPush.some((r) => r.includes("push_pull")),
  afterPush.at(-1) ?? "",
);

/* ---------------------------------------------------------------- export */

await page.evaluate(() => {
  const btn = [...document.querySelectorAll("#panel .btn")].find((b) => b.textContent === "STEP");
  btn.click();
});
await page
  .waitForFunction(
    () => /exported|error|nothing/i.test(document.getElementById("status")?.textContent ?? ""),
    { timeout: 60_000 },
  )
  .catch(() => {});
const exportStatus = await status();
check("STEP export produces a file", /exported model\.step/.test(exportStatus), exportStatus);

/* ----------------------------------------------------------------- share */

const shareLink = await page.evaluate(() => {
  const btn = [...document.querySelectorAll("#panel .btn")].find(
    (b) => b.textContent === "share link",
  );
  btn.click();
  const value = document.querySelector("dialog input")?.value;
  document.querySelector("dialog").close();
  return value;
});
check("share link is produced", Boolean(shareLink), `${shareLink?.length ?? 0} chars`);

const page2 = await browser.newPage();
await page2.setViewport({ width: 1440, height: 900 });
await page2.goto(shareLink, { waitUntil: "networkidle2", timeout: 120_000 });
await page2.waitForFunction(() => document.getElementById("loading")?.hidden === true, {
  timeout: 180_000,
});
await page2.waitForFunction(
  () => {
    const r = [...document.querySelectorAll("#panel .section")[2].querySelectorAll(".row")];
    return r.length > 0 && r.every((x) => !x.textContent.includes("…"));
  },
  { timeout: 60_000 },
);
const sharedSolids = await page2.evaluate(() =>
  [...document.querySelectorAll("#panel .section")[2].querySelectorAll(".row")].map((r) =>
    r.textContent.trim(),
  ),
);
check(
  "a shared link re-evaluates to the same solids",
  JSON.stringify(sharedSolids) === JSON.stringify(await rows(2)),
  sharedSolids.join(" | "),
);
await page2.close();

/* ------------------------------------------------------------- overlays */

await page.evaluate(() => {
  const btn = [...document.querySelectorAll(".rail .tool")].find(
    (b) => b.getAttribute("aria-label") === "Capabilities",
  );
  btn.click();
});
await sleep(300);
check(
  "the capabilities drawer lists every op",
  await page.$$eval("dialog tbody tr", (r) => r.length >= 30),
);
await page.evaluate(() => document.querySelector("dialog").close());

await page.keyboard.press("1");
await sleep(900);
await page.screenshot({ path: "tools/smoke.png" });

if (problems.length) {
  console.log("\nconsole problems:");
  for (const p of [...new Set(problems)]) console.log("  ", p);
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
await browser.close();
process.exit(failed.length ? 1 : 0);
