import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as React from "react";

/**
 * A dependency-free React render harness for `components/*.tsx`.
 *
 * ## Why this exists
 *
 * Every component assertion in this repo used to be a source-text scan
 * (`assert.match(src, /backgroundColor: CARD_BG_10/)`), because the test
 * runner is plain `tsx --test` with no DOM and no renderer. That was logged
 * repeatedly as blocked on "add jsdom or react-test-renderer" — but neither is
 * actually needed. Two things were in the way, and both are solvable in-repo:
 *
 * 1. **Module loading.** `react-native` ships Flow-typed source and
 *    `@expo/vector-icons` ships raw JSX in a `.js` file; esbuild refuses both,
 *    so importing anything under `components/` threw before a single line ran.
 *    `installNativeModuleStubs()` aliases those specifiers onto the plain
 *    `.mjs` stand-ins in `./stubs/` using Node's synchronous
 *    `module.registerHooks`.
 *
 * 2. **Hooks.** Calling a function component directly makes `useState` throw,
 *    because React's hook dispatcher is null outside a renderer. `render()`
 *    installs its own dispatcher into React's shared internals for the
 *    duration of the render pass, so the REAL `react` package's `useState` /
 *    `useMemo` / `useContext` route into the store below. Nothing is stubbed
 *    away: a component imports hooks from `"react"` exactly as it does in the
 *    app.
 *
 * ## What it is not
 *
 * This is a render harness, not a reconciler. There is no diffing, no commit
 * phase, no concurrent behaviour, no Suspense. Effects are queued and flushed
 * synchronously after the tree is built, and a `setState` marks the tree dirty
 * for the next explicit `rerender()`. It is enough to answer "what does this
 * component actually render, with these props" — which is the question the
 * source-text scans were approximating.
 *
 * `<StrictMode>` IS reproduced, because the bugs it exists to surface are
 * exactly the ones a source scan cannot see: inside a strict subtree each
 * component body runs twice per pass, and each effect is mounted, cleaned up
 * and mounted again. An effect that is not idempotent fails here the same way
 * it does in a dev build.
 *
 * ## Ordering constraint
 *
 * `installNativeModuleStubs()` must run BEFORE the module under test is
 * resolved. ESM resolves a file's entire static import graph before any of it
 * evaluates, so a test file CANNOT `import { ItemFilterBar } from
 * "@/components/item-filters"` at the top and expect the stubs to apply. Call
 * `installNativeModuleStubs()` at module scope and pull the component in with
 * a dynamic `await import(...)` inside the test.
 */

const STUB_DIR = path.join(process.cwd(), "__tests__", "helpers", "stubs");

/**
 * Specifier → stub file. Keyed by exact specifier: sub-path imports
 * (`react-native/Libraries/...`) are deliberately NOT matched, so a component
 * reaching into RN internals fails loudly instead of silently resolving to a
 * stub that does not have what it asked for.
 */
const STUBBED_MODULES: Readonly<Record<string, string>> = {
  "react-native": "react-native.mjs",
  "@expo/vector-icons": "expo-vector-icons.mjs",
  "@react-native-async-storage/async-storage": "async-storage.mjs",
};

/**
 * Per-test module doubles, registered with {@link mockModule}.
 *
 * A provider under test usually pulls in three or four sibling contexts
 * (`useAuth`, `usePremium`, …) whose real modules reach supabase and the
 * network — mounting the real thing to observe one effect would be testing the
 * whole app. Aliasing those specifiers onto plain objects keeps the component
 * under test real and everything around it inert.
 *
 * Held on `globalThis` because the synthesized module source has to reach them
 * from its own scope, which is not this module's.
 */
const MOCK_REGISTRY_KEY = "__renderHarnessModuleMocks__";

type MockRegistry = Record<string, Record<string, unknown>>;

function mockRegistry(): MockRegistry {
  const scope = globalThis as Record<string, unknown>;
  scope[MOCK_REGISTRY_KEY] ??= {};
  return scope[MOCK_REGISTRY_KEY] as MockRegistry;
}

