import type { User } from "better-auth";
import {
	type BetterAuthPlugin,
	createAuthEndpoint,
	type Member,
	type Organization,
} from "better-auth/plugins";
import { z } from "zod";
import type { FieldMapping } from "./helpers/field-mappings";
import {
	getReverseFieldMapping,
	mapAttioDataToBetterAuth,
} from "./helpers/reverse-mapping";
import { validateSecret } from "./helpers/secret";
import { sendWebhookEvent } from "./helpers/send-event";

export type AttioPluginOptions = {
	/**
	 * Secret key for securing webhook endpoints
	 */
	secret?: string;

	/**
	 * Attio object configuration for syncing Better Auth data
	 * Maps Better Auth models to Attio objects with field mappings
	 * Fields will be automatically created in Attio if they don't exist
	 */
	objects?: {
		user?: Partial<FieldMapping>;
		workspace?: Partial<FieldMapping>;
		/**
		 * Additional custom objects to sync
		 * Key is the Better Auth model name
		 */
		[key: string]: Partial<FieldMapping> | undefined;
	}; // TODO: adapter pattern.

	/**
	 * What to do when a record from Attio doesn't exist in Better Auth
	 * - 'create': Create a new record in Better Auth (default)
	 * - 'delete': Delete the orphaned record from Attio
	 * - 'ignore': Skip and log
	 * @default 'create'
	 */
	onMissing?: "create" | "delete" | "ignore";

	/**
	 * Whether to sync deletions between systems
	 * When true, deleting a record in one system will delete it in the other
	 * @default true
	 */
	syncDeletions?: boolean;

	/**
	 * Set this to true if the organization plugin is installed
	 */
	organization?: boolean;

	/**
	 * Set this to true if the admin plugin is installed
	 */
	admin?: boolean;

	/**
	 * Optional handler to schedule work to run after the response is sent.
	 *
	 * @see https://vercel.com/docs/functions#advanced/using-waituntil
	 * @see https://vercel.com/changelog/waituntil-is-now-available-for-vercel-functions
	 */
	waitUntil?: (promise: Promise<unknown>) => void;
};

