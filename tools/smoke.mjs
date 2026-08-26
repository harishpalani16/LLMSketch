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
const modelRows = (sectionIndex) =>
  page.evaluate(
    (i) =>
      [...document.querySelectorAll("#panel .panel-pane")[1].querySelectorAll(".object-list")[i].querySelectorAll(".object-row")].map((r) => r.textContent.trim()),
    sectionIndex,
  );
const historyRows = () =>
  page.evaluate(() =>
    [...document.querySelectorAll("#panel .panel-pane")[2].querySelectorAll(".history-card")].map((r) => r.textContent.trim()),
  );

await page.goto(url, { waitUntil: "networkidle2", timeout: 120_000 });
await page.waitForFunction(() => document.getElementById("loading")?.hidden === true, {
  timeout: 180_000,
});
check("kernel loads in a worker", true, await status());

check("example scene loads", (await modelRows(0)).length === 4);

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

const strokeRows = await modelRows(0);
check("a drawn stroke is captured", strokeRows.length === 5, strokeRows[4] ?? "(none)");
check(
  "freehand is beautified into a shape",
  /(Rectangle|Polygon|Circle|Ellipse)/.test(strokeRows[4] ?? ""),
  strokeRows[4] ?? "",
);

await page.keyboard.down("Control");
await page.keyboard.press("z");
await page.keyboard.up("Control");
await sleep(300);
check("undo removes the stroke", (await modelRows(0)).length === 4);

await page.keyboard.down("Control");
await page.keyboard.down("Shift");
await page.keyboard.press("z");
await page.keyboard.up("Shift");
await page.keyboard.up("Control");
await sleep(400);
check("redo brings it back", (await modelRows(0)).length === 5);

await page.keyboard.press("l");
await page.mouse.move(cx - 90, cy - 55);
await page.mouse.down();
await page.mouse.move(cx - 15, cy - 55, { steps: 8 });
await page.mouse.up();
await sleep(300);
check("the explicit line tool creates a line", (await modelRows(0)).at(-1)?.includes("Line") ?? false);
await page.keyboard.down("Control");
await page.keyboard.press("z");
await page.keyboard.up("Control");
await sleep(250);

await page.select("#plane-select", "view");
await page.keyboard.press("r");
await page.mouse.move(cx - 110, cy - 100);
await page.mouse.down();
await page.mouse.move(cx - 40, cy - 40, { steps: 8 });
await page.mouse.up();
await sleep(300);
await page.evaluate(() => {
  const rows = document.querySelectorAll("#panel .panel-pane")[1].querySelectorAll(".object-list")[0].querySelectorAll(".object-row");
  rows[rows.length - 1].click();
});
check(
  "current-view workplane is saved on the sketch",
  await page.$$eval("#panel .property-grid dd", (d) => d.some((x) => x.textContent.includes("Custom / view"))),
);
await page.keyboard.down("Control");
await page.keyboard.press("z");
await page.keyboard.up("Control");
await page.select("#plane-select", "ground");
await sleep(250);

/* ------------------------------------------------------- stroke editing */

await page.keyboard.press("v"); // select tool
await page.mouse.click(cx + s / 2, cy); // on the top edge of the drawn square
await sleep(200);
const selected = await page.evaluate(() =>
  [...document.querySelectorAll("#panel .panel-pane")[1].querySelectorAll(".object-list")[0].querySelectorAll(".object-row[aria-selected=true]")].map((x) => x.textContent.trim()),
);
check("clicking a stroke selects it", selected.length === 1, selected[0] ?? "(none)");
check(
  "selection actions appear",
  await page.$$eval("#panel .inspector-actions .btn", (b) => b.length >= 3),
);