const VALID_EXPORT_NAME = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Replaces a module for the rest of the process with the given exports.
 *
 * Call at module scope, before the dynamic `import()` of the code under test —
 * ESM caches a module the first time it is evaluated, so mocking a specifier
 * something has already loaded silently does nothing.
 *
 * Export values are read once, when the mocked module first evaluates. Pass
 * stable functions that close over mutable state (a spy that pushes into an
 * array, a hook that reads a `let` the test reassigns) rather than swapping the
 * exported value itself.
 */
export function mockModule(specifier: string, exports: Record<string, unknown>): void {
  for (const name of Object.keys(exports)) {
    if (name !== "default" && !VALID_EXPORT_NAME.test(name)) {
      throw new Error(`mockModule: "${name}" is not a valid export identifier`);
    }
  }
  mockRegistry()[specifier] = exports;
  mockUrls[specifier] = writeMockModule(specifier, exports);
}

/** specifier → `file:` URL of the generated `.mjs` shim. */
const mockUrls: Record<string, string> = {};

let mockDir: string | null = null;

/**
 * Mocks are written to a real `.mjs` file in a temp dir rather than served
 * from a `data:` URL or a synchronous `load` hook.
 *
 * A `load` hook is out because the synchronous chain has to return a source
 * for EVERY module it sees, which short-circuits the async tsx loader that
 * compiles this repo's TypeScript. A `data:` URL is out because that same tsx
 * loader treats the URL as a path and reports `ENOENT: … open
 * 'data:text/javascript;base64,…'`. A plain `.mjs` file needs no transform, so
 * it travels the whole chain untouched.
 */
function writeMockModule(specifier: string, exports: Record<string, unknown>): string {
  if (!mockDir) {
    mockDir = mkdtempSync(path.join(os.tmpdir(), "render-harness-mocks-"));
    const dir = mockDir;
    process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  }
  const named = Object.keys(exports).filter((name) => name !== "default");
  const lines = [
    `const mock = globalThis[${JSON.stringify(MOCK_REGISTRY_KEY)}][${JSON.stringify(specifier)}];`,
  ];
  if (named.length > 0) lines.push(`export const { ${named.join(", ")} } = mock;`);
  if ("default" in exports) lines.push(`export default mock.default;`);

  const file = path.join(mockDir, `${specifier.replace(/[^A-Za-z0-9]+/g, "_")}.mjs`);
  writeFileSync(file, `${lines.join("\n")}\n`, "utf8");
  return pathToFileURL(file).href;
}

let stubsInstalled = false;

/** Idempotent — safe to call from every test file that needs a render. */
export function installNativeModuleStubs(): void {
  if (stubsInstalled) return;
  stubsInstalled = true;
  installClassicJsxGlobal();
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const mocked = mockUrls[specifier];
      if (mocked) {
        return { url: mocked, shortCircuit: true };
      }
      const stub = STUBBED_MODULES[specifier];
      if (stub) {
        return { url: pathToFileURL(path.join(STUB_DIR, stub)).href, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
  });
}

/**
 * `expo/tsconfig.base` sets `"jsx": "react-native"`, which esbuild does not
 * recognise as an automatic-runtime mode, so it falls back to the CLASSIC
 * transform and emits bare `React.createElement(...)` / `React.Fragment` into
 * files that (correctly, for the automatic runtime Metro uses) never import
 * `React`. Under Metro/Babel this never happens; only the `tsx --test` path
 * sees it.
 *
 * Publishing `React` as a global satisfies those emitted references without
 * touching `tsconfig.json` — which is shared with the real app build and with
 * all 370 existing suites — and without a parallel test-only tsconfig that
 * would then have to be kept in sync. Nothing in `app/`, `components/` or
 * `lib/` reads a `React` global at runtime, so this cannot mask a missing
 * import in shipped code.
 */
function installClassicJsxGlobal(): void {
  const scope = globalThis as { React?: unknown };
  scope.React ??= React;
}

/** The list of aliased specifiers, exposed so a test can pin the contract. */
export function stubbedModuleSpecifiers(): string[] {
  return Object.keys(STUBBED_MODULES);
}

