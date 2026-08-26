/**
 * Serves dist/, runs the browser smoke test against it, then shuts the server
 * down again. `npm run smoke`.
 */
import { spawn } from "node:child_process";
import { once } from "node:events";
import { preview } from "vite";

const PORT = 4173;
const server = await preview({ preview: { port: PORT, strictPort: true, open: false } });

const smoke = spawn(process.execPath, ["tools/smoke.mjs", `http://localhost:${PORT}/`], {
  stdio: "inherit",
});
const [code] = await once(smoke, "exit");

await server.close();
process.exit(code ?? 1);
