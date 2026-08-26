import type { SubRef } from "../core/types.ts";

/**
 * SPEC §5 / §8 -- one source of truth for capability.
 * The LLM prompt, the validator, the executor and the capabilities UI are all
 * generated from these definitions. Adding a def file and registering it is the
 * only step needed for the model to gain the ability.
 */

export type ParamType =
  | "stroke"
  | "strokes"
  | "solid"
  | "solids"
  | "subref"
  | "node"
  | "number"
  | "int"
  | "bool"
  | "enum"
  | "text"
  | "plane"
  | "params";

export interface ParamDef {
  name: string;
  type: ParamType;
  doc: string;
  required?: boolean;
  default?: unknown;
  min?: number;
  max?: number;
  values?: readonly string[];
  /** for subref params: which kind of sub-object the op consumes */
  subKind?: "face" | "edges";
  /** for strokes[]: minimum count */
  minItems?: number;
  maxLength?: number;
}

export type OpGroup = "create" | "modify" | "organize";

export interface OpExample {
  params: Record<string, unknown>;
  note?: string;
}

export interface OpDef {
  name: string;
  group: OpGroup;
  /** one line, shown in the prompt and the capabilities drawer */
  summary: string;
  params: ParamDef[];
  /** human-readable preconditions, surfaced in the prompt */
  preconditions?: string;
  /** "solid" produces one new solid; "replace" consumes its first solid input */
  produces: "solid" | "solids" | "replace" | "none";
  /** every example must validate and must build non-empty geometry (tests 6-9) */
  examples: OpExample[];
}

const REGISTRY = new Map<string, OpDef>();

export function register(def: OpDef): OpDef {
  if (REGISTRY.has(def.name)) throw new Error(`op "${def.name}" registered twice`);
  REGISTRY.set(def.name, def);
  return def;
}

export function catalog(): OpDef[] {
  return [...REGISTRY.values()];
}

export function opDef(name: string): OpDef | undefined {
  return REGISTRY.get(name);
}

export function opNames(): string[] {
  return [...REGISTRY.keys()];
}

/* -------------------------------------------------------------------------- */
/* validation                                                                  */
/* -------------------------------------------------------------------------- */

/** What the validator is allowed to know about the scene. */
export interface ValidationScene {
  strokeIds: Set<string>;
  closedStrokes: Set<string>;
  solidIds: Set<string>;
  nodeIds: Set<string>;
  /** op name of each node, so `edit` can validate its `set` payload */
  nodeOps: Map<string, string>;
}

export function emptyScene(): ValidationScene {
  return {
    strokeIds: new Set(),
    closedStrokes: new Set(),
    solidIds: new Set(),
    nodeIds: new Set(),
    nodeOps: new Map(),
  };
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  /** params with defaults filled in */
  params: Record<string, unknown>;
}

const SELECTOR_GRAMMAR =
  /^(top|bottom|largest|smallest|vertical|horizontal|top-cap|bottom-cap|all|index\s+\d+|facing\s+[+-][xyz](\s+\d+(\.\d+)?)?|longest\s+\d+|shortest\s+\d+|of\s+face\s+.+)$/;

export function isValidSelector(sel: unknown): sel is string {
  return typeof sel === "string" && SELECTOR_GRAMMAR.test(sel.trim().toLowerCase());
}

function checkSubRef(v: unknown, def: ParamDef, scene: ValidationScene, errors: string[]): void {
  if (typeof v !== "object" || v === null) {
    errors.push(`${def.name} must be {solid, kind, select}`);
    return;
  }
  const r = v as Partial<SubRef>;
  if (typeof r.solid !== "string" || !scene.solidIds.has(r.solid)) {
    errors.push(`${def.name}.solid "${String(r.solid)}" is not an existing solid`);
  }
  const wantKind = def.subKind;
  if (r.kind !== "face" && r.kind !== "edges") {
    errors.push(`${def.name}.kind must be "face" or "edges"`);
  } else if (wantKind && r.kind !== wantKind) {
    errors.push(`${def.name}.kind must be "${wantKind}" for this op`);
  }
  if (!isValidSelector(r.select)) {
    errors.push(`${def.name}.select "${String(r.select)}" is not in the selector grammar`);
  }
}

