import initOpenCascade from "opencascade.js/dist/node.js";
import type { OC } from "../src/kernel/oc.ts";

let cached: Promise<OC> | null = null;

/** One OCCT instance per test worker; init is ~10 s cold. */
export function occt(): Promise<OC> {
  if (!cached) cached = initOpenCascade() as Promise<OC>;
  return cached;
}
