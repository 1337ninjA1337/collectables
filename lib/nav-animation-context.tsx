import React, { createContext, useCallback, useContext, useState } from "react";

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

  return (
    <NavAnimationContext.Provider value={{ animation, setAnimation }}>
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
