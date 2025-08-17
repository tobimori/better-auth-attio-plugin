/**
 * Extract the actual value from Attio's field format
 * Attio returns values as arrays with history/metadata
 */
export function extractAttioValue(fieldData: unknown): unknown {
  if (!Array.isArray(fieldData) || fieldData.length === 0) {
    return null
  }

  const extractSingleValue = (item: any) => {
    if (item.attribute_type === "email-address") {
      return item.email_address
    } else if (item.attribute_type === "phone-number") {
      return item.phone_number || item.original_phone_number
    } else if (item.attribute_type === "record-reference") {
      return item.target_record_id
    } else if (item.attribute_type === "personal-name") {
      return item.full_name
    } else if ("value" in item) {
      return item.value
    } else if ("referenced_actor_id" in item) {
      return item.referenced_actor_id
    }
    return null
  }

  if (fieldData.length === 1) {
    return extractSingleValue(fieldData[0])
  }

  return fieldData.map(extractSingleValue)
}

/**
 * Deep merge two objects, with the second object taking precedence
 */
export function deepMerge<T extends Record<string, any>>(target: T, source: Partial<T>): T {
  const result = {...target}

  for (const key in source) {
    const sourceValue = source[key]
    const targetValue = target[key]

    if (sourceValue === undefined) {
      continue
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
      result[key] = deepMerge(targetValue, sourceValue)
    } else {
      // overwrite with source value
      result[key] = sourceValue as T[typeof key]
    }
  }

  return result
}

/**
 * Generate a slug from a name
 */
export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 50)
}

/**
 * Generate a unique slug by appending a random suffix
 */
export function generateUniqueSlug(name: string): string {
  const base = generateSlug(name)
  const suffix = Math.random().toString(36).substring(2, 8)
  return `${base}-${suffix}`
}
