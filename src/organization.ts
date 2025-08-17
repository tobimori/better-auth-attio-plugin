import type { AuthContext, User } from "better-auth";
import {
	createAuthEndpoint,
	type Invitation,
	type Member,
	type organization,
} from "better-auth/plugins";
import { z } from "zod";
import type { AttioPluginOptions } from ".";
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
				return ctx.error("NOT_IMPLEMENTED");
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

				// Filter for active (non-expired) invitations
				const now = new Date();
				const activeInvitations = invitations.filter(
					(inv) => inv.status === "pending" && new Date(inv.expiresAt) > now,
				);

				const inviterIds = [
					...new Set(
						activeInvitations
							.map((inv) => inv.inviterId)
							.filter((id): id is string => !!id),
					),
				];

				const inviterMap = new Map();
				if (inviterIds.length) {
					const inviters = await Promise.all(
						inviterIds.map((id) =>
							ctx.context.internalAdapter.findUserById(id),
						),
					);
					inviterIds.forEach((id, index) => {
						const inviter = inviters[index];
						if (inviter) {
							inviterMap.set(id, {
								id: inviter.id,
								name: inviter.name,
								email: inviter.email,
							});
						}
					});
				}

				// Sort by expiresAt
				const sortedInvitations = activeInvitations
					.map((invitation) => ({
						...invitation,
						inviter:
							invitation.inviterId && inviterMap.has(invitation.inviterId)
								? { ...inviterMap.get(invitation.inviterId) }
								: null,
					}))
					.sort((a, b) => {
						const dateA = new Date(a.expiresAt).getTime();
						const dateB = new Date(b.expiresAt).getTime();
						return dateB - dateA;
					});

				return ctx.json({
					invitations: sortedInvitations,
					count: sortedInvitations.length,
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
				return ctx.error("NOT_IMPLEMENTED");
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
			}),
		},
		async (ctx) => {
			const error = validateSecret(opts, ctx);
			if (error) return error;

			const plugin = getOrganizationPlugin(ctx.context);
			if (!plugin) {
				return ctx.error("NOT_IMPLEMENTED");
			}

			try {
				// Resolve inviter user from email
				const inviterResult = await ctx.context.internalAdapter.findUserByEmail(
					ctx.body.inviterEmail.toLowerCase(),
				);

				if (!inviterResult?.user) {
					return ctx.error("NOT_FOUND");
				}

				// Check if user is already invited
				const existingInvitations = (await ctx.context.adapter.findMany({
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
				})) as Invitation[];

				// Filter for non-expired invitations
				const now = new Date();
				const validInvitations = existingInvitations.filter(
					(inv) => new Date(inv.expiresAt) > now,
				);

				// Check if user is already a member
				const userToInvite = await ctx.context.internalAdapter.findUserByEmail(
					ctx.body.email.toLowerCase(),
				);

				if (userToInvite?.user) {
					const existingMember = (await ctx.context.adapter.findOne({
						model: "member",
						where: [
							{
								field: "organizationId",
								value: ctx.body.organizationId,
							},
							{
								field: "userId",
								value: userToInvite.user.id,
							},
						],
					})) as Member | null;

					if (existingMember) {
						return ctx.error("BAD_REQUEST");
					}
				}

				// If resending and invitation exists, update it
				if (validInvitations.length > 0) {
					const existingInvitation = validInvitations[0]!;
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
							expiresAt,
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
				const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7); // 7 days
				const role = Array.isArray(ctx.body.role)
					? ctx.body.role.join(",")
					: ctx.body.role;

				const invitation = await ctx.context.adapter.create({
					model: "invitation",
					data: {
						email: ctx.body.email.toLowerCase(),
						role,
						organizationId: ctx.body.organizationId,
						inviterId: inviterResult.user.id,
						status: "pending",
						expiresAt,
					},
				});

				if (plugin.options?.sendInvitationEmail) {
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
						await plugin.options.sendInvitationEmail(
							{
								id: invitation.id,
								role: invitation.role,
								email: invitation.email,
								organization,
								inviter: {
									user: inviterResult.user,
									role: role,
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
	 * Search users
	 */
	searchUsers: createAuthEndpoint(
		"/attio/search-users",
		{
			method: "POST",
			body: z.object({
				secret: z.string(),
				search: z.string(),
			}),
		},
		async (ctx) => {
			const error = validateSecret(opts, ctx);
			if (error) return error;

			try {
				const searchTerm = ctx.body.search.toLowerCase();

				// search by email only since we can't do OR conditions
				const users = (await ctx.context.adapter.findMany({
					model: "user",
					where: searchTerm
						? [
								{
									field: "email",
									value: searchTerm,
									operator: "contains",
								},
							]
						: undefined,
					limit: 50,
					sortBy: {
						field: "createdAt",
						direction: "desc",
					},
				})) as User[];

				return ctx.json({
					users: users.map((user) => ({
						id: user.id,
						email: user.email,
						name: user.name,
						image: user.image,
					})),
				});
			} catch (_) {
				return ctx.error("INTERNAL_SERVER_ERROR");
			}
		},
	),

	/**
	 * Get organization roles
	 */
	getOrganizationRoles: createAuthEndpoint(
		"/attio/get-org-roles",
		{
			method: "POST",
			body: z.object({
				secret: z.string(),
			}),
		},
		async (ctx) => {
			const error = validateSecret(opts, ctx);
			if (error) return error;

			const plugin = getOrganizationPlugin(ctx.context);
			if (!plugin) {
				return ctx.error("NOT_IMPLEMENTED");
			}

			// get roles from the organization plugin options
			const roles = plugin.options?.roles
				? Object.keys(plugin.options.roles)
				: ["member", "admin", "owner"];

			return ctx.json({
				roles,
			});
		},
	),
});