// ---------------------------------------------------------------------------
// Rendered tree
// ---------------------------------------------------------------------------

export type TestNode = {
  /** Host component name (`"View"`, `"Text"`, `"Ionicons"`) or `"#text"`. */
  type: string;
  props: Record<string, unknown>;
  children: TestNode[];
  /** Raw string/number content, set only on `#text` nodes. */
  text?: string;
};

const TEXT_NODE = "#text";

// ---------------------------------------------------------------------------
// Style helpers
// ---------------------------------------------------------------------------

type StyleLike = Record<string, unknown> | null | undefined | false | StyleLike[];

/**
 * Collapses RN's `style={[a, b && c]}` array form into one object, last write
 * winning — the same precedence the platform applies. Falsy entries (the
 * `cond && styles.x` idiom) drop out.
 */
export function flattenStyle(style: StyleLike): Record<string, unknown> {
  if (!style) return {};
  if (Array.isArray(style)) {
    return style.reduce<Record<string, unknown>>(
      (acc, entry) => Object.assign(acc, flattenStyle(entry)),
      {},
    );
  }
  return style as Record<string, unknown>;
}

/** `flattenStyle` on a node's own `style` prop. */
export function styleOf(node: TestNode): Record<string, unknown> {
  return flattenStyle(node.props.style as StyleLike);
}

// ---------------------------------------------------------------------------
// Hook dispatcher
// ---------------------------------------------------------------------------

type HookCell = { value: unknown; deps?: unknown[] };
type Instance = { hooks: HookCell[] };

type EffectFn = () => void | (() => void);

/**
 * One queued effect, carrying enough to replay it. `strict` marks effects
 * queued inside a `<StrictMode>` subtree, which React dev-mode mounts, tears
 * down and mounts again — the double-invoke this harness reproduces.
 */
type QueuedEffect = {
  effect: EffectFn;
  cell: HookCell;
  strict: boolean;
  mount: () => void;
  cleanup: () => void;
};

const REACT_INTERNALS = (
  React as unknown as {
    __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: { H: unknown };
  }
).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

function depsChanged(previous: unknown[] | undefined, next: unknown[] | undefined): boolean {
  if (!previous || !next) return true;
  if (previous.length !== next.length) return true;
  return previous.some((entry, index) => !Object.is(entry, next[index]));
}

class RenderPass {
  /**
   * Hook cells keyed by tree path, so state survives a `rerender()` as long as
   * the tree shape is stable. A conditional branch that swaps one component
   * for another at the same path resets that subtree's state — the same thing
   * React does, arrived at by a much blunter route.
   */
  readonly instances = new Map<string, Instance>();
  readonly contextStack = new Map<unknown, unknown[]>();
  effects: QueuedEffect[] = [];
  dirty = false;

  private current: Instance | null = null;
  private hookIndex = 0;
  private idCounter = 0;

  private cell(initialise: () => unknown): HookCell {
    const instance = this.current;
    if (!instance) throw new Error("hook called outside of a component render");
    const index = this.hookIndex++;
    let cell = instance.hooks[index];
    if (!cell) {
      cell = { value: initialise() };
      instance.hooks[index] = cell;
    }
    return cell;
  }

