export type CreateDatabasePhase = "editing" | "creating" | "created" | "connecting";

export type CreateDatabaseFlowState = {
  phase: CreateDatabasePhase;
  name: string;
  createError: string | null;
  connectError: string | null;
  refreshError: string | null;
};

export type CreateDatabaseFlowAction =
  | { type: "submit"; name: string }
  | { type: "nameChanged"; name: string }
  | { type: "createSucceeded" }
  | { type: "createFailed"; message: string }
  | { type: "refreshFailed"; message: string }
  | { type: "connectRequested" }
  | { type: "connectSucceeded" }
  | { type: "connectFailed"; message: string }
  | { type: "reset" };

export const initialCreateDatabaseFlow: CreateDatabaseFlowState = {
  phase: "editing",
  name: "",
  createError: null,
  connectError: null,
  refreshError: null,
};

export function reduceCreateDatabaseFlow(
  state: CreateDatabaseFlowState,
  action: CreateDatabaseFlowAction,
): CreateDatabaseFlowState {
  switch (action.type) {
    case "nameChanged":
      if (state.phase !== "editing") return state;
      return { ...state, name: action.name, createError: null };
    case "submit": {
      const name = action.name.trim();
      if (state.phase !== "editing" || name === "") return state;
      return {
        ...state,
        phase: "creating",
        name,
        createError: null,
        connectError: null,
        refreshError: null,
      };
    }
    case "createSucceeded":
      if (state.phase !== "creating") return state;
      return {
        ...state,
        phase: "created",
        createError: null,
      };
    case "createFailed":
      if (state.phase !== "creating") return state;
      return {
        ...state,
        phase: "editing",
        createError: action.message,
      };
    case "refreshFailed":
      if (state.phase !== "creating" && state.phase !== "created") return state;
      return {
        ...state,
        phase: "created",
        refreshError: action.message,
      };
    case "connectRequested":
      if (state.phase !== "created") return state;
      return {
        ...state,
        phase: "connecting",
        connectError: null,
      };
    case "connectSucceeded":
      if (state.phase !== "connecting") return state;
      return {
        ...state,
        phase: "created",
        connectError: null,
      };
    case "connectFailed":
      if (state.phase !== "connecting") return state;
      return {
        ...state,
        phase: "created",
        connectError: action.message,
      };
    case "reset":
      return initialCreateDatabaseFlow;
  }
}
