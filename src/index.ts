import type { User } from "better-auth";
import type {
	BetterAuthPlugin,
	Member,
	Organization,
} from "better-auth/plugins";
import { endpoints as adminEndpoints } from "./admin";
import { endpoints } from "./core";
import type { FieldMapping } from "./helpers/field-mappings";
import { sendWebhookEvent } from "./helpers/send-event";
import {
	getOrganizationPlugin,
	endpoints as organizationEndpoints,
} from "./organization";

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

					...(getOrganizationPlugin(ctx)
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
			...endpoints(opts),
			...adminEndpoints(opts),
			...organizationEndpoints(opts),
		},
	} satisfies BetterAuthPlugin;
};
