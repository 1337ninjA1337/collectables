import { usePathname } from "expo-router";
import { useEffect, useRef } from "react";

import { addBreadcrumb } from "@/lib/sentry";

export function NavigationBreadcrumbs() {
  const pathname = usePathname();
  const previous = useRef<string | null>(null);

  useEffect(() => {
    if (previous.current === pathname) return;
    addBreadcrumb(`navigated to ${pathname}`, {
      from: previous.current,
      to: pathname,
    });
    previous.current = pathname;
  }, [pathname]);

  return null;
}
