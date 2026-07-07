import type { Variants } from "motion/react";
import { EASE_OUT, EASE_OUT_CSS, SPRING_SWAP } from "@/lib/motion";

export type CoreAnimation = "blur" | "roll";

export const EASE_OUT_STYLE = EASE_OUT_CSS;
export const CASCADE_STAGGER = 0.025;

const BLUR_TRANSITION = { duration: 0.2, ease: "easeInOut" } as const;
const ROLL_TRANSITION = { duration: 0.24, ease: EASE_OUT } as const;

export const CASCADE_LETTER_VARIANTS: Variants = {
  animate: (delay: number = 0) => ({
    opacity: 1,
    transition: { ...SPRING_SWAP, delay },
    y: "0%"
  }),
  exit: (delay: number = 0) => ({
    opacity: 0,
    transition: { delay: delay * 0.5, duration: 0.16, ease: EASE_OUT },
    y: "-105%"
  }),
  initial: { opacity: 0, y: "105%" }
};

export const TEXT_VARIANTS: Record<CoreAnimation, Variants> = {
  blur: {
    animate: {
      opacity: 1,
      scale: 1,
      transition: BLUR_TRANSITION
    },
    exit: {
      opacity: 0,
      scale: 0.94,
      transition: BLUR_TRANSITION
    },
    initial: { opacity: 0, scale: 0.94 }
  },
  roll: {
    animate: {
      opacity: 1,
      transition: ROLL_TRANSITION,
      y: "0%"
    },
    exit: {
      opacity: 0,
      transition: { duration: 0.18, ease: "easeInOut" },
      y: "-115%"
    },
    initial: { opacity: 0, y: "115%" }
  }
};

export const ICON_VARIANTS: Record<CoreAnimation, Variants> = {
  blur: {
    animate: {
      opacity: 1,
      scale: 1,
      transition: BLUR_TRANSITION
    },
    exit: {
      opacity: 0,
      scale: 0.25,
      transition: BLUR_TRANSITION
    },
    initial: { opacity: 0, scale: 0.25 }
  },
  roll: {
    animate: {
      opacity: 1,
      transition: ROLL_TRANSITION,
      y: 0
    },
    exit: {
      opacity: 0,
      transition: { duration: 0.18, ease: "easeInOut" },
      y: -16
    },
    initial: { opacity: 0, y: 16 }
  }
};