export const attio = (opts: AttioPluginOptions) => {
	return {
		id: "attio",
		init: (ctx) => ({
			options: {
				databaseHooks: {
					user: {
						create: {
							after: async (user: Partial<User>) => {
								await sendWebhookEvent(
									ctx.adapter,
									opts,
									"user.created",
									user,
									ctx.tables.user?.fields,
								);
							},
						},
						update: {
							after: async (user: Partial<User>) => {
								await sendWebhookEvent(
									ctx.adapter,
									opts,
									"user.updated",
									user,
									ctx.tables.user?.fields,
								);
							},
						},
					},

					...(opts.organization
						? {
								organization: {
									create: {
										after: async (organization: Partial<Organization>) => {
											await sendWebhookEvent(
												ctx.adapter,
												opts,
												"organization.created",
												organization,
												ctx.tables.organization?.fields,
											);
										},
									},
									update: {
										after: async (organization: Partial<Organization>) => {
											await sendWebhookEvent(
												ctx.adapter,
												opts,
												"organization.updated",
												organization,
												ctx.tables.organization?.fields,
											);
										},
									},
								},
								member: {
									create: {
										after: async (member: Partial<Member>) => {
											await sendWebhookEvent(
												ctx.adapter,
												opts,
												"member.created",
												member,
												ctx.tables.member?.fields,
											);
										},
									},
									update: {
										after: async (member: Partial<Member>) => {
											await sendWebhookEvent(
												ctx.adapter,
												opts,
												"member.updated",
												member,
												ctx.tables.member?.fields,
											);
										},
									},
								},
							}
						: {}),
				},
			},
		}),
		schema: {
			// this stores our webhook url and secret
			// for the sync endpoint
			attioIntegration: {
				fields: {
					webhookUrl: {
						type: "string",
						required: true,
						unique: true,
					},
				},
			},

			user: {
				fields: {
					attioId: {
						type: "string",
						required: false,
						unique: true,
					},
				},
			},

			...(opts.organization
				? {
						organization: {
							fields: {
								attioId: {
									type: "string",
									required: false,
									unique: true,
								},
							},
						},
					}
				: {}),
		},
		endpoints: {
			/**
			 * Link Attio integration event
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
			 * Unlink Attio integration event
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

					const onMissing = opts.onMissing || "create";
					const syncDeletions = opts.syncDeletions !== false;

					const reverseMapping = getReverseFieldMapping(opts.objects);

					for (const event of ctx.body.events) {
						try {
							const eventType = event.event_type;
							const record = event.record;
							const object = event.object;

							if (!record || !object) continue;

							const modelMapping = reverseMapping[object.api_slug];
							if (!modelMapping) continue;

							const attioId = record.id.record_id;

							const mappedData = mapAttioDataToBetterAuth(
								record.values,
								modelMapping.fields,
							);

							// always include attioId in mapped data
							mappedData.attioId = attioId;

							if (
								eventType === "record.created" ||
								eventType === "record.updated"
							) {
								// check for existing record by attioId or by the actual id
								let existing = (await ctx.context.adapter.findOne({
									model: modelMapping.model,
									where: [{ field: "attioId", value: attioId }],
								})) as { id: string; [key: string]: unknown };

								// if not found by attioId and we have an id in the mapped data, check by id
								if (!existing && mappedData.id) {
									existing = (await ctx.context.adapter.findOne({
										model: modelMapping.model,
										where: [{ field: "id", value: mappedData.id as string }],
									})) as { id: string; [key: string]: unknown };
								}

								if (existing) {
									// check if there are actual changes (excluding id which can't be updated)
									const changes: Record<string, unknown> = {};
									for (const [key, value] of Object.entries(mappedData)) {
										// skip id field - it's immutable
										if (key === "id") continue;

										if (existing[key] !== value) {
											changes[key] = value;
										}
									}

									// only update if there are changes
									if (Object.keys(changes).length > 0) {
										await ctx.context.adapter.update({
											model: modelMapping.model,
											where: [{ field: "id", value: existing.id }],
											update: changes,
										});
									}
								} else if (eventType === "record.created") {
									// always create on record.created
									const createData = {
										...mappedData,
										attioId,
									};

									const created = await ctx.context.adapter.create({
										model: modelMapping.model,
										data: createData,
									});

									// send webhook event with full created record data
									if (created) {
										await sendWebhookEvent(
											ctx.context.adapter,
											opts,
											`${modelMapping.model}.created` as any,
											created,
											ctx.context.tables?.[modelMapping.model]?.fields,
										);
									}
								} else if (eventType === "record.updated") {
									if (onMissing === "create") {
										// create new record if onMissing is 'create'
										const created = await ctx.context.adapter.create({
											model: modelMapping.model,
											data: {
												...mappedData,
												attioId,
											},
										});

										// send webhook event with full created record data
										if (created) {
											await sendWebhookEvent(
												ctx.context.adapter,
												opts,
												`${modelMapping.model}.created` as any,
												created,
												ctx.context.tables?.[modelMapping.model]?.fields,
											);
										}
									} else if (onMissing === "delete") {
										// send delete event back to Attio to remove orphaned record
										await sendWebhookEvent(
											ctx.context.adapter,
											opts,
											`${modelMapping.model}.deleted` as any,
											{ attioId },
										);
									}
									// if onMissing is 'ignore', do nothing
								}
							} else if (eventType === "record.deleted" && syncDeletions) {
								await ctx.context.adapter.delete({
									model: modelMapping.model,
									where: [{ field: "attioId", value: attioId }],
								});
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
						await ctx.context.internalAdapter.deleteSession(
							ctx.body.sessionToken,
						);

						return ctx.json({
							success: true,
							message: "Session revoked successfully",
						});
					} catch (_) {
						return ctx.json({
							success: false,
							message: "Failed to revoke session",
						});
					}
				},
			),
		},
	} satisfies BetterAuthPlugin;
};
