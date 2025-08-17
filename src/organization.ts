import type { AuthContext } from "better-auth";
import {
	createAuthEndpoint,
	type Invitation,
	type organization,
} from "better-auth/plugins";
import { z } from "zod";
import type { AttioPluginOptions } from ".";
import { getIp } from "./helpers/get-request-ip";
import { validateSecret } from "./helpers/secret";

/**
 * Get the organization plugin from the auth context
 */
export const getOrganizationPlugin = (context: AuthContext) => {
	const plugin = context.options.plugins?.find((p) => p.id === "organization");
	return plugin as ReturnType<typeof organization>;
};

/**
 * Organization-plugin specific endpoints
 */
export const endpoints = (opts: AttioPluginOptions) => ({
	/**
	 * List organization invitations
	 */
	listOrganizationInvitations: createAuthEndpoint(
		"/attio/list-org-invitations",
		{
			method: "POST",
			body: z.object({
				secret: z.string(),
				organizationId: z.string(),
			}),
		},
		async (ctx) => {
			const error = validateSecret(opts, ctx);
			if (error) return error;

			if (!getOrganizationPlugin(ctx.context)) {
				return ctx.json(
					{
						error: "ORGANIZATION_PLUGIN_NOT_ENABLED",
						message: "Organization plugin is required for invitations",
					},
					{
						status: 501,
					},
				);
			}

			try {
				const invitations = (await ctx.context.adapter.findMany({
					model: "invitation",
					where: [
						{
							field: "organizationId",
							value: ctx.body.organizationId,
						},
					],
				})) as Invitation[];

				// deduplicate inviterIds and fetch each unique inviter only once
				const uniqueInviterIds = [
					...new Set(
						invitations
							.map((inv) => inv.inviterId)
							.filter((id): id is string => !!id),
					),
				];

				const inviterMap = new Map();
				await Promise.all(
					uniqueInviterIds.map(async (inviterId) => {
						const inviter =
							await ctx.context.internalAdapter.findUserById(inviterId);
						if (inviter) {
							inviterMap.set(inviterId, {
								id: inviter.id,
								name: inviter.name,
								email: inviter.email,
							});
						}
					}),
				);

				// map invitations with their inviters
				const invitationsWithInviters = invitations.map((invitation) => ({
					...invitation,
					inviter: invitation.inviterId
						? inviterMap.get(invitation.inviterId) || null
						: null,
				}));

				return ctx.json({
					invitations: invitationsWithInviters,
				});
			} catch (_) {
				return ctx.error("INTERNAL_SERVER_ERROR");
			}
		},
	),

	/**
	 * Cancel organization invitation
	 */
	cancelOrganizationInvitation: createAuthEndpoint(
		"/attio/cancel-org-invitation",
		{
			method: "POST",
			body: z.object({
				secret: z.string(),
				invitationId: z.string(),
			}),
		},
		async (ctx) => {
			const error = validateSecret(opts, ctx);
			if (error) return error;

			if (!getOrganizationPlugin(ctx.context)) {
				return ctx.json(
					{
						error: "ORGANIZATION_PLUGIN_NOT_ENABLED",
						message: "Organization plugin is required for invitations",
					},
					{
						status: 501,
					},
				);
			}

			try {
				await ctx.context.adapter.update({
					model: "invitation",
					where: [
						{
							field: "id",
							value: ctx.body.invitationId,
						},
					],
					update: {
						status: "cancelled",
					},
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
	 * Create organization invitation
	 */
	createOrganizationInvitation: createAuthEndpoint(
		"/attio/create-org-invitation",
		{
			method: "POST",
			body: z.object({
				secret: z.string(),
				email: z.email(),
				role: z.union([z.string(), z.array(z.string())]),
				organizationId: z.string(),
				inviterEmail: z.email(), // Email of the inviter from Attio
				resend: z.boolean().optional(),
			}),
		},
		async (ctx) => {
			const error = validateSecret(opts, ctx);
			if (error) return error;

			if (!getOrganizationPlugin(ctx.context)) {
				return ctx.json(
					{
						error: "ORGANIZATION_PLUGIN_NOT_ENABLED",
						message: "Organization plugin is required for invitations",
					},
					{
						status: 501,
					},
				);
			}

			try {
				// Resolve inviter user from email
				const inviterResult = await ctx.context.internalAdapter.findUserByEmail(
					ctx.body.inviterEmail.toLowerCase(),
				);

				if (!inviterResult?.user) {
					return ctx.json(
						{
							error: "INVITER_NOT_FOUND",
							message: "Inviter user not found",
						},
						{
							status: 400,
						},
					);
				}

				// Check if user is already invited
				const existingInvitations = await ctx.context.adapter.findMany({
					model: "invitation",
					where: [
						{
							field: "email",
							value: ctx.body.email.toLowerCase(),
						},
						{
							field: "organizationId",
							value: ctx.body.organizationId,
						},
						{
							field: "status",
							value: "pending",
						},
					],
				});

				// Filter for non-expired invitations
				const now = new Date();
				const validInvitations = existingInvitations.filter(
					(inv) => new Date(inv.expiresAt) > now,
				);

				if (validInvitations.length > 0 && !ctx.body.resend) {
					return ctx.json(
						{
							error: "USER_ALREADY_INVITED",
							message: "User is already invited to this organization",
						},
						{
							status: 400,
						},
					);
				}

				// Check if user is already a member
				const existingMember = await ctx.context.adapter.findOne({
					model: "member",
					where: [
						{
							field: "organizationId",
							value: ctx.body.organizationId,
						},
						{
							field: "email",
							value: ctx.body.email.toLowerCase(),
						},
					],
				});

				if (existingMember) {
					return ctx.json(
						{
							error: "USER_ALREADY_MEMBER",
							message: "User is already a member of this organization",
						},
						{
							status: 400,
						},
					);
				}

				// If resending and invitation exists, update it
				if (validInvitations.length > 0 && ctx.body.resend) {
					const existingInvitation = validInvitations[0];
					const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7); // 7 days

					await ctx.context.adapter.update({
						model: "invitation",
						where: [
							{
								field: "id",
								value: existingInvitation.id,
							},
						],
						update: {
							expiresAt: expiresAt.toISOString(),
							inviterId: inviterResult.user.id,
						},
					});

					return ctx.json({
						...existingInvitation,
						expiresAt: expiresAt.toISOString(),
						inviterId: inviterResult.user.id,
						resent: true,
					});
				}

				// Create new invitation
				const invitationId = ctx.context.generateId({
					model: "invitation",
				});
				const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7); // 7 days
				const role = Array.isArray(ctx.body.role)
					? ctx.body.role.join(",")
					: ctx.body.role;

				const invitation = await ctx.context.adapter.create({
					model: "invitation",
					data: {
						id: invitationId,
						email: ctx.body.email.toLowerCase(),
						role,
						organizationId: ctx.body.organizationId,
						inviterId: inviterResult.user.id,
						status: "pending",
						expiresAt: expiresAt.toISOString(),
					},
				});

				// Trigger the sendInvitationEmail callback if configured
				const orgPlugin = getOrganizationPlugin(ctx.context);
				if (orgPlugin && orgPlugin.options?.sendInvitationEmail) {
					// Get organization details for email
					const organization = await ctx.context.adapter.findOne({
						model: "organization",
						where: [
							{
								field: "id",
								value: ctx.body.organizationId,
							},
						],
					});

					if (organization) {
						await orgPlugin.options.sendInvitationEmail(
							{
								id: invitation.id,
								role: invitation.role,
								email: invitation.email,
								organization,
								inviter: {
									user: inviterResult.user,
									role: role, // Inviter's role in the context
								},
								invitation,
							},
							ctx.request,
						);
					}
				}

				return ctx.json(invitation);
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
			} catch (error) {
				console.error("Failed to set impersonation session:", error);
				const baseUrl = ctx.request?.headers.get("referer") || "/";
				return ctx.redirect(`${baseUrl}?error=session_failed`);
			}
		},
	),
});
