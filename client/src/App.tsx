import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  ApiError,
  api,
  type Meal,
  type MealInput,
  type Plan,
  type Tag,
} from "./api";
import {
  aggregateGuestShopping,
  clearGuestPlans,
  loadGuestPlans,
  removeGuestPlan,
  saveGuestPlans,
  setGuestPlanComplete,
  upsertGuestPlan,
  type GuestPlan,
} from "./guest";

type View = "pick" | "meals" | "plan" | "shop" | "tags";
type CalendarMode = "month" | "week";
type IngredientDraft = {
  ingredient: string;
  quantity: string;
  measurement: string;
  descriptor: string;
};

const blankIngredient = (): IngredientDraft => ({
  ingredient: "",
  quantity: "",
  measurement: "",
  descriptor: "",
});

const emptyDraft = () => ({
  id: undefined as number | undefined,
  name: "",
  ingredients: [blankIngredient()],
  recipe: "",
  mikesRating: null as number | null,
  michellesRating: null as number | null,
  tagIds: [] as number[],
});

function ratingLabel(quarters: number) {
  const value = quarters / 4;
  return Number.isInteger(value)
    ? value.toFixed(0)
    : value.toFixed(2).replace(/0$/, "");
}

function StarIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m12 2.4 2.93 5.94 6.56.95-4.75 4.63 1.12 6.53L12 17.37l-5.86 3.08 1.12-6.53-4.75-4.63 6.56-.95L12 2.4Z" />
    </svg>
  );
}

function StarMeter({ quarters, className }: { quarters: number; className: string }) {
  const boundedQuarters = Math.max(0, Math.min(20, quarters));
  return (
    <span className={`${className} star-meter`} aria-hidden="true">
      {Array.from({ length: 5 }, (_, starIndex) => {
        const filledQuarters = Math.max(
          0,
          Math.min(4, boundedQuarters - starIndex * 4),
        );
        return (
          <span className="star-meter__star" key={starIndex}>
            <span className="star-meter__base">
              <StarIcon />
            </span>
            <span
              className="star-meter__fill"
              style={{ width: `${filledQuarters * 25}%` }}
            >
              <StarIcon />
            </span>
          </span>
        );
      })}
    </span>
  );
}

function Rating({
  quarters,
  compact = false,
  label,
}: {
  quarters: number | null;
  compact?: boolean;
  label?: string;
}) {
  const accessibleLabel =
    quarters === null
      ? `${label ?? "Rating"}: not rated`
      : `${label ?? "Rating"}: ${ratingLabel(quarters)} out of 5 stars`;
  return (
    <div
      className={`rating ${compact ? "rating--compact" : ""} ${
        quarters === null ? "rating--unrated" : ""
      }`}
      aria-label={accessibleLabel}
    >
      {label && <span className="rating__owner">{label}</span>}
      {quarters === null ? (
        <span className="rating__empty">Not rated</span>
      ) : (
        <>
          <StarMeter quarters={quarters} className="rating__stars" />
          {!compact && <strong>{ratingLabel(quarters)}</strong>}
        </>
      )}
    </div>
  );
}

function MealRatings({ meal, compact = false }: { meal: Meal; compact?: boolean }) {
  return (
    <div className={`meal-ratings ${compact ? "meal-ratings--compact" : ""}`}>
      <Rating label="Mike" quarters={meal.mikes_rating} compact={compact} />
      <Rating label="Michelle" quarters={meal.michelles_rating} compact={compact} />
    </div>
  );
}

function RatingEditor({
  name,
  value,
  onChange,
}: {
  name: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  const [preview, setPreview] = useState<number | null>(null);
  const shownValue = preview ?? value;
  const label =
    shownValue === null
      ? "Not rated"
      : `${ratingLabel(shownValue)} ${
          shownValue === 4 ? "star" : "stars"
        }${preview === null ? " selected" : ""}`;

  return (
    <fieldset className="rating-person-field">
      <legend>{name}’s rating</legend>
      <div className="rating-control">
        <div className="rating-input-row">
          <div
            className="rating-picker"
            onMouseLeave={() => setPreview(null)}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) {
                setPreview(null);
              }
            }}
          >
            {Array.from({ length: 5 }, (_, starIndex) => {
              const filledQuarters = Math.max(
                0,
                Math.min(4, (shownValue ?? 0) - starIndex * 4),
              );
              return (
                <span className="rating-picker__star" key={starIndex}>
                  <span className="rating-picker__visual" aria-hidden="true">
                    <span className="rating-picker__base">
                      <StarIcon />
                    </span>
                    <span
                      className="rating-picker__fill"
                      style={{ width: `${filledQuarters * 25}%` }}
                    >
                      <StarIcon />
                    </span>
                  </span>
                  <span className="rating-picker__quarters">
                    {Array.from(
                      { length: 4 },
                      (_, quarterIndex) => starIndex * 4 + quarterIndex + 1,
                    ).map((quarters) => (
                      <button
                        key={quarters}
                        type="button"
                        aria-label={`Set ${name}’s rating to ${ratingLabel(quarters)} ${
                          quarters === 4 ? "star" : "stars"
                        }`}
                        aria-pressed={value === quarters}
                        onMouseEnter={() => setPreview(quarters)}
                        onFocus={() => setPreview(quarters)}
                        onClick={() => onChange(quarters)}
                      />
                    ))}
                  </span>
                </span>
              );
            })}
          </div>
          <div className="rating-stepper" aria-label={`${name} rating controls`}>
            <button
              type="button"
              aria-label={`Decrease ${name}’s rating by 0.25 stars`}
              disabled={value === null}
              onClick={() =>
                onChange(value === null || value <= 1 ? null : value - 1)
              }
            >
              −
            </button>
            <button
              type="button"
              aria-label={`Increase ${name}’s rating by 0.25 stars`}
              disabled={value === 20}
              onClick={() => onChange(Math.min(20, (value ?? 0) + 1))}
            >
              +
            </button>
          </div>
        </div>
        <span
          className={`rating-picker__label ${preview !== null ? "is-preview" : ""}`}
          aria-live="polite"
        >
          {label}
        </span>
        {value !== null && (
          <button type="button" className="clear-rating" onClick={() => onChange(null)}>
            Clear
          </button>
        )}
      </div>
    </fieldset>
  );
}

function RatingEditButton({
  hasRatings,
  onClick,
  detail = false,
}: {
  hasRatings: boolean;
  onClick: () => void;
  detail?: boolean;
}) {
  const label = hasRatings
    ? detail
      ? "Change ratings"
      : "Edit ratings"
    : detail
      ? "Add ratings"
      : "Rate";
  return (
    <button type="button" className="rate-meal-button" onClick={onClick}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 20h4l11-11-4-4L4 16v4Zm10-13 4 4M13.5 6.5l4 4" />
      </svg>
      <span>{label}</span>
    </button>
  );
}

