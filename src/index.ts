import type { AuthContext, EndpointContext, Method } from "better-auth";
import { type BetterAuthPlugin, createAuthEndpoint } from "better-auth/plugins";
import { z } from "zod";

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
};

export const attio = (opts: AttioPluginOptions) => {
	const validateSecret = (
		ctx: EndpointContext<
			string,
			{
				method: Method;
				body: z.ZodObject<{
					secret: z.ZodString;
				}>;
			},
			AuthContext
		>,
	) => {
		const secret = opts.secret || ctx.context.secret;
		if (secret && ctx.body.secret !== secret) {
			return ctx.error("UNAUTHORIZED");
		}
		return null;
	};

	return {
		id: "attio",
		schema: {
			// this stores our webhook url
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
					const error = validateSecret(ctx);
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
					const error = validateSecret(ctx);
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
		},
	} satisfies BetterAuthPlugin;
};
