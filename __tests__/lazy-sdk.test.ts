import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { makeLazyLoader } from "../lib/lazy-sdk";

describe("makeLazyLoader", () => {
  it("imports the module once and memoises the picked export", async () => {
    let imports = 0;
    const load = makeLazyLoader(
      async () => {
        imports += 1;
        return { default: "sdk" };
      },
      (mod) => mod.default,
    );
    assert.equal(await load(), "sdk");
    assert.equal(await load(), "sdk");
    assert.equal(imports, 1);
  });

  it("shares one in-flight import across concurrent callers", async () => {
    let imports = 0;
    let release: (v: { name: string }) => void = () => {};
    const gate = new Promise<{ name: string }>((resolve) => {
      release = resolve;
    });
    const load = makeLazyLoader(
      () => {
        imports += 1;
        return gate;
      },
      (mod) => mod.name,
    );
    const [a, b] = [load(), load()];
    release({ name: "shared" });
    assert.equal(await a, "shared");
    assert.equal(await b, "shared");
    assert.equal(imports, 1);
  });

  it("applies pickExport to unwrap default/named export shapes", async () => {
    const load = makeLazyLoader(
      async () => ({ default: undefined, PostHog: "named-ctor" }),
      (mod) => mod.default ?? mod.PostHog,
    );
    assert.equal(await load(), "named-ctor");
  });

  it("does not cache a failed import — the next call retries", async () => {
    let attempts = 0;
    const load = makeLazyLoader(
      async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("bridge racing startup");
        return { default: "recovered" };
      },
      (mod) => mod.default,
    );
    await assert.rejects(load(), /bridge racing startup/);
    assert.equal(await load(), "recovered");
    assert.equal(attempts, 2);
  });

  it("propagates a pickExport failure without caching it", async () => {
    let picks = 0;
    const load = makeLazyLoader(
      async () => ({ default: "sdk" }),
      (mod) => {
        picks += 1;
        if (picks === 1) throw new Error("bad export shape");
        return mod.default;
      },
    );
    await assert.rejects(load(), /bad export shape/);
    assert.equal(await load(), "sdk");
  });
});
