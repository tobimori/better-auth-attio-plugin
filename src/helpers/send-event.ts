import type { Adapter, User } from "better-auth";
import type { Member, Organization } from "better-auth/plugins";
import type { AttioPluginOptions } from "../index";

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
) => {
	try {
		// get all registered webhooks
		const webhooks = await adapter.findMany({
			model: "attioIntegration",
		});

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