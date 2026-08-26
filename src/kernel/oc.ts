/**
 * OCCT handle typing.
 *
 * opencascade.js ships full .d.ts, but its embind enum members are typed as the
 * bare `{}` shape while every consuming signature wants the *whole* enum object
 * -- so `oc.TopAbs_ShapeEnum.TopAbs_FACE` needs an `as unknown as T` cast at
 * literally every call site. That noise buys nothing: the real safety net for
 * kernel code is the kernel test suite in tests/, which runs the actual WASM.
 * So the instance is typed loosely here and exercised for real by the tests.
 */
export type OC = any;

/** Any TopoDS_Shape. */
export type Shape = any;

/**
 * Deletion scope. OCCT objects are WASM heap allocations; builders in
 * particular are large. Register temporaries with `t()` and call `free()` when
 * the operation is done. Shapes that escape the scope must NOT be registered.
 */
export class Scope {
  private items: { delete(): void }[] = [];

  t<T>(o: T): T {
    if (o && typeof (o as { delete?: unknown }).delete === "function") {
      this.items.push(o as unknown as { delete(): void });
    }
    return o;
  }

  free(): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      try {
        this.items[i]!.delete();
      } catch {
        /* already gone */
      }
    }
    this.items.length = 0;
  }
}

export function withScope<T>(fn: (s: Scope) => T): T {
  const s = new Scope();
  try {
    return fn(s);
  } finally {
    s.free();
  }
}
