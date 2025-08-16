import type { Adapter, User } from "better-auth";
import type { Member, Organization } from "better-auth/plugins";
import type { AttioPluginOptions } from "../index";
import { getMergedFieldMappings } from "./field-mappings";

export const sendWebhookEvent = async <T extends string>(
	adapter: Adapter,
	opts: AttioPluginOptions,
	event: T,
	data: T extends "user.created" | "user.updated"
		? Partial<User>
		: T extends "organization.created" | "organization.updated"
			? Partial<Organization>
			: T extends "member.created" | "member.updated"
				? Partial<Member>
				: unknown,
	// pass schema from context
	schema?: Record<string, any>,
) => {
	try {
		// get all registered webhooks
		const webhooks = await adapter.findMany({
			model: "attioIntegration",
		});

		// get merged field mappings
		const fieldMappings = getMergedFieldMappings(opts.objects);

		// extract model name from event (e.g., "user.created" -> "user")
		const modelName = event.split(".")[0];

		// get the field mapping for this model
		const fieldMapping = fieldMappings[modelName];

		// if we have a field mapping and schema, add the schema info
		if (fieldMapping && schema) {
			// extract type information for mapped fields only
			const fieldTypes: Record<string, string> = {};

			for (const [betterAuthField, attioField] of Object.entries(
				fieldMapping.fields,
			)) {
				const fieldSchema = schema[betterAuthField];
				if (fieldSchema?.type) {
					fieldTypes[attioField] = fieldSchema.type;
				}
			}

			fieldMapping.schema = fieldTypes;
		}

		// send event to each webhook
		const promises = webhooks.map(async (webhook: any) => {
			try {
				const response = await fetch(webhook.webhookUrl, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						event,
						data,
						timestamp: new Date().toISOString(),
						fieldMapping: fieldMapping || null,
					}),
				});

				if (!response.ok) {
					console.error(`Webhook delivery failed: ${response.status}`);
				}
			} catch (error) {
				console.error("Failed to deliver webhook to Attio:", error);
			}
		});

		// use waitUntil if available, otherwise await
		if (opts.waitUntil) {
			opts.waitUntil(Promise.all(promises));
		} else {
			await Promise.all(promises);
		}
	} catch (error) {
		console.error("Error sending webhooks:", error);
	}
};
