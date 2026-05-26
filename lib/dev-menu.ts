export interface DevMenuModule {
  addDevMenuItems?: (items: Record<string, () => void>) => void;
}

/**
 * A DevMenu action can be either a bare `() => void` (in which case the
 * action's *key* in the action map doubles as the DevMenu label) or an
 * `{ label, run }` pair where `label` is the user-facing string surfaced
 * by `addDevMenuItems` and `run` is the side-effect to fire. The
 * `globalThis.__<name>` helper always uses the action's *key*, so the
 * existing console-fallback contract is unchanged.
 */
export type DevMenuAction = (() => void) | { label: string; run: () => void };

export interface RegisterDevMenuOptions {
  isDev: boolean;
  globalScope?: Record<string, unknown> | null;
  devMenu?: DevMenuModule | null;
  actions: Record<string, DevMenuAction>;
  globalPrefix?: string;
}

export interface RegisterDevMenuResult {
  devMenuRegistered: boolean;
  globalsAttached: string[];
}

function resolveAction(action: DevMenuAction): { label: string | null; run: () => void } {
  if (typeof action === "function") return { label: null, run: action };
  return { label: action.label, run: action.run };
}

export function registerDevMenu(options: RegisterDevMenuOptions): RegisterDevMenuResult {
  const { isDev, globalScope, devMenu, actions, globalPrefix = "__" } = options;
  if (!isDev) return { devMenuRegistered: false, globalsAttached: [] };

  let devMenuRegistered = false;
  if (devMenu && typeof devMenu.addDevMenuItems === "function") {
    const items: Record<string, () => void> = {};
    for (const [name, action] of Object.entries(actions)) {
      const { label, run } = resolveAction(action);
      items[label ?? name] = run;
    }
    try {
      devMenu.addDevMenuItems(items);
      devMenuRegistered = true;
    } catch {
      // expo-dev-menu may be installed but not active at runtime; ignore.
    }
  }

  const globalsAttached: string[] = [];
  if (globalScope) {
    for (const [name, action] of Object.entries(actions)) {
      const { run } = resolveAction(action);
      const key = `${globalPrefix}${name}`;
      globalScope[key] = run;
      globalsAttached.push(key);
    }
  }

  return { devMenuRegistered, globalsAttached };
}

export function isDevEnvironment(): boolean {
  // `__DEV__` is declared globally in `types/globals.d.ts` (injected by
  // Metro / React Native at bundle time). Guard with `typeof` so unit tests
  // running under plain Node (where Metro hasn't defined it) still resolve.
  return typeof __DEV__ === "boolean" ? __DEV__ : false;
}

/**
 * Shape of the real `expo-dev-menu` package: a `registerDevMenuItems(items)`
 * function where each item is `{ name, callback, shouldCollapse? }`. We adapt
 * it to the simpler `{ addDevMenuItems(Record<string, () => void>) }` shape
 * consumed by `registerDevMenu` so the existing call sites are unchanged.
 */
export interface ExpoDevMenuPackage {
  registerDevMenuItems?: (
    items: Array<{ name: string; callback: () => void; shouldCollapse?: boolean }>,
  ) => unknown;
}

export function adaptExpoDevMenu(mod: ExpoDevMenuPackage | null | undefined): DevMenuModule | null {
  if (!mod || typeof mod.registerDevMenuItems !== "function") return null;
  const register = mod.registerDevMenuItems.bind(mod);
  return {
    addDevMenuItems(items) {
      const list = Object.entries(items).map(([name, callback]) => ({ name, callback }));
      register(list);
    },
  };
}

export function loadDevMenuModule(): DevMenuModule | null {
  try {
    const req = (globalThis as { require?: (id: string) => unknown }).require;
    if (typeof req !== "function") return null;
    const mod = req("expo-dev-menu") as ExpoDevMenuPackage & DevMenuModule;
    if (!mod) return null;
    // Prefer the legacy `addDevMenuItems` shape if a future SDK exposes it
    // directly; otherwise adapt the canonical `registerDevMenuItems` API.
    if (typeof mod.addDevMenuItems === "function") return mod;
    return adaptExpoDevMenu(mod);
  } catch {
    return null;
  }
}