  private readonly dispatcher = {
    useState: (initial: unknown) => {
      const cell = this.cell(() => (typeof initial === "function" ? initial() : initial));
      const setState = (next: unknown) => {
        const resolved = typeof next === "function" ? (next as (p: unknown) => unknown)(cell.value) : next;
        if (Object.is(resolved, cell.value)) return;
        cell.value = resolved;
        this.dirty = true;
      };
      return [cell.value, setState];
    },
    useReducer: (reducer: (s: unknown, a: unknown) => unknown, initialArg: unknown, init?: (a: unknown) => unknown) => {
      const cell = this.cell(() => (init ? init(initialArg) : initialArg));
      const dispatch = (action: unknown) => {
        const next = reducer(cell.value, action);
        if (Object.is(next, cell.value)) return;
        cell.value = next;
        this.dirty = true;
      };
      return [cell.value, dispatch];
    },
    useMemo: (factory: () => unknown, deps?: unknown[]) => {
      const cell = this.cell(() => undefined);
      if (!("deps" in cell) || depsChanged(cell.deps, deps)) {
        cell.value = factory();
        cell.deps = deps ?? [];
      }
      return cell.value;
    },
    useCallback: (callback: unknown, deps?: unknown[]) => {
      const cell = this.cell(() => undefined);
      if (!("deps" in cell) || depsChanged(cell.deps, deps)) {
        cell.value = callback;
        cell.deps = deps ?? [];
      }
      return cell.value;
    },
    useRef: (initial: unknown) => this.cell(() => ({ current: initial })).value,
    useContext: (context: unknown) => this.readContext(context),
    useEffect: (effect: EffectFn, deps?: unknown[]) => {
      const cell = this.cell(() => undefined);
      if (!("deps" in cell) || depsChanged(cell.deps, deps)) {
        cell.deps = deps ?? [];
        this.queueEffect(effect, cell);
      }
    },
    useLayoutEffect: (effect: EffectFn, deps?: unknown[]) => {
      this.dispatcher.useEffect(effect, deps);
    },
    useInsertionEffect: () => {},
    useImperativeHandle: () => {},
    useDebugValue: () => {},
    useId: () => `:r${this.idCounter++}:`,
    useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
    useDeferredValue: (value: unknown) => value,
    useTransition: () => [false, (scope: () => void) => scope()],
    useOptimistic: (passthrough: unknown) => [passthrough, () => {}],
  };

  /**
   * Depth of `<StrictMode>` wrappers around whatever is currently rendering.
   * Non-zero means: invoke this component's body twice per pass, and mount →
   * clean up → mount its effects, exactly as React does in dev.
   */
  strictDepth = 0;

  private queueEffect(effect: EffectFn, cell: HookCell): void {
    const queued: QueuedEffect = {
      effect,
      cell,
      strict: this.strictDepth > 0,
      mount: () => {
        const cleanup = effect();
        cell.value = typeof cleanup === "function" ? cleanup : undefined;
      },
      cleanup: () => {
        if (typeof cell.value === "function") (cell.value as () => void)();
        cell.value = undefined;
      },
    };
    // A dep change re-runs the effect, so the previous cleanup must fire first
    // — a subscription that never unsubscribes is the classic leak this guards.
    queued.cleanup();
    this.effects.push(queued);
  }

  readContext(context: unknown): unknown {
    const stack = this.contextStack.get(context);
    if (stack && stack.length > 0) return stack[stack.length - 1];
    return (context as { _currentValue?: unknown })._currentValue;
  }

  runComponent(component: (props: unknown) => unknown, props: unknown, key: string): unknown {
    let instance = this.instances.get(key);
    if (!instance) {
      instance = { hooks: [] };
      this.instances.set(key, instance);
    }
    const previousInstance = this.current;
    const previousIndex = this.hookIndex;
    const previousDispatcher = REACT_INTERNALS.H;
    this.current = instance;
    this.hookIndex = 0;
    REACT_INTERNALS.H = this.dispatcher;
    try {
      // StrictMode invokes the body twice per pass to surface render-phase side
      // effects. The hook cursor MUST rewind between the two calls — cells are
      // addressed by call order, so a second pass starting at index N would
      // allocate a fresh set and hand the component a brand-new `useRef`,
      // exactly the state-identity bug StrictMode exists to catch. With the
      // rewind, the second call reuses every cell and re-queues no effect:
      // two renders, one commit, same as React.
      if (this.strictDepth > 0) {
        component(props);
        this.hookIndex = 0;
      }
      return component(props);
    } finally {
      REACT_INTERNALS.H = previousDispatcher;
      this.current = previousInstance;
      this.hookIndex = previousIndex;
    }
  }
}

// ---------------------------------------------------------------------------
// Element walking
// ---------------------------------------------------------------------------

