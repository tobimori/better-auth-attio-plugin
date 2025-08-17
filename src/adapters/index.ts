import {organizationAdapter} from "./organization.js"
import type {ModelAdapter} from "./types.js"
import {userAdapter} from "./user.js"

/**
 * Default adapters for common Better Auth models
 */
export const defaultAdapters: ModelAdapter[] = [userAdapter, organizationAdapter]
