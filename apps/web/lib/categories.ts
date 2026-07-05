import type { Category } from "@ai-finances/schema";

export const appCategories = [
  {
    id: "cat_income",
    name: "Income",
    icon: "arrow-down-left",
    color: "#2fbf71",
    sortOrder: 10
  },
  {
    id: "cat_housing",
    name: "Housing",
    icon: "home",
    color: "#7c3aed",
    budgetAmount: 3600,
    sortOrder: 20
  },
  {
    id: "cat_food",
    name: "Food & Dining",
    icon: "utensils",
    color: "#f59e0b",
    budgetAmount: 1200,
    sortOrder: 30
  },
  {
    id: "cat_transportation",
    name: "Transportation",
    icon: "car",
    color: "#38bdf8",
    budgetAmount: 650,
    sortOrder: 40
  },
  {
    id: "cat_software",
    name: "Software",
    icon: "laptop",
    color: "#14b8a6",
    budgetAmount: 500,
    sortOrder: 50
  },
  {
    id: "cat_shopping",
    name: "Shopping",
    icon: "shopping-bag",
    color: "#ec4899",
    budgetAmount: 900,
    sortOrder: 60
  },
  {
    id: "cat_travel",
    name: "Travel",
    icon: "plane",
    color: "#6366f1",
    budgetAmount: 1000,
    sortOrder: 70
  },
  {
    id: "cat_transfer",
    name: "Transfer",
    icon: "repeat",
    color: "#94a3b8",
    sortOrder: 80
  },
  {
    id: "cat_other",
    name: "Other",
    icon: "circle",
    color: "#94a3b8",
    budgetAmount: 500,
    sortOrder: 900
  }
] satisfies Category[];
