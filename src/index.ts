import type { User } from "better-auth";
import {
	type BetterAuthPlugin,
	createAuthEndpoint,
	type Member,
	type Organization,
} from "better-auth/plugins";
import { z } from "zod";
import { validateSecret } from "./helpers/secret";
import { sendWebhookEvent } from "./helpers/send-event";
import { validateWebhookSignature } from "./helpers/webhook";

export type AttioPluginOptions = {
	/**
	 *
	 */
	secret?: string;

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
					webhookSecret: {
						type: "string",
						required: true,
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
						webhookSecret: z.string(),
					}),
				},
				async (ctx) => {
					const error = validateSecret(opts, ctx);
					if (error) return error;

					const webhook = await ctx.context.adapter.create({
						model: "attioIntegration",
						data: {
							webhookUrl: ctx.body.webhookUrl,
							webhookSecret: ctx.body.webhookSecret,
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
					body: z.any(),
					requireHeaders: true,
				},
				async (ctx) => {
					// get signature from headers
					const signature =
						ctx.headers?.get("attio-signature") ||
						ctx.headers?.get("x-attio-signature");

					if (!signature || typeof signature !== "string") {
						return ctx.error("UNAUTHORIZED", { message: "Missing signature" });
					}

					// validate webhook signature
					const bodyString = JSON.stringify(ctx.body);
					const isValid = await validateWebhookSignature(
						ctx.context.adapter,
						signature,
						bodyString,
					);

					if (!isValid) {
						return ctx.error("UNAUTHORIZED", { message: "Invalid signature" });
					}

					console.log(
						"[Attio Webhook] Full event data:",
						JSON.stringify(ctx.body, null, 2),
					);

					return ctx.json({ success: true });
				},
			),
		},
	} satisfies BetterAuthPlugin;
};