function checkOne(v: unknown, def: ParamDef, scene: ValidationScene, errors: string[]): void {
  switch (def.type) {
    case "stroke":
      if (typeof v !== "string" || !scene.strokeIds.has(v)) {
        errors.push(`${def.name} "${String(v)}" is not an existing stroke`);
      }
      break;
    case "strokes": {
      if (!Array.isArray(v)) {
        errors.push(`${def.name} must be an array of stroke ids`);
        break;
      }
      const min = def.minItems ?? 1;
      if (v.length < min) errors.push(`${def.name} needs at least ${min} strokes`);
      for (const s of v) {
        if (typeof s !== "string" || !scene.strokeIds.has(s)) {
          errors.push(`${def.name} contains "${String(s)}", which is not an existing stroke`);
        }
      }
      break;
    }
    case "solid":
      if (typeof v !== "string" || !scene.solidIds.has(v)) {
        errors.push(`${def.name} "${String(v)}" is not an existing solid`);
      }
      break;
    case "solids":
      if (!Array.isArray(v) || v.some((s) => typeof s !== "string" || !scene.solidIds.has(s))) {
        errors.push(`${def.name} must be an array of existing solid ids`);
      }
      break;
    case "node":
      if (typeof v !== "string" || !scene.nodeIds.has(v)) {
        errors.push(`${def.name} "${String(v)}" is not an existing history node`);
      }
      break;
    case "subref":
      checkSubRef(v, def, scene, errors);
      break;
    case "number":
    case "int": {
      if (typeof v !== "number" || !Number.isFinite(v)) {
        errors.push(`${def.name} must be a number`);
        break;
      }
      if (def.type === "int" && !Number.isInteger(v)) errors.push(`${def.name} must be a whole number`);
      if (def.min !== undefined && v < def.min) errors.push(`${def.name} must be >= ${def.min}`);
      if (def.max !== undefined && v > def.max) errors.push(`${def.name} must be <= ${def.max}`);
      break;
    }
    case "bool":
      if (typeof v !== "boolean") errors.push(`${def.name} must be true or false`);
      break;
    case "enum":
      if (typeof v !== "string" || !def.values?.includes(v)) {
        errors.push(`${def.name} must be one of ${def.values?.join(" | ")}`);
      }
      break;
    case "plane":
      if (v !== "ground" && v !== "front" && v !== "side") {
        errors.push(`${def.name} must be ground | front | side`);
      }
      break;
    case "text":
      if (typeof v !== "string") errors.push(`${def.name} must be text`);
      else if (def.maxLength && v.length > def.maxLength) {
        errors.push(`${def.name} must be at most ${def.maxLength} characters`);
      }
      break;
    case "params":
      if (typeof v !== "object" || v === null || Array.isArray(v)) {
        errors.push(`${def.name} must be an object of {param: value}`);
      }
      break;
  }
}

