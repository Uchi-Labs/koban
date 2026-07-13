// Shared JS motion tokens. Easing curves mirror the CSS custom properties in
// shadcn.css; springs are the canonical physics used across components.
// Strong custom variants - defaults like `ease-in`/`ease-out` feel weak.

export const EASE_OUT = [0.16, 1, 0.3, 1] as const;
export const EASE_IN_OUT = [0.77, 0, 0.175, 1] as const;
export const EASE_DRAWER = [0.32, 0.72, 0, 1] as const;
export const EASE_SMOOTH_OUT = [0.22, 1, 0.36, 1] as const;

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

/** Cursor-follow physics for decorative mouse tracking (magnetic, tilt, dock). */
export const SPRING_MOUSE = {
  damping: 15,
  mass: 0.3,
  stiffness: 200,
} as const;

/** Iconiq card hover — low bounce with a long, fluid settle. */
export const SPRING_CARD_HOVER = {
  damping: 19,
  mass: 0.92,
  restDelta: 0.001,
  stiffness: 95,
  type: "spring",
} as const;

/** Iconiq card section layout changes. */
export const SPRING_CARD_LAYOUT = {
  damping: 30,
  mass: 0.85,
  stiffness: 220,
  type: "spring",
} as const;

/** Setup checklist surface entrance and item reveals. */
export const SPRING_SETUP_CHECKLIST = {
  damping: 32,
  stiffness: 340,
  type: "spring",
} as const;

/** Setup checklist completion badge. */
export const SPRING_SETUP_CHECKLIST_BADGE = {
  damping: 28,
  stiffness: 520,
  type: "spring",
} as const;

/** Setup checklist radial progress fill. */
export const SPRING_SETUP_CHECKLIST_PROGRESS = {
  damping: 24,
  stiffness: 110,
  type: "spring",
} as const;

/** Banner bar-to-pill layout morph. */
export const SPRING_BANNER_MORPH = {
  damping: 30,
  mass: 0.8,
  stiffness: 320,
  type: "spring",
} as const;

/** Favicon image resolution swap. */
export const SPRING_FAVICON_SWAP = {
  damping: 28,
  stiffness: 400,
  type: "spring",
} as const;

/** Registry rolling-digit defaults for non-hero uses. */
export const ROLLING_DIGITS_DEFAULTS = {
  direction: "dynamic" as const,
  enterDamping: 10,
  enterScale: 0.84,
  enterStiffness: 170,
  enterY: 32,
  exitDamping: 15,
  exitScale: 0.84,
  exitStiffness: 170,
} as const;

/** Dashboard hero digits — quick, controlled rolls after a value changes. */
export const ROLLING_DIGITS_HERO = {
  animationDelay: 55,
  enterDamping: 24,
  enterStiffness: 320,
  enterY: 14,
} as const;
