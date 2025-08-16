/**
 * Default field mappings for Better Auth models to Attio objects
 * These map Better Auth's standard fields to commonly used Attio attribute names
 */
export const defaultFieldMappings = {
	user: {
		object: "users",
		fields: {
			id: "user_id",
			name: "name",
			email: "primary_email_address",
			emailVerified: "email_verified",
		},
	},
	organization: {
		object: "workspaces",
		fields: {
			id: "workspace_id",
			name: "name",
			slug: "slug",
			logo: "avatar_url",
		},
	},
};

export type FieldMapping = {
	/**
	 * The Attio object ID or slug to sync to
	 */
	object: string;
	/**
	 * Field mappings from Better Auth fields to Attio attributes
	 * Key: Better Auth field name, Value: Attio attribute name
	 */
	fields: Record<string, string>;
};

export type FieldMappings = Record<string, FieldMapping>;

/**
 * Merges default field mappings with user-provided custom mappings
 */
export function getMergedFieldMappings(
	customMappings?: Record<string, Partial<FieldMapping>>,
): FieldMappings {
	if (!customMappings) {
		return defaultFieldMappings;
	}

	const merged: FieldMappings = { ...defaultFieldMappings };

	for (const [model, config] of Object.entries(customMappings)) {
		if (config) {
			const defaultMapping = defaultFieldMappings[model as keyof typeof defaultFieldMappings];
			merged[model] = {
				object: config.object || defaultMapping?.object || model,
				fields: {
					...(defaultMapping?.fields || {}),
					...config.fields,
				},
			};
		}
	}

	return merged;
}

/**
 * Maps Better Auth field types to Attio attribute types
 */
export function mapFieldTypeToAttio(betterAuthType: string): string {
	const typeMap: Record<string, string> = {
		string: "text",
		number: "number",
		boolean: "checkbox",
		date: "date",
		datetime: "timestamp",
		json: "text", // attio doesn't have native json, use text
	};

	return typeMap[betterAuthType] || "text";
}
