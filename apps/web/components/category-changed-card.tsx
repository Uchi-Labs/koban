"use client";

import { toast } from "sonner";
import {
  CategoryChangedCardContent,
  type CategoryChangedCardOptions
} from "@/components/category-changed-card-content";

export function showCategoryChangedCard(options: CategoryChangedCardOptions) {
  toast.custom((toastId) => <CategoryChangedCardContent toastId={toastId} {...options} />, {
    classNames: { toast: "!bg-transparent !border-0 !p-0 !shadow-none !ring-0" },
    duration: 8000,
    unstyled: true
  });
}
