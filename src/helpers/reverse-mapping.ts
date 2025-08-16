import type { FieldMapping } from "./field-mappings";
import { getMergedFieldMappings } from "./field-mappings";

/**
 * Get reverse mapping from Attio object to Better Auth model
 * Returns a map of Attio object slug -> { model, fields }
 */
export function getReverseFieldMapping(
	customMappings?: Record<string, Partial<FieldMapping>>,
): Record<string, { model: string; fields: Record<string, string> }> {
	const fieldMappings = getMergedFieldMappings(customMappings);
	const reverseMapping: Record<
		string,
		{ model: string; fields: Record<string, string> }
	> = {};

	// iterate through all field mappings
	for (const [model, mapping] of Object.entries(fieldMappings)) {
		if (!mapping) continue;

		// create reverse field mapping (attio field -> better auth field)
		const reverseFields: Record<string, string> = {};
		for (const [betterAuthField, attioField] of Object.entries(
			mapping.fields,
		)) {
			reverseFields[attioField] = betterAuthField;
		}

		// map attio object slug to better auth model
		reverseMapping[mapping.object] = {
			model,
			fields: reverseFields,
		};
	}

	return reverseMapping;
}

/**
 * Extract the actual value from Attio's field format
 * Attio returns values as arrays with history/metadata
 */
function extractAttioValue(fieldData: unknown): unknown {
	// if it's an array with at least one item
	if (Array.isArray(fieldData) && fieldData.length > 0) {
		const firstItem = fieldData[0];

		// handle different attribute types
		if (firstItem.attribute_type === "email-address") {
			// for email, use the email_address field
			return firstItem.email_address;
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
 * Map Attio record data to Better Auth model data
 * Converts field names from Attio to Better Auth and extracts values
 */
export function mapAttioDataToBetterAuth(
	attioData: Record<string, unknown>,
	fieldMapping: Record<string, string>,
): Record<string, unknown> {
	const mappedData: Record<string, unknown> = {};

	for (const [attioField, fieldData] of Object.entries(attioData)) {
		const betterAuthField = fieldMapping[attioField];
		if (betterAuthField === "id") continue;
		if (betterAuthField) {
			const value = extractAttioValue(fieldData);
			// only include non-null values
			if (value !== null) {
				mappedData[betterAuthField] = value;
			}
		}
	}

	return mappedData;
}
