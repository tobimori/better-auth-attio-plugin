import type { User } from "better-auth";
import {
	type BetterAuthPlugin,
	createAuthEndpoint,
	type Member,
	type Organization,
} from "better-auth/plugins";
import { z } from "zod";
import type { FieldMapping } from "./helpers/field-mappings";
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
	};

	/**
	 *
	 */
	organization?: boolean;

	/**
	 *
	 */
	admin?: boolean;

	/**
	 *
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
								await sendWebhookEvent(ctx.adapter, opts, "user.created", user);
							},
						},
						update: {
							after: async (user: Partial<User>) => {
								await sendWebhookEvent(ctx.adapter, opts, "user.updated", user);
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
						webhookUrl: z.url(),
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
					// validate using secret from body
					const { secret: _, ...webhookData } = ctx.body;

					const error = validateSecret(opts, ctx);
					if (error) return error;

					console.log(
						"[Attio Webhook] Full event data:",
						JSON.stringify(webhookData, null, 2),
					);

					return ctx.json({ success: true });
				},
			),
		},
	} satisfies BetterAuthPlugin;
};