const STRICT_MODE_TYPE = Symbol.for("react.strict_mode");
const MEMO_TYPE = Symbol.for("react.memo");
const FORWARD_REF_TYPE = Symbol.for("react.forward_ref");
const FRAGMENT_TYPE = Symbol.for("react.fragment");
const PROVIDER_TYPE = Symbol.for("react.provider");
const CONTEXT_TYPE = Symbol.for("react.context");

type AnyElement = {
  type: unknown;
  props: Record<string, unknown>;
  key?: string | null;
};

/**
 * React 19 tags elements with `react.transitional.element`; 18 and earlier used
 * `react.element`. Both are accepted so the harness survives the version bump
 * either way round.
 */
const ELEMENT_TYPES = new Set<symbol>([
  Symbol.for("react.transitional.element"),
  Symbol.for("react.element"),
]);

function isElement(value: unknown): value is AnyElement {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    "props" in value &&
    ELEMENT_TYPES.has((value as { $$typeof?: symbol }).$$typeof as symbol)
  );
}

function typeName(type: unknown): string {
  if (typeof type === "string") return type;
  if (typeof type === "function") return (type as { name?: string }).name || "Anonymous";
  if (type && typeof type === "object") {
    const inner = (type as { type?: unknown; render?: unknown }).type;
    if (inner) return typeName(inner);
    const render = (type as { render?: unknown }).render;
    if (render) return typeName(render);
  }
  return "Unknown";
}

function renderNode(pass: RenderPass, node: unknown, keyPath: string): TestNode[] {
  if (node === null || node === undefined || typeof node === "boolean") return [];

  if (typeof node === "string" || typeof node === "number") {
    return [{ type: TEXT_NODE, props: {}, children: [], text: String(node) }];
  }

  if (Array.isArray(node)) {
    return node.flatMap((entry, index) => {
      const childKey = isElement(entry) && entry.key != null ? `k${entry.key}` : `i${index}`;
      return renderNode(pass, entry, `${keyPath}/${childKey}`);
    });
  }

  if (!isElement(node)) return [];

  const { type, props } = node;

  if (type === FRAGMENT_TYPE) {
    return renderNode(pass, props.children, `${keyPath}/frag`);
  }

  if (type === STRICT_MODE_TYPE) {
    pass.strictDepth += 1;
    try {
      return renderNode(pass, props.children, `${keyPath}/strict`);
    } finally {
      pass.strictDepth -= 1;
    }
  }

  if (typeof type === "function") {
    const path = `${keyPath}/${typeName(type)}`;
    return renderNode(pass, pass.runComponent(type as (p: unknown) => unknown, props, path), path);
  }

  if (typeof type === "object" && type !== null) {
    const marker = (type as { $$typeof?: symbol }).$$typeof;

    if (marker === MEMO_TYPE) {
      const inner = (type as { type: unknown }).type;
      return renderNode(pass, { ...node, type: inner }, keyPath);
    }

    if (marker === FORWARD_REF_TYPE) {
      const render = (type as { render: (p: unknown, ref: unknown) => unknown }).render;
      const path = `${keyPath}/${typeName(type)}`;
      const { ref, ...rest } = props as { ref?: unknown };
      return renderNode(
        pass,
        pass.runComponent((p) => render(p, ref ?? null), rest, path),
        path,
      );
    }

    // React 19 lets `<Context>` stand in for `<Context.Provider>`, so a
    // provider element's type is either the context itself (`react.context`)
    // or the legacy provider wrapper holding `_context`.
    if (marker === CONTEXT_TYPE || marker === PROVIDER_TYPE) {
      const context = marker === PROVIDER_TYPE ? (type as { _context: unknown })._context : type;
      const stack = pass.contextStack.get(context) ?? [];
      stack.push(props.value);
      pass.contextStack.set(context, stack);
      try {
        return renderNode(pass, props.children, `${keyPath}/provider`);
      } finally {
        stack.pop();
      }
    }
  }

  // Host element — our react-native / vector-icons stubs make `type` a string.
  const { children, ...rest } = props;
  const host = typeName(type);

  // A closed `<Modal>` mounts nothing on any platform. Walking into its
  // children anyway would put the whole filter sheet — a second Reset button,
  // a second search row, every sort chip — into the tree of a component whose
  // sheet is shut, and a query for "the reset chip" would match the wrong one.
  const hidden = host === "Modal" && rest.visible === false;

  return [
    {
      type: host,
      props: rest,
      children: hidden ? [] : renderNode(pass, children, `${keyPath}/${host}`),
    },
  ];
}

