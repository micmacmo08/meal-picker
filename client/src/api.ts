export interface Tag {
  id: number;
  name: string;
}

export interface MealIngredient {
  id: number;
  ingredient_id: number;
  ingredient: string;
  quantity: string | null;
  measurement: string | null;
  descriptor: string | null;
}

export interface Meal {
  id: number;
  name: string;
  legacy_ingredients: string;
  ingredients: MealIngredient[];
  recipe: string;
  mikes_rating: number | null;
  michelles_rating: number | null;
  hidden: boolean;
  tag_ids: number[];
  updated_at: string;
}

export interface Plan {
  id: number;
  plan_date: string;
  meal_id: number;
  meal_name: string;
  completed_at: string | null;
}

export interface ShoppingItem {
  key: string;
  ingredient_id: number;
  ingredient: string;
  measurement: string | null;
  quantity: string | null;
  descriptors: string[];
  meal_names: string[];
}

export interface MealInput {
  name: string;
  ingredients: {
    ingredient: string;
    quantity?: string;
    measurement?: string;
    descriptor?: string;
  }[];
  recipe: string;
  mikesRating: number | null;
  michellesRating: number | null;
  tagIds: number[];
}

export interface AuthStatus {
  auth_enabled: boolean;
  authenticated: boolean;
}

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!response.ok) {
    const message =
      typeof data === "object" && data !== null && "error" in data
        ? String((data as { error: unknown }).error)
        : `Request failed (${response.status})`;
    throw new ApiError(response.status, message);
  }
  return data as T;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const api = {
  getAuthStatus: () => request<AuthStatus>("/api/auth/status"),
  login: (password: string) => request<{ ok: true }>("/api/auth/login", json("POST", { password })),
  logout: () => request<{ ok: true }>("/api/auth/logout", json("POST")),

  getMeals: async () => (await request<{ meals: Meal[] }>("/api/meals?includeHidden=true")).meals,
  getTags: async () => (await request<{ tags: Tag[] }>("/api/tags")).tags,
  pick: (tagIds: number[]) =>
    request<{ selected: Meal | null; eligible_count: number }>("/api/pick", json("POST", { tagIds })),

  createMeal: (input: MealInput) => request<{ ok: true; id: number }>("/api/meals", json("POST", input)),
  updateMeal: (id: number, input: MealInput) =>
    request<{ ok: true; id: number }>(`/api/meals/${id}`, json("PUT", input)),
  deleteMeal: (id: number) => request<{ ok: true }>(`/api/meals/${id}`, json("DELETE")),
  setMealHidden: (id: number, hidden: boolean) =>
    request<{ ok: true }>(`/api/meals/${id}/hidden`, json("POST", { hidden })),
  setRatings: (id: number, ratings: { mikesRating: number | null; michellesRating: number | null }) =>
    request<{ ok: true; meal: Meal }>(`/api/meals/${id}/ratings`, json("PATCH", ratings)),

  createTag: (name: string) => request<Tag>("/api/tags", json("POST", { name })),
  deleteTag: (id: number) => request<{ ok: true }>(`/api/tags/${id}`, json("DELETE")),
  setMealTags: (id: number, tagIds: number[]) =>
    request<{ ok: true; meal: Meal }>(`/api/meals/${id}/tags`, json("PUT", { tagIds })),

  getPlans: async () => (await request<{ plans: Plan[] }>("/api/plans")).plans,
  setPlan: (planDate: string, mealId: number) =>
    request<{ ok: true; id: number }>("/api/plans", json("POST", { planDate, mealId })),
  setPlanComplete: (id: number, complete: boolean) =>
    request<{ ok: true }>(`/api/plans/${id}/complete`, json("PATCH", { complete })),
  deletePlan: (id: number) => request<{ ok: true }>(`/api/plans/${id}`, json("DELETE")),

  getShopping: async () => (await request<{ shopping: ShoppingItem[] }>("/api/shopping")).shopping,
};