function TagChip({
  tag,
  active,
  onClick,
}: {
  tag: Tag;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`tag-chip ${active ? "is-active" : ""}`}
      aria-pressed={active}
      onClick={onClick}
    >
      {tag.name}
    </button>
  );
}

function PasswordGate({
  title,
  description,
  checking,
  onLogin,
}: {
  title: string;
  description: string;
  checking: boolean;
  onLogin: () => void;
}) {
  return (
    <section className="password-gate" aria-labelledby="password-gate-title">
      <p className="kicker">Household access</p>
      <h1 id="password-gate-title">{title}</h1>
      <p>{description}</p>
      <button className="primary-action" disabled={checking} onClick={onLogin}>
        {checking ? "Checking access…" : "Enter password"}
      </button>
    </section>
  );
}

type DisplayPlan = Omit<Plan, "id"> & {
  key: string;
  serverId?: number;
  guestId?: string;
};

function DemoBanner({
  detail,
  onLogin,
}: {
  detail: string;
  onLogin: () => void;
}) {
  return (
    <aside className="demo-banner" aria-label="Demo mode notice">
      <div>
        <strong>Demo mode — plans aren't saved.</strong>
        <span>{detail}</span>
      </div>
      <button type="button" onClick={onLogin}>
        Log in
      </button>
    </aside>
  );
}

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fromDateKey(value: string) {
  const [year = 1970, month = 1, day = 1] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function addDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function startOfWeek(date: Date) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() - next.getDay());
  return next;
}

