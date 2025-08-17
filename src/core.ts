import { createAuthEndpoint } from "better-auth/plugins";
import z from "zod";
import type { AttioPluginOptions } from ".";
import type { ModelAdapter, SyncEvent } from "./adapters/types";
import { extractAttioValue } from "./adapters/utils";
import { validateSecret } from "./helpers/secret";
import { sendWebhookEvent } from "./helpers/send-event";

export const endpoints = (opts: AttioPluginOptions) => ({
	/**
	 * Link Attio integration
	 */
	linkAttio: createAuthEndpoint(
		"/attio/link",
		{
			method: "POST",
			body: z.object({
				secret: z.string(),
				webhookUrl: z.string(),
			}),
		},
		async (ctx) => {
			const error = validateSecret(opts, ctx);
			if (error) return error;

			const webhook = await ctx.context.adapter.create({
				model: "attioIntegration",
				data: {
					webhookUrl: ctx.body.webhookUrl,
				},
			});

			return ctx.json({
				webhookId: webhook.id,
			});
		},
	),

	/**
	 * Unlink Attio integration
	 */
	unlinkAttio: createAuthEndpoint(
		"/attio/unlink",
		{
			method: "POST",
			body: z.object({
				secret: z.string(),
				webhookId: z.string(),
			}),
		},
		async (ctx) => {
			const error = validateSecret(opts, ctx);
			if (error) return error;

			// find and delete the webhook registration
			const webhook = await ctx.context.adapter.findOne({
				model: "attioIntegration",
				where: [
					{
						field: "id",
						value: ctx.body.webhookId,
					},
				],
			});

			if (!webhook) {
				return ctx.error("NOT_FOUND");
			}

			await ctx.context.adapter.delete({
				model: "attioIntegration",
				where: [
					{
						field: "id",
						value: ctx.body.webhookId,
					},
				],
			});

			return ctx.json({
				success: true,
			});
		},
	),

	/**
	 * Receive webhook events from Attio
	 * E.g. record updates
	 */
	attioWebhook: createAuthEndpoint(
		"/attio/webhook",
		{
			method: "POST",
			body: z.object({
				webhook_id: z.string(),
				events: z.array(z.any()),
				secret: z.string(),
			}),
		},
		async (ctx) => {
			const error = validateSecret(opts, ctx);
			if (error) return error;

			for (const event of ctx.body.events) {
				try {
					const eventType = event.event_type;
					const record = event.record;
					const object = event.object;

					if (!record || !object) continue;

					// find the adapter for this Attio object
					let adapter: ModelAdapter | undefined;
					for (const modelAdapter of opts.adapters ?? []) {
						if (modelAdapter.attioObject === object.api_slug) {
							adapter = modelAdapter;
							break;
						}
					}

					if (!adapter) continue;

					const attioId = record.id.record_id;

					// extract values from Attio format
					const extractedValues: Record<string, unknown> = {
						record_id: attioId,
					};
					for (const [key, value] of Object.entries(record.values)) {
						extractedValues[key] = extractAttioValue(value);
					}

					// determine sync event type
					let syncEvent: SyncEvent;
					if (eventType === "record.created") {
						syncEvent = "create";
					} else if (eventType === "record.updated") {
						syncEvent = "update";
					} else if (eventType === "record.deleted") {
						syncEvent = "delete";
					} else {
						continue;
					}

					// use adapter to transform data
					const result = await adapter.fromAttio(
						syncEvent,
						extractedValues,
						ctx.context,
					);

					// if adapter returned null, it handled everything itself
					if (result === null) {
						continue;
					}

					// handle default flow based on sync event
					if (syncEvent === "delete") {
						if (adapter.syncDeletions !== false) {
							const existing = (await ctx.context.adapter.findOne({
								model: adapter.betterAuthModel,
								where: [{ field: "attioId", value: attioId }],
							})) as Record<string, unknown> | null;

							if (existing) {
								await ctx.context.adapter.delete({
									model: adapter.betterAuthModel,
									where: [{ field: "id", value: existing.id as string }],
								});
							}
						}
					} else if (syncEvent === "create" || syncEvent === "update") {
						// check for existing record
						const existing = (await ctx.context.adapter.findOne({
							model: adapter.betterAuthModel,
							where: [{ field: "attioId", value: attioId }],
						})) as Record<string, unknown> | null;

						// handle onMissing behavior
						const onMissing = adapter.onMissing || "create";

						if (existing) {
							// update existing record
							const updateData = { ...result };
							delete updateData.id; // can't update ID
							delete updateData.createdAt; // can't update createdAt

							if (Object.keys(updateData).length > 0) {
								const updated = (await ctx.context.adapter.update({
									model: adapter.betterAuthModel,
									where: [{ field: "id", value: existing.id as string }],
									update: updateData,
								})) as Record<string, unknown>;

								// trigger webhook for update
								if (updated) {
									await sendWebhookEvent(
										"update",
										updated,
										adapter,
										ctx.context,
										opts,
									);
								}
							}
						} else if (syncEvent === "create" || onMissing === "create") {
							// create new record
							const created = await ctx.context.adapter.create({
								model: adapter.betterAuthModel,
								data: result,
								forceAllowId: true,
							});

							// trigger webhook for creation
							if (created) {
								await sendWebhookEvent(
									"create",
									created,
									adapter,
									ctx.context,
									opts,
								);
							}
						} else if (onMissing === "delete") {
							// send delete event back to Attio to remove orphaned record
							await sendWebhookEvent(
								"delete",
								{ attioId },
								adapter,
								ctx.context,
								opts,
							);
						}
						// if onMissing is 'ignore', do nothing
					}
				} catch (error) {
					console.error(`Error processing event:`, error);
				}
			}

			return ctx.json({ success: true });
		},
	),

	/**
	 * Get user sessions by userId
	 */
	getUserSessions: createAuthEndpoint(
		"/attio/sessions",
		{
			method: "POST",
			body: z.object({
				secret: z.string(),
				userId: z.string(),
			}),
		},
		async (ctx) => {
			const error = validateSecret(opts, ctx);
			if (error) return error;

			const sessions = await ctx.context.internalAdapter.listSessions(
				ctx.body.userId,
			);

			const now = new Date();
			const activeSessions = sessions.filter(
				(s) => !s.expiresAt || new Date(s.expiresAt) > now,
			);

			return ctx.json({
				sessions: [...sessions].sort((a, b) => {
					const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
					const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
					return tb - ta;
				}),
				totalCount: sessions.length,
				activeCount: activeSessions.length,
			});
		},
	),

	/**
	 * Revoke a user session by token
	 */
	revokeSession: createAuthEndpoint(
		"/attio/revoke-session",
		{
			method: "POST",
			body: z.object({
				secret: z.string(),
				sessionToken: z.string(),
			}),
		},
		async (ctx) => {
			const error = validateSecret(opts, ctx);
			if (error) return error;

			try {
				await ctx.context.internalAdapter.deleteSession(ctx.body.sessionToken);

				return ctx.json({
					success: true,
				});
			} catch (_) {
				return ctx.error("INTERNAL_SERVER_ERROR");
			}
		},
	),
});