export function validateOp(
  op: { op?: unknown; params?: unknown } & Record<string, unknown>,
  scene: ValidationScene,
): ValidationResult {
  const errors: string[] = [];
  const name = typeof op.op === "string" ? op.op : "";
  const def = REGISTRY.get(name);
  if (!def) {
    return { ok: false, errors: [`unknown op "${name}"`], params: {} };
  }
  const raw = (op.params ?? {}) as Record<string, unknown>;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: [`${name}: params must be an object`], params: {} };
  }
  const params: Record<string, unknown> = {};
  const known = new Set(def.params.map((p) => p.name));
  for (const key of Object.keys(raw)) {
    if (!known.has(key)) errors.push(`${name}: unknown param "${key}"`);
  }
  for (const p of def.params) {
    const has = Object.prototype.hasOwnProperty.call(raw, p.name);
    let v = has ? raw[p.name] : p.default;
    if (v === undefined || v === null) {
      if (p.required) errors.push(`${name}: missing required param "${p.name}"`);
      continue;
    }
    checkOne(v, p, scene, errors);
    if (p.type === "number" || p.type === "int") v = Number(v);
    params[p.name] = v;
  }

  // `edit` is validated against the *target* op's ParamDefs (SPEC §8.1).
  if (name === "edit" && typeof params.node === "string") {
    const targetOp = scene.nodeOps.get(params.node);
    const target = targetOp ? REGISTRY.get(targetOp) : undefined;
    const set = (params.set ?? {}) as Record<string, unknown>;
    if (!target) {
      errors.push(`edit: node ${params.node} has no known op`);
    } else if (Object.keys(set).length === 0) {
      errors.push(`edit: "set" must change at least one param`);
    } else {
      for (const [k, v] of Object.entries(set)) {
        const pd = target.params.find((p) => p.name === k);
        if (!pd) {
          errors.push(`edit: ${targetOp} has no param "${k}"`);
          continue;
        }
        checkOne(v, pd, scene, errors);
      }
    }
  }

  return { ok: errors.length === 0, errors, params };
}

/* -------------------------------------------------------------------------- */
/* generated surfaces                                                          */
/* -------------------------------------------------------------------------- */

function paramSig(p: ParamDef): string {
  const bits: string[] = [p.name];
  bits.push(`:${p.type === "int" ? "int" : p.type}`);
  if (p.values) bits.push(`(${p.values.join("|")})`);
  if (p.min !== undefined || p.max !== undefined) {
    bits.push(`[${p.min ?? "-inf"}..${p.max ?? "inf"}]`);
  }
  if (!p.required) bits.push(p.default === undefined ? "?" : `=${JSON.stringify(p.default)}`);
  return bits.join("");
}

/** Compact op catalogue for the system prompt. Budgeted at ~3,000 tokens. */
export function promptCatalog(): string {
  const groups: OpGroup[] = ["create", "modify", "organize"];
  const lines: string[] = [];
  for (const g of groups) {
    const defs = catalog().filter((d) => d.group === g);
    if (!defs.length) continue;
    lines.push(`## ${g.toUpperCase()}`);
    for (const d of defs) {
      lines.push(`${d.name}(${d.params.map(paramSig).join(", ")})`);
      lines.push(`  ${d.summary}${d.preconditions ? ` | requires: ${d.preconditions}` : ""}`);
      const ex = d.examples[0];
      if (ex) lines.push(`  e.g. {"op":"${d.name}","params":${JSON.stringify(ex.params)}}`);
    }
  }
  return lines.join("\n");
}

/** Machine-readable capability list -- also what the Capabilities drawer renders. */
export function capabilities(): {
  ops: { name: string; group: OpGroup; summary: string; params: ParamDef[]; preconditions?: string }[];
  selectors: string[];
} {
  return {
    ops: catalog().map((d) => ({
      name: d.name,
      group: d.group,
      summary: d.summary,
      params: d.params,
      preconditions: d.preconditions,
    })),
    selectors: SELECTOR_DOC,
  };
}

/** SPEC §7 grammar, implemented in kernel/selectors.ts. */
export const SELECTOR_DOC = [
  "top",
  "bottom",
  "largest",
  "smallest",
  "facing +x | -x | +y | -y | +z | -z [tol-degrees]",
  "vertical",
  "horizontal",
  "longest N",
  "shortest N",
  "top-cap",
  "bottom-cap",
  "of face <selector>",
  "index N",
  "all",
];

export function selectorGrammarPrompt(): string {
  return [
    "Sub-object selectors are declarative queries resolved fresh at every",
    'evaluation. Shape: {"solid":"B2","kind":"face"|"edges","select":"<query>"}.',
    "Valid queries:",
    ...SELECTOR_DOC.map((s) => `  ${s}`),
  ].join("\n");
}