const link = () =>
  page.evaluate(() => {
    [...document.querySelectorAll("#panel .btn")].find((b) => b.textContent === "Share link").click();
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
check("Ctrl+D duplicates the selection", (await modelRows(0)).length === 6);

await page.keyboard.down("Control");
await page.keyboard.press("z");
await page.keyboard.up("Control");
await sleep(300);
check("undo covers stroke edits too", (await modelRows(0)).length === 5);

// undo cleared the selection along with the duplicate, so pick the stroke again
await page.evaluate(() => {
  document.querySelectorAll("#panel .panel-pane")[1].querySelectorAll(".object-list")[0].querySelectorAll(".object-row")[4].click();
});
await sleep(200);
await page.keyboard.press("]");
await sleep(400);
check(
  "re-levelling moves a stroke along its plane normal",
  await page.$$eval("#panel .property-grid dd", (d) => d.some((x) => x.textContent.includes("0.5 m"))),
  "properties show 0.5 m",
);
await page.keyboard.press("[");
await sleep(300);
await page.keyboard.press("d");

/* ------------------------------------------------------------- interpret */

await page.keyboard.press("1"); // iso
await sleep(700);
await page.click(".intent .btn");
await page.waitForFunction(
  () => document.querySelectorAll("#panel .panel-pane")[2].querySelectorAll(".history-card").length > 0,
  { timeout: 60_000 },
);
await sleep(3000);

const history = await historyRows();
const solids = await modelRows(1);
check("interpret builds history nodes", history.length >= 3, history.join(" | "));
check("solids are evaluated", solids.length >= 3, solids.join(" | "));
check(
  "no node is in an error state",
  await page.$$eval("#panel .history-card.error", (e) => e.length === 0),
);

// keep the proposal, the way a user would before carrying on
await page.evaluate(() => {
  const btn = [...document.querySelectorAll(".proposal .btn")].find(
    (b) => b.textContent === "Accept changes",
  );
  btn?.click();
});
await sleep(500);
check("proposals can be kept", await page.$$eval(".proposal", (e) => e.length === 0));

/* ------------------------------------------------- history scalar editing */

const before = solids.join(" | ");
const edited = await page.evaluate(() => {
  document.querySelectorAll("#panel .panel-pane")[2].querySelectorAll(".history-card")[1].click();
  const input = document.querySelector("#panel .node-editor input");
  const label = input.closest("label").textContent.trim();
  input.value = String(Number(input.value) * 2);
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return label;
});
await sleep(3000);
const after = (await modelRows(1)).join(" | ");
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
const afterPush = await historyRows();
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
    (b) => b.textContent === "Share link",
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
    const r = [...document.querySelectorAll("#panel .panel-pane")[1].querySelectorAll(".object-list")[1].querySelectorAll(".object-row")];
    return r.length > 0 && r.every((x) => !x.textContent.includes("Building"));
  },
  { timeout: 60_000 },
);
const sharedSolids = await page2.evaluate(() =>
  [...document.querySelectorAll("#panel .panel-pane")[1].querySelectorAll(".object-list")[1].querySelectorAll(".object-row")].map((r) =>
    r.textContent.trim(),
  ),
);
check(
  "a shared link re-evaluates to the same solids",
  JSON.stringify(sharedSolids) === JSON.stringify(await modelRows(1)),
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

/* --------------------------------------------------------------- iPad UI */

const ipad = await browser.newPage();
await ipad.setViewport({ width: 1024, height: 768, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ipad.goto(url, { waitUntil: "networkidle2", timeout: 120_000 });
await ipad.waitForFunction(() => document.getElementById("loading")?.hidden === true, { timeout: 180_000 });

const tabletLayout = async () => ipad.evaluate(() => {
  const stage = document.querySelector(".stage").getBoundingClientRect();
  const workplane = document.querySelector(".planebar").getBoundingClientRect();
  const intent = document.querySelector(".intent").getBoundingClientRect();
  const tools = [...document.querySelectorAll(".rail .tool")].map((x) => x.getBoundingClientRect().height);
  const inputSize = Number.parseFloat(getComputedStyle(document.querySelector(".intent input")).fontSize);
  return {
    noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth,
    stageVisible: stage.width > 700 && stage.right <= innerWidth,
    overlaysInside: workplane.right <= stage.right && intent.right <= stage.right && intent.bottom <= innerHeight,
    touchTargets: Math.min(...tools) >= 44,
    inputSize,
  };
});

const landscape = await tabletLayout();
check("iPad landscape fits without horizontal overflow", landscape.noHorizontalOverflow && landscape.stageVisible);
check("iPad canvas overlays remain inside the viewport", landscape.overlaysInside);
check("iPad controls use touch-sized targets", landscape.touchTargets && landscape.inputSize >= 16, JSON.stringify(landscape));

await ipad.tap('.rail .tool[aria-label="Orbit"]');
check("Orbit is available without a mouse", await ipad.$eval('.rail .tool[aria-label="Orbit"]', (x) => x.getAttribute("aria-pressed") === "true"));

const touch = await ipad.createCDPSession();
const canvasRect = await ipad.$eval("#view", (x) => {
  const r = x.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
});
const tx = canvasRect.x + canvasRect.width * 0.52;
const ty = canvasRect.y + canvasRect.height * 0.45;
await touch.send("Input.dispatchTouchEvent", {
  type: "touchStart",
  touchPoints: [{ x: tx - 35, y: ty, id: 1 }, { x: tx + 35, y: ty, id: 2 }],
});
await touch.send("Input.dispatchTouchEvent", {
  type: "touchMove",
  touchPoints: [{ x: tx - 55, y: ty + 18, id: 1 }, { x: tx + 55, y: ty + 18, id: 2 }],
});
check("two-finger pan and pinch gesture is recognized", await ipad.$eval("#status", (x) => x.textContent.includes("two fingers")));
await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });

await ipad.screenshot({ path: "tools/ipad-landscape.png" });
await ipad.setViewport({ width: 768, height: 1024, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await sleep(500);
const portrait = await tabletLayout();
check("iPad portrait keeps the canvas and controls usable", portrait.noHorizontalOverflow && portrait.overlaysInside && portrait.touchTargets, JSON.stringify(portrait));
await ipad.tap("#panel-toggle");
check("the inspector opens as a tablet drawer", await ipad.$eval("#panel", (x) => x.classList.contains("open")));
await ipad.screenshot({ path: "tools/ipad-portrait.png" });
await ipad.close();

if (problems.length) {
  console.log("\nconsole problems:");
  for (const p of [...new Set(problems)]) console.log("  ", p);
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
await browser.close();
process.exit(failed.length ? 1 : 0);
