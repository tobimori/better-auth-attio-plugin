import type { AuthContext } from "better-auth";

/**
 * Attio attribute types based on API documentation
 */
export type AttioAttributeType =
	| "text"
	| "number"
	| "checkbox"
	| "currency"
	| "date"
	| "timestamp"
	| "rating"
	| "status"
	| "select"
	| "record-reference"
	| "actor-reference"
	| "location"
	| "domain"
	| "email-address"
	| "phone-number";

/**
 * Attio field schema for attribute creation
 */
export type AttioFieldSchema = {
	type: AttioAttributeType;
	title?: string;
	description?: string;
	is_required?: boolean;
	is_unique?: boolean;
	is_multiselect?: boolean;
	config?: {
		// For record-reference type
		allowed_objects?: string[];
		// For currency type
		default_currency_code?: string;
		display_type?: "code" | "name" | "narrowSymbol" | "symbol";
	};
};

/**
 * Attio values that can be sent to/from Attio
 */
export type AttioValues = Record<string, unknown> & {
	_deleted?: boolean; // Special flag for deletions
	record_id?: string; // Attio record ID
};

export type SyncEvent = "create" | "update" | "delete";

/**
 * Model adapter interface for bidirectional sync
 */
export interface ModelAdapter {
	// Model identifiers
	betterAuthModel: string; // e.g., "user", "organization"
	attioObject: string; // e.g., "users", "workspaces"
	
	// Define which related models should trigger this adapter
	// e.g., { member: (values) => values.organizationId }
	relatedModels?: Record<string, (values: Record<string, unknown>) => string | null>;

	// Transform Better Auth data to Attio format
	toAttio: (
		event: SyncEvent,
		values: Record<string, unknown>,
		context: AuthContext,
	) => Promise<AttioValues | null>;

	// Transform Attio data to Better Auth format
	fromAttio: (
		event: SyncEvent,
		values: Record<string, unknown>,
		context: AuthContext,
	) => Promise<Record<string, unknown> | null>;

	// Attio schema definition for auto-creation
	attioSchema: Record<string, AttioFieldSchema>;

	// Sync behavior configuration
	onMissing?: "create" | "delete" | "ignore";
	syncDeletions?: boolean;
}
