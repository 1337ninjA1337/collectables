/**
 * Node-loadable stand-in for the `react-native` package.
 *
 * The real package ships Flow-typed source that esbuild (and therefore `tsx
 * --test`) refuses to transform, which is why every component test in this
 * repo has historically been a source-text scan rather than a real render.
 * `__tests__/helpers/render.ts` aliases the specifier onto this file with
 * `module.registerHooks`, so a test can import a `components/*.tsx` module and
 * actually call it.
 *
 * Host components are plain strings — exactly how React models a host element
 * — so a rendered tree node's `type` reads back as `"View"` / `"Text"` /
 * `"Pressable"` and can be matched by name.
 *
 * `StyleSheet.create` is the identity function (the real one returns opaque
 * registry handles on native, but returns the objects themselves on web and
 * in modern RN). Keeping the objects lets a test compare a rendered style
 * against an imported design token by value, which is the entire point of the
 * harness.
 */

export const StyleSheet = {
  create: (sheet) => sheet,
  flatten: (style) => {
    if (!style) return {};
    if (Array.isArray(style)) {
      return style.reduce((acc, entry) => Object.assign(acc, StyleSheet.flatten(entry)), {});
    }
    return style;
  },
  compose: (a, b) => [a, b],
  hairlineWidth: 1,
  absoluteFill: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  absoluteFillObject: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
};

export const View = "View";
export const Text = "Text";
export const Pressable = "Pressable";
export const TouchableOpacity = "TouchableOpacity";
export const Modal = "Modal";
export const ScrollView = "ScrollView";
export const TextInput = "TextInput";
export const Image = "Image";
export const FlatList = "FlatList";
export const SectionList = "SectionList";
export const ActivityIndicator = "ActivityIndicator";
export const RefreshControl = "RefreshControl";
export const SafeAreaView = "SafeAreaView";
export const KeyboardAvoidingView = "KeyboardAvoidingView";
export const Switch = "Switch";
export const StatusBar = "StatusBar";

/**
 * `Platform.OS` is `"web"` rather than a made-up `"test"` value: the app
 * branches on `Platform.OS === "web"` in several places (animation driver,
 * share sheet, file pickers) and the web branch is the one a Node render can
 * actually follow.
 */
export const Platform = {
  OS: "web",
  Version: 0,
  select: (spec) => (spec && "web" in spec ? spec.web : spec?.default),
};

const DEFAULT_WINDOW = { width: 1024, height: 768, scale: 1, fontScale: 1 };

export const Dimensions = {
  get: () => ({ ...DEFAULT_WINDOW }),
  addEventListener: () => ({ remove: () => {} }),
};

export function useWindowDimensions() {
  return { ...DEFAULT_WINDOW };
}

export const Easing = {
  linear: (t) => t,
  ease: (t) => t,
  in: (fn) => fn,
  out: (fn) => fn,
  inOut: (fn) => fn,
  bezier: () => (t) => t,
};

function animatedValue(initial) {
  let current = initial;
  return {
    setValue: (next) => {
      current = next;
    },
    getValue: () => current,
    interpolate: () => animatedValue(initial),
    addListener: () => "0",
    removeAllListeners: () => {},
    __getValue: () => current,
  };
}

const noopAnimation = () => ({ start: (cb) => cb?.({ finished: true }), stop: () => {} });

export const Animated = {
  Value: function AnimatedValue(initial) {
    return animatedValue(initial);
  },
  View: "Animated.View",
  Text: "Animated.Text",
  ScrollView: "Animated.ScrollView",
  Image: "Animated.Image",
  timing: noopAnimation,
  spring: noopAnimation,
  loop: noopAnimation,
  sequence: noopAnimation,
  parallel: noopAnimation,
  delay: noopAnimation,
};

export const Alert = {
  alert: () => {},
};

export const Linking = {
  openURL: async () => {},
  canOpenURL: async () => true,
  addEventListener: () => ({ remove: () => {} }),
  getInitialURL: async () => null,
};

export const Share = {
  share: async () => ({ action: "sharedAction" }),
};

export const AppState = {
  currentState: "active",
  addEventListener: () => ({ remove: () => {} }),
};

export const PanResponder = {
  create: () => ({ panHandlers: {} }),
};

export const InteractionManager = {
  runAfterInteractions: (task) => {
    task?.();
    return { cancel: () => {} };
  },
};
