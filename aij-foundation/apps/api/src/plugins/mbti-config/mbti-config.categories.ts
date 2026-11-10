/** The sole category vocabulary; release is a lifecycle view, never a category. */
export const MBTI_CATEGORIES = ["content", "channels", "catalog", "assessment", "personas", "imageRecipes", "retention", "discovery", "aiRuntime", "payments", "trade"] as const;
export type MbtiCategory = typeof MBTI_CATEGORIES[number];
