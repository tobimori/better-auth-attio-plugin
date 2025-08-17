import type { BetterAuthPlugin } from "better-auth/plugins";
import { getAdapters } from "./adapters/helpers";
import type { ModelAdapter } from "./adapters/types";
import { endpoints as adminEndpoints } from "./admin";
import { endpoints } from "./core";
import { sendWebhookEvent } from "./helpers/send-event";
import { endpoints as organizationEndpoints } from "./organization";

export type AttioPluginOptions = {
	/**
	 * Secret key for securing webhook endpoints
	 */
	secret?: string;

	/**
	 * Model adapters for bidirectional sync
	 * Each adapter handles transformation and sync logic for a specific model
	 * Defaults are provided for user and organization models
	 */
	adapters?: ModelAdapter[];

	/**
	 * Optional handler to schedule work to run after the response is sent.
	 *
	 * @see https://vercel.com/docs/functions#advanced/using-waituntil
	 * @see https://vercel.com/changelog/waituntil-is-now-available-for-vercel-functions
	 */
	waitUntil?: (promise: Promise<unknown>) => void;
};

export const attio = (opts: AttioPluginOptions) => {
	const adapters = getAdapters(opts.adapters);

	return {
		id: "attio",
		init: (ctx) => ({
			options: {
				databaseHooks: (() => {
					const hooks: Record<string, any> = {};

					// Create hooks for each adapter's main model
					for (const adapter of adapters) {
						hooks[adapter.betterAuthModel] = {
							create: {
								after: async (data: Record<string, unknown>) => {
									await sendWebhookEvent("create", data, adapter, ctx, opts);
								},
							},
							update: {
								after: async (data: Record<string, unknown>) => {
									await sendWebhookEvent("update", data, adapter, ctx, opts);
								},
							},
							delete: {
								after: async (data: Record<string, unknown>) => {
									await sendWebhookEvent("delete", data, adapter, ctx, opts);
								},
							},
						};
					}

					// Create hooks for related models
					for (const adapter of adapters) {
						if (adapter.relatedModels) {
							for (const [model, getRelationId] of Object.entries(
								adapter.relatedModels,
							)) {
								if (!hooks[model]) {
									hooks[model] = {};
								}

								const triggerParentSync = async (
									data: Record<string, unknown>,
								) => {
									const relationId = getRelationId(data);
									if (relationId) {
										const parent = (await ctx.adapter.findOne({
											model: adapter.betterAuthModel,
											where: [{ field: "id", value: relationId }],
										})) as Record<string, unknown> | null;
										if (parent) {
											await sendWebhookEvent(
												"update",
												parent,
												adapter,
												ctx,
												opts,
											);
										}
									}
								};

								hooks[model].create = { after: triggerParentSync };
								hooks[model].delete = { after: triggerParentSync };
							}
						}
					}

					return hooks;
				})(),
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
			organization: {
				fields: {
					attioId: {
						type: "string",
						required: false,
						unique: true,
					},
				},
			},
		},
		endpoints: {
			...endpoints({ ...opts, adapters }),
			...adminEndpoints(opts),
			...organizationEndpoints(opts),
		},
	} satisfies BetterAuthPlugin;
};
