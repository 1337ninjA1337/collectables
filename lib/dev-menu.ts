export interface DevMenuModule {
  addDevMenuItems?: (items: Record<string, () => void>) => void;
}

export interface RegisterDevMenuOptions {
  isDev: boolean;
  globalScope?: Record<string, unknown> | null;
  devMenu?: DevMenuModule | null;
  actions: Record<string, () => void>;
  globalPrefix?: string;
}

export interface RegisterDevMenuResult {
  devMenuRegistered: boolean;
  globalsAttached: string[];
}

export function registerDevMenu(options: RegisterDevMenuOptions): RegisterDevMenuResult {
  const { isDev, globalScope, devMenu, actions, globalPrefix = "__" } = options;
  if (!isDev) return { devMenuRegistered: false, globalsAttached: [] };

  let devMenuRegistered = false;
  if (devMenu && typeof devMenu.addDevMenuItems === "function") {
    try {
      devMenu.addDevMenuItems(actions);
      devMenuRegistered = true;
    } catch {
      // expo-dev-menu may be installed but not active at runtime; ignore.
    }
  }

  const globalsAttached: string[] = [];
  if (globalScope) {
    for (const [name, fn] of Object.entries(actions)) {
      const key = `${globalPrefix}${name}`;
      globalScope[key] = fn;
      globalsAttached.push(key);
    }
  }

  return { devMenuRegistered, globalsAttached };
}

export function isDevEnvironment(): boolean {
  const flag = (globalThis as { __DEV__?: boolean }).__DEV__;
  return typeof flag === "boolean" ? flag : false;
}

export function loadDevMenuModule(): DevMenuModule | null {
  try {
    const req = (globalThis as { require?: (id: string) => unknown }).require;
    if (typeof req !== "function") return null;
    const mod = req("expo-dev-menu") as DevMenuModule;
    return mod ?? null;
  } catch {
    return null;
  }
}
