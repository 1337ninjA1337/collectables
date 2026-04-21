import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

export type NavAnimation = "slide_from_right" | "slide_from_left" | "default";

type NavAnimationContextValue = {
  animation: NavAnimation;
  setAnimation: (anim: NavAnimation) => void;
};

const NavAnimationContext = createContext<NavAnimationContextValue | null>(null);

export function NavAnimationProvider({ children }: React.PropsWithChildren) {
  const [animation, setAnimationState] = useState<NavAnimation>("default");

  const setAnimation = useCallback((anim: NavAnimation) => {
    setAnimationState(anim);
  }, []);

  const value = useMemo(() => ({ animation, setAnimation }), [animation, setAnimation]);

  return (
    <NavAnimationContext.Provider value={value}>
      {children}
    </NavAnimationContext.Provider>
  );
}

export function useNavAnimation() {
  const ctx = useContext(NavAnimationContext);
  if (!ctx) {
    throw new Error("useNavAnimation must be used inside NavAnimationProvider");
  }
  return ctx;
}
