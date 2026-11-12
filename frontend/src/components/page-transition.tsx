import { ViewTransition, type ReactNode } from "react";

// Dock links tag their navigation with a direction; anything else (browser
// back, refreshes, in-page updates) swaps the page without sliding.
const directions = {
  "nav-forward": "nav-forward",
  "nav-back": "nav-back",
  default: "none",
};

/**
 * Wraps a party page so it slides when the guest changes tab. It belongs in
 * each page rather than the layout: a layout persists across navigations and
 * would never enter or exit.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  return (
    <ViewTransition enter={directions} exit={directions} default="none">
      <div className="page-transition">{children}</div>
    </ViewTransition>
  );
}
