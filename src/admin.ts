import type { AuthContext } from "better-auth";
import {
	type admin,
	createAuthEndpoint,
	type UserWithRole,
} from "better-auth/plugins";
import { z } from "zod";
import type { AttioPluginOptions } from ".";
import { validateSecret } from "./helpers/secret";

/**
 * Get the admin plugin from the auth context
 */
export const getAdminPlugin = (context: AuthContext) => {
	const plugin = context.options.plugins?.find((p) => p.id === "admin");
	return plugin as ReturnType<typeof admin>;
};

/**
 * Admin-plugin specific endpoints
 */
export const endpoints = (opts: AttioPluginOptions) => ({
	/**
	 * Get user details with admin-specific information
	 */
	getUserDetails: createAuthEndpoint(
		"/attio/user-details",
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

			if (!getAdminPlugin(ctx.context)) {
				return ctx.error("NOT_IMPLEMENTED");
			}

			try {
				const user = (await ctx.context.internalAdapter.findUserById(
					ctx.body.userId,
				)) as UserWithRole;

				if (!user) {
					return ctx.error("NOT_FOUND");
				}

				// extract admin-specific fields from user record
				const banned = Boolean(user.banned);
				const bannedUntil = user.banExpires
					? user.banExpires.toISOString()
					: null;
				const banReason = user.banReason || null;
				const role = user.role || "user";

				return ctx.json({
					banned,
					bannedUntil,
					banReason,
					role,
				});
			} catch (_) {
				return ctx.error("INTERNAL_SERVER_ERROR");
			}
		},
	),

	/**
	 * Update user ban status
	 */
	updateUserBanStatus: createAuthEndpoint(
		"/attio/update-ban-status",
		{
			method: "POST",
			body: z.object({
				secret: z.string(),
				userId: z.string(),
				banned: z.boolean(),
				banReason: z.string().nullable().optional(),
				banExpires: z.string().nullable().optional(), // ISO date string
			}),
		},
		async (ctx) => {
			const error = validateSecret(opts, ctx);
			if (error) return error;

			if (!getAdminPlugin(ctx.context)) {
				return ctx.error("NOT_IMPLEMENTED");
			}

			try {
				await ctx.context.internalAdapter.updateUser(ctx.body.userId, {
					banned: ctx.body.banned,
					banReason: ctx.body.banReason ?? null,
					banExpires: ctx.body.banExpires
						? new Date(ctx.body.banExpires)
						: null,
				});

				return ctx.json({
					success: true,
				});
			} catch (_) {
				return ctx.error("INTERNAL_SERVER_ERROR");
			}
		},
	),

	/**
	 * Impersonate a user - creates a session token
	 */
	impersonateUser: createAuthEndpoint(
		"/attio/impersonate",
		{
			method: "POST",
			body: z.object({
				secret: z.string(),
				targetUserId: z.string(), // the user to impersonate
				adminEmail: z.string(), // the admin's email from Attio (for tracking who impersonated)
			}),
		},
		async (ctx) => {
			const error = validateSecret(opts, ctx);
			if (error) return error;

			if (!getAdminPlugin(ctx.context)) {
				return ctx.error("NOT_IMPLEMENTED");
			}

			try {
				// optionally find the admin user for tracking
				const adminUser = await ctx.context.internalAdapter.findUserByEmail(
					ctx.body.adminEmail,
				);
				const impersonatedBy = adminUser?.user?.id || ctx.body.adminEmail;

				// get admin plugin options for impersonation duration
				const adminPlugin = ctx.context.options.plugins?.find(
					(p) => p.id === "admin",
				);
				const impersonationDuration =
					adminPlugin?.options?.impersonationSessionDuration || 60 * 60; // default 1 hour

				const expiresAt = new Date(Date.now() + impersonationDuration * 1000);

				const session = await ctx.context.internalAdapter.createSession(
					ctx.body.targetUserId,
					ctx,
					true,
					{
						impersonatedBy,
						expiresAt,
					},
					true,
				);

				if (!session) {
					return ctx.error("INTERNAL_SERVER_ERROR");
				}

				return ctx.json({
					success: true,
					sessionToken: session.token,
				});
			} catch (_) {
				return ctx.error("INTERNAL_SERVER_ERROR");
			}
		},
	),
});
