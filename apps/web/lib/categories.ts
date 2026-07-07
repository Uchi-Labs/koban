import type { Category } from "@ai-finances/schema";
import { categoryPaletteColor, neutralCategoryColor } from "@/lib/category-style";

export const appCategories: Category[] = [
  {
    archived: false,
    color: categoryPaletteColor(0),
    emoji: "💵",
    id: "cat_income",
    icon: "arrow-down-left",
    name: "Income",
    sortOrder: 10
  },
  {
    archived: false,
    color: categoryPaletteColor(3),
    emoji: "🏠",
    id: "cat_housing",
    icon: "home",
    name: "Housing",
    budgetAmount: 3600,
    sortOrder: 20
  },
  {
    archived: false,
    color: categoryPaletteColor(7),
    emoji: "🍽️",
    id: "cat_food",
    icon: "utensils",
    name: "Food & Dining",
    budgetAmount: 1200,
    sortOrder: 30
  },
  {
    archived: false,
    color: categoryPaletteColor(1),
    emoji: "🚗",
    id: "cat_transportation",
    icon: "car",
    name: "Transportation",
    budgetAmount: 650,
    sortOrder: 40
  },
  {
    archived: false,
    color: categoryPaletteColor(9),
    emoji: "💻",
    id: "cat_software",
    icon: "laptop",
    name: "Software",
    budgetAmount: 500,
    sortOrder: 50
  },
  {
    archived: false,
    color: categoryPaletteColor(5),
    emoji: "🛍️",
    id: "cat_shopping",
    icon: "shopping-bag",
    name: "Shopping",
    budgetAmount: 900,
    sortOrder: 60
  },
  {
    archived: false,
    color: categoryPaletteColor(2),
    emoji: "✈️",
    id: "cat_travel",
    icon: "plane",
    name: "Travel",
    budgetAmount: 1000,
    sortOrder: 70
  },
  {
    archived: false,
    color: categoryPaletteColor(10),
    emoji: "🔁",
    id: "cat_transfer",
    icon: "repeat",
    name: "Transfer",
    sortOrder: 80
  },
  {
    archived: false,
    color: neutralCategoryColor,
    emoji: "🏷️",
    id: "cat_other",
    icon: "circle",
    name: "Other",
    budgetAmount: 500,
    sortOrder: 900
  }
];