function formatIngredientLine(item: Meal["ingredients"][number]) {
  return [
    item.quantity,
    item.measurement,
    item.ingredient,
    item.descriptor ? `(${item.descriptor})` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

function toggleId(ids: number[], id: number) {
  return ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id];
}

export function App() {
  const queryClient = useQueryClient();
  const [view, setView] = useState<View>("pick");
  const [pickerTags, setPickerTags] = useState<number[]>([]);
  const [libraryTags, setLibraryTags] = useState<number[]>([]);
  const [manageMode, setManageMode] = useState(false);
  const [picked, setPicked] = useState<Meal | null>(null);
  const [detailMeal, setDetailMeal] = useState<Meal | null>(null);
  const [ratingMeal, setRatingMeal] = useState<Meal | null>(null);
  const [ratingDraft, setRatingDraft] = useState({
    mikesRating: null as number | null,
    michellesRating: null as number | null,
  });
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [tagName, setTagName] = useState("");
  const [confirmMeal, setConfirmMeal] = useState<Meal | null>(null);
  const [confirmTag, setConfirmTag] = useState<Tag | null>(null);
  const [calendarMode, setCalendarMode] = useState<CalendarMode>("month");
  const [calendarCursor, setCalendarCursor] = useState(() => new Date());
  const [planDate, setPlanDate] = useState<string | null>(null);
  const [plannedMealId, setPlannedMealId] = useState("");
  const [loginOpen, setLoginOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [loginMessage, setLoginMessage] = useState(
    "Enter the shared household password to continue.",
  );
  const pendingActionRef = useRef<(() => void) | null>(null);
  const [guestPlans, setGuestPlans] = useState<GuestPlan[]>(() => loadGuestPlans());

  const authStatus = useQuery({
    queryKey: ["auth-status"],
    queryFn: api.getAuthStatus,
    retry: false,
  });
  const authEnabled = authStatus.data?.auth_enabled ?? false;
  const authenticated = authStatus.data?.authenticated ?? false;
  const isGuest = authStatus.isSuccess && authEnabled && !authenticated;

  // Discard demo state as soon as a real household session is known. This
  // covers both a login in this tab and opening the app while already
  // logged in; household data is never written to the guest store.
  useEffect(() => {
    if (!authenticated) return;
    setGuestPlans([]);
    clearGuestPlans();
  }, [authenticated]);

  function replaceGuestPlans(next: GuestPlan[]) {
    setGuestPlans(next);
    saveGuestPlans(next);
  }

  function discardGuestPlans() {
    setGuestPlans([]);
    clearGuestPlans();
  }

  const mealsQuery = useQuery({ queryKey: ["meals"], queryFn: api.getMeals });
  const tagsQuery = useQuery({ queryKey: ["tags"], queryFn: api.getTags });
  // Guest mode deliberately leaves both queries disabled: a logged-out
  // visitor must not call /api/plans or /api/shopping at all. Those views
  // read the local guest store instead when isGuest is true.
  const plansQuery = useQuery({
    queryKey: ["plans"],
    queryFn: api.getPlans,
    enabled: authenticated,
    retry: false,
  });
  const shoppingQuery = useQuery({
    queryKey: ["shopping"],
    queryFn: api.getShopping,
    enabled: authenticated,
    retry: false,
  });

  const refreshMeals = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["meals"] }),
      queryClient.invalidateQueries({ queryKey: ["tags"] }),
    ]);
  };
  const refreshPlans = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["plans"] }),
      queryClient.invalidateQueries({ queryKey: ["shopping"] }),
    ]);
  };
  const refreshAll = async () => {
    await Promise.all([refreshMeals(), refreshPlans()]);
  };

  function promptForLogin(
    message = "Enter the shared household password to continue.",
    action?: () => void,
  ) {
    pendingActionRef.current = action ?? null;
    setLoginMessage(message);
    setLoginOpen(true);
  }

  function requireAuth(
    action: () => void,
    message = "That change needs the shared household password.",
  ) {
    if (!authEnabled || authenticated) {
      action();
      return;
    }
    promptForLogin(message, action);
  }

  function handleMutationError(error: unknown, retry: () => void) {
    if (error instanceof ApiError && error.status === 401) {
      promptForLogin(
        "Your session is not logged in. Enter the password and the action will be retried.",
        retry,
      );
    }
  }

  const login = useMutation({
    mutationFn: () => api.login(password),
    onSuccess: async () => {
      discardGuestPlans();
      setPassword("");
      setLoginOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["auth-status"] });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["plans"] }),
        queryClient.invalidateQueries({ queryKey: ["shopping"] }),
      ]);
      const action = pendingActionRef.current;
      pendingActionRef.current = null;
      if (action) window.setTimeout(action, 0);
    },
  });

  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: async () => {
      pendingActionRef.current = null;
      // The next logged-out session starts from a fresh, empty demo —
      // never from the household plans that were just on screen.
      discardGuestPlans();
      queryClient.removeQueries({ queryKey: ["plans"] });
      queryClient.removeQueries({ queryKey: ["shopping"] });
      await queryClient.invalidateQueries({ queryKey: ["auth-status"] });
    },
  });

  const saveMeal = useMutation({
    mutationFn: async () => {
      const input: MealInput = {
        name: draft.name,
        ingredients: draft.ingredients.filter((item) => item.ingredient.trim()),
        recipe: draft.recipe,
        mikesRating: draft.mikesRating,
        michellesRating: draft.michellesRating,
        tagIds: draft.tagIds,
      };
      return draft.id ? api.updateMeal(draft.id, input) : api.createMeal(input);
    },
    onSuccess: async () => {
      await refreshAll();
      setEditorOpen(false);
      setDraft(emptyDraft());
    },
    onError: (error) => handleMutationError(error, () => saveMeal.mutate()),
  });

  const setMealHidden = useMutation({
    mutationFn: ({ id, hidden }: { id: number; hidden: boolean }) =>
      api.setMealHidden(id, hidden),
    onSuccess: async (_, variables) => {
      await refreshAll();
      setDetailMeal(null);
      if (variables.hidden && picked?.id === variables.id) setPicked(null);
    },
    onError: (error, variables) =>
      handleMutationError(error, () => setMealHidden.mutate(variables)),
  });

  const saveRatings = useMutation({
    mutationFn: () => {
      if (!ratingMeal) throw new Error("Choose a meal to rate.");
      return api.setRatings(ratingMeal.id, ratingDraft);
    },
    onSuccess: async () => {
      const ratedMealId = ratingMeal?.id;
      await refreshMeals();
      if (ratedMealId && picked?.id === ratedMealId) {
        setPicked((current) =>
          current
            ? {
                ...current,
                mikes_rating: ratingDraft.mikesRating,
                michelles_rating: ratingDraft.michellesRating,
              }
            : null,
        );
      }
      setRatingMeal(null);
    },
    onError: (error) => handleMutationError(error, () => saveRatings.mutate()),
  });

  const removeMeal = useMutation({
    mutationFn: (id: number) => api.deleteMeal(id),
    onSuccess: async () => {
      const deletedId = confirmMeal?.id;
      await refreshAll();
      setConfirmMeal(null);
      setDetailMeal(null);
      if (picked?.id === deletedId) setPicked(null);
    },
    onError: (error, id) => handleMutationError(error, () => removeMeal.mutate(id)),
  });

  const createTag = useMutation({
    mutationFn: (name: string) => api.createTag(name),
    onSuccess: async () => {
      await refreshMeals();
      setTagName("");
    },
    onError: (error, name) => handleMutationError(error, () => createTag.mutate(name)),
  });

  const removeTag = useMutation({
    mutationFn: (id: number) => api.deleteTag(id),
    onSuccess: async () => {
      const deletedId = confirmTag?.id;
      await refreshMeals();
      setPickerTags((ids) => ids.filter((id) => id !== deletedId));
      setLibraryTags((ids) => ids.filter((id) => id !== deletedId));
      setConfirmTag(null);
    },
    onError: (error, id) => handleMutationError(error, () => removeTag.mutate(id)),
  });

  const assignTags = useMutation({
    mutationFn: ({ id, tagIds }: { id: number; tagIds: number[] }) =>
      api.setMealTags(id, tagIds),
    onSuccess: async (result) => {
      setDetailMeal(result.meal);
      await refreshMeals();
    },
    onError: (error, variables) =>
      handleMutationError(error, () => assignTags.mutate(variables)),
  });

  const pick = useMutation({
    mutationFn: () => api.pick(pickerTags),
    onSuccess: (result) => setPicked(result.selected),
  });

  const setPlan = useMutation({
    mutationFn: ({ date, mealId }: { date: string; mealId: number }) =>
      api.setPlan(date, mealId),
    onSuccess: async () => {
      await refreshPlans();
      setPlanDate(null);
      setPlannedMealId("");
    },
    onError: (error, variables) =>
      handleMutationError(error, () => setPlan.mutate(variables)),
  });

  const removePlan = useMutation({
    mutationFn: (id: number) => api.deletePlan(id),
    onSuccess: async () => {
      await refreshPlans();
      setPlanDate(null);
    },
    onError: (error, id) => handleMutationError(error, () => removePlan.mutate(id)),
  });

  const completePlan = useMutation({
    mutationFn: ({ id, complete }: { id: number; complete: boolean }) =>
      api.setPlanComplete(id, complete),
    onSuccess: refreshPlans,
    onError: (error, variables) =>
      handleMutationError(error, () => completePlan.mutate(variables)),
  });

  const meals = mealsQuery.data ?? [];
  const tags = tagsQuery.data ?? [];
  const mealsById = useMemo(() => new Map(meals.map((meal) => [meal.id, meal])), [meals]);
  const guestShopping = useMemo(
    () => aggregateGuestShopping(guestPlans, meals),
    [guestPlans, meals],
  );
  const plans: DisplayPlan[] = isGuest
    ? guestPlans.flatMap((plan) => {
        const meal = mealsById.get(plan.meal_id);
        if (!meal) return [];
        return [
          {
            key: `guest:${plan.id}`,
            guestId: plan.id,
            plan_date: plan.plan_date,
            meal_id: plan.meal_id,
            meal_name: meal.name,
            completed_at: plan.completed_at,
          },
        ];
      })
    : authenticated
      ? (plansQuery.data ?? []).map((plan) => ({
          key: `server:${plan.id}`,
          serverId: plan.id,
          plan_date: plan.plan_date,
          meal_id: plan.meal_id,
          meal_name: plan.meal_name,
          completed_at: plan.completed_at,
        }))
      : [];
  const shopping = isGuest
    ? guestShopping
    : authenticated
      ? (shoppingQuery.data ?? [])
      : [];
  const activeMeals = meals.filter((meal) => !meal.hidden);
  const hiddenMeals = meals.filter((meal) => meal.hidden);
  const libraryMeals = activeMeals.filter((meal) =>
    libraryTags.every((tagId) => meal.tag_ids.includes(tagId)),
  );
  const planByDate = useMemo(
    () => new Map(plans.map((plan) => [plan.plan_date, plan])),
    [plans],
  );
  const eligibleCount = activeMeals.filter((meal) =>
    pickerTags.every((id) => meal.tag_ids.includes(id)),
  ).length;
  const calendarDays = useMemo(() => {
    if (calendarMode === "week") {
      const start = startOfWeek(calendarCursor);
      return Array.from({ length: 7 }, (_, index) => addDays(start, index));
    }
    const first = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth(), 1);
    const start = addDays(first, -first.getDay());
    return Array.from({ length: 42 }, (_, index) => addDays(start, index));
  }, [calendarCursor, calendarMode]);

  function openNewMealNow() {
    setDraft(emptyDraft());
    setEditorOpen(true);
  }
  function openNewMeal() {
    requireAuth(openNewMealNow, "Adding a meal needs the household password.");
  }
  function openRatingNow(meal: Meal) {
    setDetailMeal(null);
    setRatingMeal(meal);
    setRatingDraft({
      mikesRating: meal.mikes_rating,
      michellesRating: meal.michelles_rating,
    });
  }
  function openRating(meal: Meal) {
    requireAuth(
      () => openRatingNow(meal),
      "Ratings are changes, so they need the household password.",
    );
  }
  function openEditNow(meal: Meal) {
    setDetailMeal(null);
    setDraft({
      id: meal.id,
      name: meal.name,
      ingredients: meal.ingredients.length
        ? meal.ingredients.map((item) => ({
            ingredient: item.ingredient,
            quantity: item.quantity ?? "",
            measurement: item.measurement ?? "",
            descriptor: item.descriptor ?? "",
          }))
        : [blankIngredient()],
      recipe: meal.recipe,
      mikesRating: meal.mikes_rating,
      michellesRating: meal.michelles_rating,
      tagIds: [...meal.tag_ids],
    });
    setEditorOpen(true);
  }
  function openEdit(meal: Meal) {
    requireAuth(() => openEditNow(meal), "Editing a meal needs the household password.");
  }
  function submitMeal(event: FormEvent) {
    event.preventDefault();
    saveMeal.mutate();
  }
  function openPlan(dateKey: string) {
    const existing = planByDate.get(dateKey);
    setPlanDate(dateKey);
    setPlannedMealId(
      existing
        ? String(existing.meal_id)
        : activeMeals[0]
          ? String(activeMeals[0].id)
          : "",
    );
  }
  function moveCalendar(direction: number) {
    const next = new Date(calendarCursor);
    if (calendarMode === "month") next.setMonth(next.getMonth() + direction, 1);
    else next.setDate(next.getDate() + direction * 7);
    setCalendarCursor(next);
  }
  function submitDisplayedPlan() {
    if (!planDate || !plannedMealId) return;
    if (isGuest) {
      replaceGuestPlans(upsertGuestPlan(guestPlans, planDate, Number(plannedMealId)));
      setPlanDate(null);
      setPlannedMealId("");
      return;
    }
    setPlan.mutate({ date: planDate, mealId: Number(plannedMealId) });
  }
  function removeDisplayedPlan(plan: DisplayPlan) {
    if (isGuest) {
      if (plan.guestId) replaceGuestPlans(removeGuestPlan(guestPlans, plan.guestId));
      setPlanDate(null);
      return;
    }
    if (plan.serverId) removePlan.mutate(plan.serverId);
  }
  function toggleDisplayedPlan(plan: DisplayPlan, complete: boolean) {
    if (isGuest) {
      if (plan.guestId) {
        replaceGuestPlans(setGuestPlanComplete(guestPlans, plan.guestId, complete));
      }
      return;
    }
    if (plan.serverId) completePlan.mutate({ id: plan.serverId, complete });
  }
  function updateIngredient(
    index: number,
    field: keyof IngredientDraft,
    value: string,
  ) {
    setDraft((current) => ({
      ...current,
      ingredients: current.ingredients.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item,
      ),
    }));
  }
  function submitLogin(event: FormEvent) {
    event.preventDefault();
    login.mutate();
  }

  if (mealsQuery.isPending || tagsQuery.isPending) {
    return (
      <div className="loading">
        <span className="loading__mark" />
        Opening the recipe box…
      </div>
    );
  }
  if (mealsQuery.isError || tagsQuery.isError) {
    return (
      <main className="state-page">
        <h1>Couldn’t open your meals</h1>
        <p>{String(mealsQuery.error ?? tagsQuery.error)}</p>
        <button
          onClick={() => {
            void mealsQuery.refetch();
            void tagsQuery.refetch();
          }}
        >
          Try again
        </button>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <button
          type="button"
          className="brand-button"
          onClick={() => setView("pick")}
          aria-label="Meal Picker home"
        >
          <span className="brand-mark" aria-hidden="true">
            MP
          </span>
          <span>
            <strong>Meal Picker</strong>
            <small>meals.digitaldwarf.dev</small>
          </span>
        </button>
        <div className="auth-controls">
          {authStatus.isPending ? (
            <span className="auth-state">Checking access…</span>
          ) : !authEnabled ? (
            <span className="auth-state">Local dev · auth off</span>
          ) : authenticated ? (
            <>
              <span className="auth-state is-authenticated">Logged in</span>
              <button
                type="button"
                className="auth-button"
                disabled={logout.isPending}
                onClick={() => logout.mutate()}
              >
                {logout.isPending ? "Logging out…" : "Log out"}
              </button>
            </>
          ) : (
            <>
              <span className="auth-state">Meals + picker open</span>
              <button
                type="button"
                className="auth-button"
                onClick={() => promptForLogin()}
              >
                Log in
              </button>
            </>
          )}
        </div>
      </header>

      <main className="page">
        {view === "pick" && (
          <section className="picker-view" aria-labelledby="picker-heading">
            <div className="section-intro">
              <p className="kicker">Tonight’s call</p>
              <h1 id="picker-heading">What sounds good?</h1>
              <p>
                Mike and Michelle’s entered ratings are averaged for the draw.
                An unrated meal counts as 2.5 stars, so it gets a fair chance
                without beating your favourites. No password needed here.
              </p>
            </div>
            <div className={`pick-stage ${picked ? "has-pick" : ""}`} aria-live="polite">
              <div className="plate-ring">
                {picked ? (
                  <button
                    type="button"
                    className="picked-meal"
                    onClick={() => setDetailMeal(picked)}
                    aria-label={`Open ${picked.name}`}
                  >
                    <span className="picked-meal__label">Tonight, make</span>
                    <strong>{picked.name}</strong>
                    <MealRatings meal={picked} compact />
                  </button>
                ) : (
                  <div className="empty-plate">
                    <span>
                      {activeMeals.length === 0
                        ? hiddenMeals.length
                          ? "Every meal is hidden"
                          : "Your recipe box is empty"
                        : "Ready when you are"}
                    </span>
                  </div>
                )}
              </div>
              {activeMeals.length === 0 ? (
                <button
                  type="button"
                  className="primary-action"
                  onClick={() => (hiddenMeals.length ? setView("meals") : openNewMeal())}
                >
                  {hiddenMeals.length ? "Review hidden meals" : "Add your first meal"}
                </button>
              ) : (
                <button
                  type="button"
                  className="primary-action"
                  disabled={eligibleCount === 0 || pick.isPending}
                  onClick={() => pick.mutate()}
                >
                  {pick.isPending ? "Picking…" : picked ? "Pick again" : "Pick a meal"}
                </button>
              )}
              {pick.isError && <p className="form-error">{String(pick.error)}</p>}
              <p className="odds-note">
                {eligibleCount} {eligibleCount === 1 ? "meal" : "meals"} in this draw
              </p>
            </div>
            {tags.length > 0 && (
              <div className="filter-block">
                <div className="filter-heading">
                  <h2>Narrow the draw</h2>
                  {pickerTags.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setPickerTags([]);
                        setPicked(null);
                      }}
                    >
                      Clear
                    </button>
                  )}
                </div>
                <div className="chips" aria-label="Meal filters">
                  {tags.map((tag) => (
                    <TagChip
                      key={tag.id}
                      tag={tag}
                      active={pickerTags.includes(tag.id)}
                      onClick={() => {
                        setPickerTags((ids) => toggleId(ids, tag.id));
                        setPicked(null);
                      }}
                    />
                  ))}
                </div>
                {eligibleCount === 0 && (
                  <p className="inline-warning">
                    No meals have every selected tag. Remove a filter to widen the draw.
                  </p>
                )}
              </div>
            )}
          </section>
        )}

        {view === "meals" && (
          <section aria-labelledby="meals-heading">
            <div className="library-heading">
              <div>
                <p className="kicker">Recipe box</p>
                <h1 id="meals-heading">Your meals</h1>
                <p>
                  Browse freely. Ratings and changes stay behind the pencil and
                  the household password.
                </p>
              </div>
              <div className="library-actions">
                <button
                  type="button"
                  className="manage-button"
                  aria-pressed={manageMode}
                  onClick={() => setManageMode((value) => !value)}
                >
                  {manageMode ? "Done managing" : "Manage hidden"}
                </button>
                <button type="button" className="add-button" onClick={openNewMeal}>
                  + Add meal
                </button>
              </div>
            </div>

            {tags.length > 0 && (
              <div className="library-filter" aria-label="Filter meals by tags">
                <div className="filter-heading">
                  <h2>Filter by tags</h2>
                  {libraryTags.length > 0 && (
                    <button type="button" onClick={() => setLibraryTags([])}>
                      Clear
                    </button>
                  )}
                </div>
                <div className="chips">
                  {tags.map((tag) => (
                    <TagChip
                      key={tag.id}
                      tag={tag}
                      active={libraryTags.includes(tag.id)}
                      onClick={() => setLibraryTags((ids) => toggleId(ids, tag.id))}
                    />
                  ))}
                </div>
                <p className="filter-note">A meal must carry every selected tag.</p>
              </div>
            )}

            {meals.length === 0 ? (
              <div className="empty-library">
                <h2>Start with a favorite</h2>
                <p>
                  Add structured ingredients, a method, ratings, and tags. It
                  will immediately join the picker and planner.
                </p>
                <button type="button" className="secondary-action" onClick={openNewMeal}>
                  Add a meal
                </button>
              </div>
            ) : (
              <>
                {libraryMeals.length > 0 ? (
                  <div className="meal-list">
                    {libraryMeals.map((meal) => (
                      <article key={meal.id} className="meal-row">
                        <button
                          type="button"
                          className="meal-row__open"
                          onClick={() => setDetailMeal(meal)}
                          aria-label={`Open ${meal.name} recipe`}
                        >
                          <span className="meal-row__main">
                            <strong>{meal.name}</strong>
                            <span className="meal-row__tags">
                              {meal.tag_ids
                                .map((id) => tags.find((tag) => tag.id === id)?.name)
                                .filter(Boolean)
                                .join(" · ") || "Untagged"}
                            </span>
                          </span>
                          <MealRatings meal={meal} compact />
                        </button>
                        <RatingEditButton
                          hasRatings={
                            meal.mikes_rating !== null || meal.michelles_rating !== null
                          }
                          onClick={() => openRating(meal)}
                        />
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="empty-library compact-empty">
                    <h2>No meals match</h2>
                    <p>Remove a tag filter, restore a hidden meal in manage mode, or add a new meal.</p>
                  </div>
                )}

                {manageMode && hiddenMeals.length > 0 && (
                  <section className="hidden-meals" aria-labelledby="hidden-meals-heading">
                    <div className="hidden-meals__heading">
                      <strong id="hidden-meals-heading">Hidden meals</strong>
                      <small>{hiddenMeals.length} out of rotation</small>
                    </div>
                    <div className="hidden-meals__list">
                      {hiddenMeals.map((meal) => (
                        <div className="hidden-meal-row" key={meal.id}>
                          <button
                            type="button"
                            className="hidden-meal-row__name"
                            onClick={() => setDetailMeal(meal)}
                          >
                            {meal.name}
                          </button>
                          <button
                            type="button"
                            className="restore-button"
                            disabled={setMealHidden.isPending}
                            onClick={() =>
                              requireAuth(
                                () => setMealHidden.mutate({ id: meal.id, hidden: false }),
                                "Restoring a meal needs the household password.",
                              )
                            }
                          >
                            Unhide
                          </button>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}
          </section>
        )}

        {view === "plan" &&
          (!isGuest && !authenticated ? (
            <PasswordGate
              title="Calendar is private"
              description="Meal plans reveal the household calendar, so viewing and changing them requires the shared password. Meals and the randomizer stay open."
              checking={authStatus.isPending}
              onLogin={() => promptForLogin("Log in to view the meal calendar.")}
            />
          ) : !isGuest && plansQuery.isPending ? (
            <div className="loading loading--inline">
              <span className="loading__mark" />
              Loading the calendar…
            </div>
          ) : !isGuest && plansQuery.isError ? (
            <section className="state-panel">
              <h1>Couldn’t load the calendar</h1>
              <p>{String(plansQuery.error)}</p>
              <button
                type="button"
                className="secondary-action"
                onClick={() => void plansQuery.refetch()}
              >
                Try again
              </button>
            </section>
          ) : (
            <section aria-labelledby="plan-heading">
              {isGuest && (
                <DemoBanner
                  detail="These demo plans live only in this browser tab and are never sent to the household calendar. Log in to save them and see the saved household calendar."
                  onLogin={() =>
                    promptForLogin("Log in to save your plans and view the household calendar.")
                  }
                />
              )}
              <div className="planner-heading">
                <div>
                  <p className="kicker">Meal calendar</p>
                  <h1 id="plan-heading">Plan ahead</h1>
                </div>
                <div className="view-toggle" aria-label="Calendar view">
                  <button
                    type="button"
                    className={calendarMode === "month" ? "is-active" : ""}
                    onClick={() => setCalendarMode("month")}
                  >
                    Month
                  </button>
                  <button
                    type="button"
                    className={calendarMode === "week" ? "is-active" : ""}
                    onClick={() => setCalendarMode("week")}
                  >
                    Week
                  </button>
                </div>
              </div>
              <div className="calendar-toolbar">
                <button
                  type="button"
                  aria-label={`Previous ${calendarMode}`}
                  onClick={() => moveCalendar(-1)}
                >
                  ‹
                </button>
                <strong>
                  {calendarMode === "month"
                    ? calendarCursor.toLocaleDateString(undefined, {
                        month: "long",
                        year: "numeric",
                      })
                    : `${calendarDays[0]?.toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      }) ?? ""} – ${calendarDays[6]?.toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      }) ?? ""}`}
                </strong>
                <button
                  type="button"
                  aria-label={`Next ${calendarMode}`}
                  onClick={() => moveCalendar(1)}
                >
                  ›
                </button>
              </div>
              <div className={`calendar-grid calendar-grid--${calendarMode}`}>
                {calendarDays.map((date) => {
                  const key = localDateKey(date);
                  const plan = planByDate.get(key);
                  const outside =
                    calendarMode === "month" && date.getMonth() !== calendarCursor.getMonth();
                  return (
                    <button
                      type="button"
                      key={key}
                      className={`calendar-day ${outside ? "is-outside" : ""} ${
                        plan?.completed_at ? "is-complete" : ""
                      }`}
                      onClick={() => openPlan(key)}
                      aria-label={`${date.toLocaleDateString(undefined, {
                        weekday: "long",
                        month: "long",
                        day: "numeric",
                      })}${
                        plan
                          ? `, ${plan.meal_name}${plan.completed_at ? ", completed" : ""}`
                          : ", no meal planned"
                      }`}
                    >
                      <span className="calendar-day__dow">
                        {date.toLocaleDateString(undefined, { weekday: "short" })}
                      </span>
                      <span className="calendar-day__number">{date.getDate()}</span>
                      {plan ? (
                        <span className="calendar-day__meal">{plan.meal_name}</span>
                      ) : (
                        <span className="calendar-day__add">Add</span>
                      )}
                    </button>
                  );
                })}
              </div>
              {plans.length > 0 && (
                <div className="upcoming-plans">
                  <h2>Planned meals</h2>
                  {plans.map((plan) => (
                    <div
                      className={`plan-row ${plan.completed_at ? "is-complete" : ""}`}
                      key={plan.key}
                    >
                      <label>
                        <input
                          type="checkbox"
                          checked={Boolean(plan.completed_at)}
                          onChange={(event) =>
                            toggleDisplayedPlan(plan, event.target.checked)
                          }
                        />
                        <span>
                          <strong>{plan.meal_name}</strong>
                          <small>
                            {fromDateKey(plan.plan_date).toLocaleDateString(undefined, {
                              weekday: "short",
                              month: "short",
                              day: "numeric",
                            })}
                          </small>
                        </span>
                      </label>
                      <button
                        type="button"
                        aria-label={`Remove ${plan.meal_name} from ${plan.plan_date}`}
                        onClick={() => removeDisplayedPlan(plan)}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          ))}

        {view === "shop" &&
          (!isGuest && !authenticated ? (
            <PasswordGate
              title="Shopping list is private"
              description="The shopping list is built from the meal calendar, so it uses the same household-password gate."
              checking={authStatus.isPending}
              onLogin={() => promptForLogin("Log in to view the shopping list.")}
            />
          ) : !isGuest && shoppingQuery.isPending ? (
            <div className="loading loading--inline">
              <span className="loading__mark" />
              Building the shopping list…
            </div>
          ) : !isGuest && shoppingQuery.isError ? (
            <section className="state-panel">
              <h1>Couldn’t load the shopping list</h1>
              <p>{String(shoppingQuery.error)}</p>
              <button
                type="button"
                className="secondary-action"
                onClick={() => void shoppingQuery.refetch()}
              >
                Try again
              </button>
            </section>
          ) : (
            <section aria-labelledby="shop-heading">
              {isGuest && (
                <DemoBanner
                  detail="This demo list is built only from your demo plans in this browser tab. Log in to save them and see the household's saved shopping list."
                  onLogin={() =>
                    promptForLogin("Log in to save your plans and view the household shopping list.")
                  }
                />
              )}
              <div className="section-intro compact-intro">
                <p className="kicker">From the calendar</p>
                <h1 id="shop-heading">Shopping list</h1>
                <p>
                  Ingredients from every planned meal that is not marked
                  complete. Matching ingredients and measurements are combined.
                </p>
              </div>
              {shopping.length === 0 ? (
                <div className="empty-library">
                  <h2>Nothing to shop for</h2>
                  <p>Plan a meal, or uncheck a completed meal, and its ingredients will appear here.</p>
                  <button
                    type="button"
                    className="secondary-action"
                    onClick={() => setView("plan")}
                  >
                    Open calendar
                  </button>
                </div>
              ) : (
                <div className="shopping-list">
                  {shopping.map((item) => (
                    <label className="shopping-row" key={item.key}>
                      <input type="checkbox" />
                      <span className="shopping-check" aria-hidden="true" />
                      <span>
                        <strong>
                          {[item.quantity, item.measurement, item.ingredient]
                            .filter(Boolean)
                            .join(" ")}
                        </strong>
                        {item.descriptors.length > 0 && (
                          <small>{item.descriptors.join(" · ")}</small>
                        )}
                        <small>For {item.meal_names.join(", ")}</small>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </section>
          ))}

        {view === "tags" && (
          <section aria-labelledby="tags-heading">
            <div className="section-intro compact-intro">
              <p className="kicker">Organize</p>
              <h1 id="tags-heading">Tags</h1>
              <p>
                Tags are visible to everyone. Adding or deleting one is a
                change and needs the household password.
              </p>
            </div>
            <form
              className="tag-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (tagName.trim()) {
                  requireAuth(
                    () => createTag.mutate(tagName),
                    "Adding a tag needs the household password.",
                  );
                }
              }}
            >
              <label htmlFor="new-tag">New tag</label>
              <div>
                <input
                  id="new-tag"
                  value={tagName}
                  onChange={(event) => setTagName(event.target.value)}
                  placeholder="weeknight"
                  maxLength={40}
                />
                <button disabled={!tagName.trim() || createTag.isPending}>
                  {createTag.isPending ? "Adding…" : "Add"}
                </button>
              </div>
              {createTag.isError && <p className="form-error">{String(createTag.error)}</p>}
            </form>
            <div className="tag-list">
              {tags.map((tag) => {
                const count = meals.filter((meal) => meal.tag_ids.includes(tag.id)).length;
                return (
                  <div className="tag-row" key={tag.id}>
                    <div>
                      <strong>{tag.name}</strong>
                      <span>
                        {count} {count === 1 ? "meal" : "meals"}
                      </span>
                    </div>
                    <button
                      type="button"
                      aria-label={`Delete ${tag.name} tag`}
                      onClick={() =>
                        requireAuth(
                          () => setConfirmTag(tag),
                          "Deleting a tag needs the household password.",
                        )
                      }
                    >
                      Delete
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </main>

      <nav className="bottom-nav" aria-label="Main navigation">
        {(["pick", "meals", "plan", "shop", "tags"] as const).map((item) => (
          <button
            type="button"
            key={item}
            className={view === item ? "is-current" : ""}
            aria-current={view === item ? "page" : undefined}
            onClick={() => setView(item)}
          >
            <span className={`nav-mark nav-mark--${item}`} />
            {item === "shop"
              ? "Shop"
              : item === "plan"
                ? "Plan"
                : item[0]?.toUpperCase() + item.slice(1)}
          </button>
        ))}
      </nav>

      {detailMeal && (
        <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="detail-title">
          <div className="sheet detail-sheet">
            <div className="sheet-handle" />
            <div className="detail-top">
              <div>
                <p className="kicker">{detailMeal.hidden ? "Hidden recipe" : "Recipe card"}</p>
                <h2 id="detail-title">{detailMeal.name}</h2>
              </div>
              <button
                type="button"
                className="close-button"
                aria-label="Close meal details"
                onClick={() => setDetailMeal(null)}
              >
                ×
              </button>
            </div>
            <div className="detail-ratings">
              <MealRatings meal={detailMeal} />
              <RatingEditButton
                detail
                hasRatings={
                  detailMeal.mikes_rating !== null || detailMeal.michelles_rating !== null
                }
                onClick={() => openRating(detailMeal)}
              />
            </div>

            <section className="tag-assignment" aria-labelledby="detail-tags-title">
              <h3 id="detail-tags-title">Assign tags</h3>
              <div className="chips detail-chips">
                {tags.map((tag) => (
                  <TagChip
                    key={tag.id}
                    tag={tag}
                    active={detailMeal.tag_ids.includes(tag.id)}
                    onClick={() => {
                      const nextTagIds = toggleId(detailMeal.tag_ids, tag.id);
                      requireAuth(
                        () => assignTags.mutate({ id: detailMeal.id, tagIds: nextTagIds }),
                        "Changing tag assignments needs the household password.",
                      );
                    }}
                  />
                ))}
              </div>
              {assignTags.isError && (
                <p className="form-error">{String(assignTags.error)}</p>
              )}
            </section>

            <article className="recipe-copy">
              <h3>Servings</h3>
              <p>
                <strong>Household batch.</strong> The seeded recipes were sized
                for 4–6 servings, leaving lunch portions for work.
              </p>
              <h3>Ingredients</h3>
              {detailMeal.ingredients.length ? (
                <ul className="ingredient-detail-list">
                  {detailMeal.ingredients.map((item) => (
                    <li key={item.id}>{formatIngredientLine(item)}</li>
                  ))}
                </ul>
              ) : (
                <p>{detailMeal.legacy_ingredients}</p>
              )}
              <h3>Method</h3>
              <p>{detailMeal.recipe}</p>
            </article>
            <div className="sheet-actions">
              <button
                type="button"
                className="danger-link"
                onClick={() =>
                  requireAuth(
                    () => setConfirmMeal(detailMeal),
                    "Deleting a meal needs the household password.",
                  )
                }
              >
                Delete
              </button>
              <button
                type="button"
                className="visibility-action"
                disabled={setMealHidden.isPending}
                onClick={() =>
                  requireAuth(
                    () =>
                      setMealHidden.mutate({
                        id: detailMeal.id,
                        hidden: !detailMeal.hidden,
                      }),
                    "Changing meal visibility needs the household password.",
                  )
                }
              >
                {detailMeal.hidden ? "Unhide" : "Hide"}
              </button>
              <button
                type="button"
                className="secondary-action"
                onClick={() => openEdit(detailMeal)}
              >
                Edit meal
              </button>
            </div>
          </div>
        </div>
      )}

      {ratingMeal && (
        <div
          className="overlay confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rating-editor-title"
        >
          <div className="confirm-card rating-card">
            <div className="rating-card__header">
              <div>
                <p className="kicker">Quarter-star ratings</p>
                <h2 id="rating-editor-title">Rate {ratingMeal.name}</h2>
              </div>
              <button
                type="button"
                className="close-button"
                aria-label="Close rating editor"
                onClick={() => setRatingMeal(null)}
              >
                ×
              </button>
            </div>
            <p>Set one or both ratings. The picker weights this meal using their average.</p>
            <div className="rating-editors">
              <RatingEditor
                name="Mike"
                value={ratingDraft.mikesRating}
                onChange={(value) =>
                  setRatingDraft((current) => ({ ...current, mikesRating: value }))
                }
              />
              <RatingEditor
                name="Michelle"
                value={ratingDraft.michellesRating}
                onChange={(value) =>
                  setRatingDraft((current) => ({ ...current, michellesRating: value }))
                }
              />
            </div>
            {saveRatings.isError && (
              <p className="form-error">{String(saveRatings.error)}</p>
            )}
            <div className="rating-card__actions">
              <button type="button" onClick={() => setRatingMeal(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="danger-button"
                disabled={saveRatings.isPending}
                onClick={() => saveRatings.mutate()}
              >
                {saveRatings.isPending ? "Saving…" : "Save ratings"}
              </button>
            </div>
          </div>
        </div>
      )}

      {editorOpen && (
        <div
          className="overlay editor-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="editor-title"
        >
          <form className="sheet editor-sheet" onSubmit={submitMeal}>
            <div className="sheet-handle" />
            <div className="detail-top">
              <div>
                <p className="kicker">{draft.id ? "Update card" : "New recipe card"}</p>
                <h2 id="editor-title">{draft.id ? "Edit meal" : "Add a meal"}</h2>
              </div>
              <button
                type="button"
                className="close-button"
                aria-label="Close meal editor"
                onClick={() => setEditorOpen(false)}
              >
                ×
              </button>
            </div>
            <label className="field">
              <span>Meal name</span>
              <input
                required
                maxLength={120}
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder="Chicken pot pie"
              />
            </label>
            <fieldset className="ingredient-field">
              <legend>Ingredients</legend>
              <p>Keep the ingredient canonical; put preparation notes such as “diced” in descriptor.</p>
              <div className="ingredient-editor-list">
                {draft.ingredients.map((item, index) => (
                  <div className="ingredient-editor" key={index}>
                    <label>
                      <span>Ingredient</span>
                      <input
                        required
                        value={item.ingredient}
                        onChange={(event) =>
                          updateIngredient(index, "ingredient", event.target.value)
                        }
                        placeholder="Onion"
                      />
                    </label>
                    <div className="ingredient-meta">
                      <label>
                        <span>Quantity</span>
                        <input
                          value={item.quantity}
                          onChange={(event) =>
                            updateIngredient(index, "quantity", event.target.value)
                          }
                          placeholder="1"
                        />
                      </label>
                      <label>
                        <span>Measurement</span>
                        <input
                          value={item.measurement}
                          onChange={(event) =>
                            updateIngredient(index, "measurement", event.target.value)
                          }
                          placeholder="can"
                        />
                      </label>
                    </div>
                    <label>
                      <span>Descriptor</span>
                      <input
                        value={item.descriptor}
                        onChange={(event) =>
                          updateIngredient(index, "descriptor", event.target.value)
                        }
                        placeholder="diced"
                      />
                    </label>
                    {draft.ingredients.length > 1 && (
                      <button
                        type="button"
                        className="remove-ingredient"
                        onClick={() =>
                          setDraft((current) => ({
                            ...current,
                            ingredients: current.ingredients.filter(
                              (_, itemIndex) => itemIndex !== index,
                            ),
                          }))
                        }
                      >
                        Remove ingredient
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="add-ingredient"
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    ingredients: [...current.ingredients, blankIngredient()],
                  }))
                }
              >
                + Add ingredient
              </button>
            </fieldset>
            <label className="field">
              <span>Recipe</span>
              <textarea
                required
                rows={7}
                value={draft.recipe}
                onChange={(event) => setDraft({ ...draft, recipe: event.target.value })}
                placeholder="Write the steps here…"
              />
            </label>
            <fieldset className="rating-field">
              <legend>Ratings</legend>
              <p>
                The picker uses the average of entered ratings. An unrated meal
                counts as 2.5 stars for the draw.
              </p>
              <div className="rating-editors">
                <RatingEditor
                  name="Mike"
                  value={draft.mikesRating}
                  onChange={(value) => setDraft({ ...draft, mikesRating: value })}
                />
                <RatingEditor
                  name="Michelle"
                  value={draft.michellesRating}
                  onChange={(value) => setDraft({ ...draft, michellesRating: value })}
                />
              </div>
            </fieldset>
            <fieldset className="tag-field">
              <legend>Tags</legend>
              <div className="chips">
                {tags.map((tag) => (
                  <TagChip
                    key={tag.id}
                    tag={tag}
                    active={draft.tagIds.includes(tag.id)}
                    onClick={() =>
                      setDraft({ ...draft, tagIds: toggleId(draft.tagIds, tag.id) })
                    }
                  />
                ))}
              </div>
            </fieldset>
            {saveMeal.isError && <p className="form-error">{String(saveMeal.error)}</p>}
            <div className="sticky-save">
              <button type="button" onClick={() => setEditorOpen(false)}>
                Cancel
              </button>
              <button
                className="primary-action"
                disabled={
                  saveMeal.isPending ||
                  !draft.ingredients.some((item) => item.ingredient.trim())
                }
              >
                {saveMeal.isPending ? "Saving…" : "Save meal"}
              </button>
            </div>
          </form>
        </div>
      )}

      {planDate && (
        <div
          className="overlay confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="plan-editor-title"
        >
          <div className="confirm-card plan-editor">
            <h2 id="plan-editor-title">
              {fromDateKey(planDate).toLocaleDateString(undefined, {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
            </h2>
            {activeMeals.length || plannedMealId ? (
              <>
                <label htmlFor="planned-meal">Meal</label>
                <select
                  id="planned-meal"
                  value={plannedMealId}
                  onChange={(event) => setPlannedMealId(event.target.value)}
                >
                  {meals
                    .filter((meal) => !meal.hidden || String(meal.id) === plannedMealId)
                    .map((meal) => (
                      <option value={meal.id} key={meal.id}>
                        {meal.name}
                        {meal.hidden ? " (hidden)" : ""}
                      </option>
                    ))}
                </select>
                {!isGuest && setPlan.isError && (
                  <p className="form-error">{String(setPlan.error)}</p>
                )}
                {!isGuest && removePlan.isError && (
                  <p className="form-error">{String(removePlan.error)}</p>
                )}
                <div>
                  {planByDate.get(planDate) && (
                    <button
                      type="button"
                      className="remove-plan-button"
                      disabled={!isGuest && removePlan.isPending}
                      onClick={() => {
                        const plan = planByDate.get(planDate);
                        if (plan) removeDisplayedPlan(plan);
                      }}
                    >
                      {!isGuest && removePlan.isPending
                        ? "Removing…"
                        : "Remove from calendar"}
                    </button>
                  )}
                  <button type="button" onClick={() => setPlanDate(null)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="danger-button save-plan-button"
                    disabled={!plannedMealId || (!isGuest && setPlan.isPending)}
                    onClick={submitDisplayedPlan}
                  >
                    {!isGuest && setPlan.isPending
                      ? "Saving…"
                      : planByDate.has(planDate)
                        ? "Update meal"
                        : "Plan meal"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p>Add a meal to your recipe box before planning the calendar.</p>
                <div>
                  <button type="button" onClick={() => setPlanDate(null)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="danger-button"
                    onClick={() => {
                      setPlanDate(null);
                      setView("meals");
                      openNewMeal();
                    }}
                  >
                    Add meal
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {(confirmMeal || confirmTag) && (
        <div
          className="overlay confirm-overlay"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="confirm-title"
        >
          <div className="confirm-card">
            <h2 id="confirm-title">
              Delete {confirmMeal ? confirmMeal.name : confirmTag?.name}?
            </h2>
            <p>
              {confirmMeal
                ? "This removes the recipe and any dates where it was planned."
                : "This removes the tag from every meal that uses it."}
            </p>
            <div>
              <button
                type="button"
                onClick={() => {
                  setConfirmMeal(null);
                  setConfirmTag(null);
                }}
              >
                Keep it
              </button>
              <button
                type="button"
                className="danger-button"
                disabled={removeMeal.isPending || removeTag.isPending}
                onClick={() =>
                  confirmMeal
                    ? removeMeal.mutate(confirmMeal.id)
                    : confirmTag && removeTag.mutate(confirmTag.id)
                }
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {loginOpen && (
        <div
          className="overlay confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="login-title"
        >
          <form className="confirm-card login-card" onSubmit={submitLogin}>
            <p className="kicker">Household access</p>
            <h2 id="login-title">Enter password</h2>
            <p>{loginMessage}</p>
            <label className="login-field">
              <span>Shared household password</span>
              <input
                type="password"
                autoComplete="current-password"
                autoFocus
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            {login.isError && <p className="form-error">{String(login.error)}</p>}
            <div>
              <button
                type="button"
                onClick={() => {
                  pendingActionRef.current = null;
                  setLoginOpen(false);
                  setPassword("");
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="danger-button"
                disabled={!password || login.isPending}
              >
                {login.isPending ? "Checking…" : "Log in"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
