import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// The custom type-scale steps from app/shadcn.css. Unregistered, tailwind-merge
// reads `text-ui` as a colour and drops the real text colour beside it.
const twMerge = extendTailwindMerge({
  extend: { theme: { text: ["ui", "2xs", "3xs"] } }
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
