import type { AuthContext } from "better-auth";
import {
	type admin,
	createAuthEndpoint,
	type UserWithRole,
} from "better-auth/plugins";
import { z } from "zod";
import type { AttioPluginOptions } from ".";
import { getIp } from "./helpers/get-request-ip";
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

	/**
	 * Set impersonation session cookie from token
	 */
	setImpersonationSession: createAuthEndpoint(
		"/attio/impersonation-session",
		{
			method: "GET",
			query: z.object({
				token: z.string(),
			}),
		},
		async (ctx) => {
			try {
				// find the session to validate it exists
				const sessionData = await ctx.context.internalAdapter.findSession(
					ctx.query.token,
				);

				if (!sessionData?.session) {
					return ctx.redirect("/?error=invalid_session");
				}

				// only allow if session was created by Attio and hasn't been used yet
				if (!sessionData.session.userAgent?.includes("Attio")) {
					return ctx.redirect("/?error=session_already_used");
				}

				// update the session with real user agent and IP from this request
				const realUserAgent = ctx.headers?.get("user-agent") || "";
				const realIpAddress = ctx.headers
					? getIp(ctx.headers, ctx.context.options)
					: "";

				await ctx.context.adapter.update({
					model: "session",
					where: [{ field: "token", value: ctx.query.token }],
					update: {
						userAgent: realUserAgent,
						ipAddress: realIpAddress,
					},
				});

				const authCookies = ctx.context.authCookies;

				// if there's an existing session, save it as admin_session
				if (ctx.context.session?.session) {
					const dontRememberMeCookie = await ctx.getSignedCookie(
						ctx.context.authCookies.dontRememberToken.name,
						ctx.context.secret,
					);
					const adminCookieProp = ctx.context.createAuthCookie("admin_session");
					await ctx.setSignedCookie(
						adminCookieProp.name,
						`${ctx.context.session.session.token}:${dontRememberMeCookie || ""}`,
						ctx.context.secret,
						authCookies.sessionToken.options,
					);
				}

				// set the impersonation session cookie
				await ctx.setSignedCookie(
					authCookies.sessionToken.name,
					sessionData.session.token,
					ctx.context.secret,
					authCookies.sessionToken.options,
				);

				// redirect to the app's base URL
				return ctx.redirect("/");
			} catch (_) {
				const baseUrl = ctx.request?.headers.get("referer") || "/";
				return ctx.redirect(`${baseUrl}?error=session_failed`);
			}
		},
	),
});
