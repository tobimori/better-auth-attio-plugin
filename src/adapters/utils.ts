/**
 * Extract the actual value from Attio's field format
 * Attio returns values as arrays with history/metadata
 */
export function extractAttioValue(fieldData: unknown): unknown {
	// if it's an array with at least one item
	if (Array.isArray(fieldData) && fieldData.length > 0) {
		const firstItem = fieldData[0];

		// handle different attribute types based on Attio's response format
		if (firstItem.attribute_type === "email-address") {
			// for email, use the email_address field
			return firstItem.email_address;
		} else if (firstItem.attribute_type === "phone-number") {
			// for phone numbers
			return firstItem.phone_number || firstItem.original_phone_number;
		} else if (firstItem.attribute_type === "record-reference") {
			// for record references, return the target record ID
			return firstItem.target_record_id;
		} else if (firstItem.attribute_type === "personal-name") {
			// for personal names, return the full name
			return firstItem.full_name;
		} else if ("value" in firstItem) {
			// for most fields, use the value property
			return firstItem.value;
		} else if ("referenced_actor_id" in firstItem) {
			// for actor references, use the referenced actor id
			return firstItem.referenced_actor_id;
		}
	}

	// if empty array or not an array, return null
	return null;
}

/**
 * Deep merge two objects, with the second object taking precedence
 */
export function deepMerge<T extends Record<string, any>>(
	target: T,
	source: Partial<T>,
): T {
	const result = { ...target };

	for (const key in source) {
		const sourceValue = source[key];
		const targetValue = target[key];

		if (sourceValue === undefined) {
			continue;
		}

		if (
			sourceValue !== null &&
			typeof sourceValue === "object" &&
			!Array.isArray(sourceValue) &&
			targetValue !== null &&
			typeof targetValue === "object" &&
			!Array.isArray(targetValue)
		) {
			// recursively merge objects
			result[key] = deepMerge(targetValue, sourceValue);
		} else {
			// overwrite with source value
			result[key] = sourceValue as T[typeof key];
		}
	}

	return result;
}

/**
 * Generate a slug from a name
 */
export function generateSlug(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.substring(0, 50);
}

/**
 * Generate a unique slug by appending a random suffix
 */
export function generateUniqueSlug(name: string): string {
	const base = generateSlug(name);
	const suffix = Math.random().toString(36).substring(2, 8);
	return `${base}-${suffix}`;
}
