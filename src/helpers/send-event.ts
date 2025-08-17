import type { AuthContext } from "better-auth";
import type { ModelAdapter, SyncEvent } from "../adapters/types";
import type { AttioPluginOptions } from "../index";

export const sendWebhookEvent = async (
	event: SyncEvent,
	data: Record<string, unknown>,
	modelAdapter: ModelAdapter,
	ctx: AuthContext,
	opts: AttioPluginOptions,
) => {
	try {
		// Transform data to Attio format
		const attioData = await modelAdapter.toAttio(event, data, ctx);
		if (!attioData) {
			return; // Adapter chose not to sync this event
		}

		// Get all registered webhooks
		const webhooks = await ctx.adapter.findMany({
			model: "attioIntegration",
		});

		// Send to each webhook
		const promises = webhooks.map(async (webhook: any) => {
			try {
				const response = await fetch(webhook.webhookUrl, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						event,
						data: attioData,
						timestamp: new Date().toISOString(),
						adapter: {
							betterAuthModel: modelAdapter.betterAuthModel,
							attioObject: modelAdapter.attioObject,
							attioSchema: modelAdapter.attioSchema,
						},
					}),
				});

				if (!response.ok) {
					console.error(`Webhook delivery failed: ${response.status}`);
				}
			} catch (error) {
				console.error("Failed to deliver webhook to Attio:", error);
			}
		});

		if (opts.waitUntil) {
			opts.waitUntil(Promise.all(promises));
		} else {
			await Promise.all(promises);
		}
	} catch (error) {
		console.error("Error sending webhooks:", error);
	}
};
