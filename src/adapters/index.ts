import { userAdapter } from "./user";
import { organizationAdapter } from "./organization";
import type { ModelAdapter } from "./types";

/**
 * Default adapters for common Better Auth models
 */
export const defaultAdapters: ModelAdapter[] = [
	userAdapter,
	organizationAdapter,
];

export * from "./types";
export * from "./utils";
export { userAdapter } from "./user";
export { organizationAdapter } from "./organization";