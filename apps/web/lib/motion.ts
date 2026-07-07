// Shared JS motion tokens. Easing curves mirror the CSS custom properties in
// shadcn.css; springs are the canonical physics used across components.
// Strong custom variants - defaults like `ease-in`/`ease-out` feel weak.

export const EASE_OUT = [0.16, 1, 0.3, 1] as const;
export const EASE_IN_OUT = [0.77, 0, 0.175, 1] as const;
export const EASE_DRAWER = [0.32, 0.72, 0, 1] as const;

/** CSS string form of EASE_OUT for inline style transitions. */
export const EASE_OUT_CSS = "cubic-bezier(0.16, 1, 0.3, 1)";

/** Press feedback on buttons and other tappable surfaces. */
export const SPRING_PRESS = {
  damping: 30,
  mass: 0.6,
  stiffness: 500,
  type: "spring",
} as const;

/** Content swaps - label/icon slots trading places inside a control. */
export const SPRING_SWAP = {
  damping: 30,
  mass: 0.55,
  stiffness: 460,
  type: "spring",
} as const;

/** Overlay panel entrances - modals and sheets summoned by pointer. */
export const SPRING_PANEL = {
  damping: 40,
  mass: 0.5,
  stiffness: 420,
  type: "spring",
} as const;

/** Shared-layout glides - pills, indicators and panels morphing between positions. */
export const SPRING_LAYOUT = {
  damping: 32,
  mass: 0.6,
  stiffness: 360,
  type: "spring",
} as const;