// ---------------------------------------------------------------------------
// Public render API
// ---------------------------------------------------------------------------

export type RenderResult = {
  /** Synthetic root; its `children` are what the element rendered to. */
  root: TestNode;
  /** Every node in the tree, root first, depth-first. */
  all(): TestNode[];
  /** Depth-first search; throws when nothing matches. */
  find(predicate: (node: TestNode) => boolean): TestNode;
  findAll(predicate: (node: TestNode) => boolean): TestNode[];
  findByType(type: string): TestNode;
  findAllByType(type: string): TestNode[];
  /** All `#text` content in document order — the "what does it say" view. */
  texts(): string[];
  /** Fires a node's `onPress` and re-renders if it changed state. */
  press(node: TestNode): void;
  /** Re-runs the tree with hook state preserved. */
  rerender(next?: React.ReactElement): RenderResult;
};

function collect(node: TestNode, into: TestNode[]): TestNode[] {
  into.push(node);
  for (const child of node.children) collect(child, into);
  return into;
}

function describeNode(node: TestNode): string {
  return node.type === TEXT_NODE ? `"${node.text}"` : `<${node.type}>`;
}

/**
 * Renders an element tree once and returns queryable output.
 *
 * Effects queued during the pass are flushed synchronously before returning,
 * and if one of them set state the tree is re-rendered — a mount effect that
 * hydrates from storage therefore lands in the returned tree the same way it
 * does after a real mount, provided it resolved synchronously.
 */
export function render(element: React.ReactElement): RenderResult {
  const pass = new RenderPass();

  function build(current: React.ReactElement): TestNode {
    pass.effects = [];
    pass.dirty = false;
    const children = renderNode(pass, current, "root");
    const queued = pass.effects;
    pass.effects = [];
    for (const queuedEffect of queued) queuedEffect.mount();
    // React's StrictMode remount: every effect inside a <StrictMode> subtree is
    // torn down and set up again immediately after the first commit. This is
    // the pass that catches an effect which is not idempotent — a duplicated
    // subscription, a second analytics identify, a doubled network call.
    const strict = queued.filter((queuedEffect) => queuedEffect.strict);
    for (const queuedEffect of strict) queuedEffect.cleanup();
    for (const queuedEffect of strict) queuedEffect.mount();
    return { type: "#root", props: {}, children };
  }

  let currentElement = element;
  let root = build(currentElement);
  if (pass.dirty) root = build(currentElement);

  const result: RenderResult = {
    get root() {
      return root;
    },
    all: () => collect(root, []).slice(1),
    findAll: (predicate) => result.all().filter(predicate),
    find: (predicate) => {
      const hit = result.all().find(predicate);
      if (!hit) {
        throw new Error(
          `no node matched the predicate; tree was ${result
            .all()
            .map(describeNode)
            .join(" ")}`,
        );
      }
      return hit;
    },
    findAllByType: (type) => result.findAll((node) => node.type === type),
    findByType: (type) => {
      const hits = result.findAllByType(type);
      if (hits.length === 0) throw new Error(`no <${type}> in the rendered tree`);
      return hits[0];
    },
    texts: () =>
      result
        .all()
        .filter((node) => node.type === TEXT_NODE)
        .map((node) => node.text ?? ""),
    press: (node) => {
      const onPress = node.props.onPress;
      if (typeof onPress !== "function") {
        throw new Error(`${describeNode(node)} has no onPress`);
      }
      (onPress as () => void)();
      if (pass.dirty) root = build(currentElement);
    },
    rerender: (next) => {
      if (next) currentElement = next;
      root = build(currentElement);
      return result;
    },
  };

  return result;
}
