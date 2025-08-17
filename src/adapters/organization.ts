import type { User } from "better-auth";
import type { Member, Organization } from "better-auth/plugins";
import type { ModelAdapter } from "./types";
import { extractAttioValue, generateSlug, generateUniqueSlug } from "./utils";

export const organizationAdapter: ModelAdapter = {
	betterAuthModel: "organization",
	attioObject: "workspaces",
	
	relatedModels: {
		member: (values) => values.organizationId as string | null,
	},

	toAttio: async (event, values, ctx) => {
		if (event === "delete") {
			return { _deleted: true, workspace_id: values.id };
		}

		// get members and convert to Attio user IDs
		const members = (await ctx.adapter.findMany({
			model: "member",
			where: [{ field: "organizationId", value: values.id as string }],
		})) as Member[];

		const userAttioIds = [];
		for (const member of members) {
			const user = (await ctx.adapter.findOne({
				model: "user",
				where: [{ field: "id", value: member.userId }],
			})) as User & { attioId?: string };
			if (user?.attioId) {
				userAttioIds.push(user.attioId);
			}
		}

		return {
			workspace_id: values.id,
			name: values.name,
			slug: values.slug,
			avatar_url: values.logo,
			users: userAttioIds, // array of Attio user record IDs
		};
	},

	fromAttio: async (event, values, ctx) => {
		if (event === "delete") {
			// find and delete organization and all its members
			const org = (await ctx.adapter.findOne({
				model: "organization",
				where: [{ field: "attioId", value: values.record_id as string }],
			})) as Organization;

			if (org) {
				// delete all members first
				await ctx.adapter.delete({
					model: "member",
					where: [{ field: "organizationId", value: org.id }],
				});

				// then delete the organization
				await ctx.adapter.delete({
					model: "organization",
					where: [{ field: "id", value: org.id }],
				});
			}

			return null; // skip default flow
		}

		// extract organization data from Attio format
		const name = extractAttioValue(values.name);
		const slug = extractAttioValue(values.slug);
		const logo = extractAttioValue(values.avatar_url);
		const userRefs: string[] = (values.users as string[]) || []; // array of Attio user record IDs

		// organization data
		const orgData: Record<string, unknown> = {
			attioId: values.record_id,
		};

		// only include non-null values
		if (name !== null) orgData.name = name;
		if (slug !== null) orgData.slug = slug;
		if (logo !== null) orgData.logo = logo;

		let orgId: string;

		// for create event, just set up the organization
		if (event === "create") {
			orgId = ctx.generateId({ model: "organization" }) || "";

			// check for slug uniqueness
			const slugToUse =
				orgData.slug || generateSlug(String(orgData.name || "org")) || "";
			const existingSlug = await ctx.adapter.findOne({
				model: "organization",
				where: [{ field: "slug", value: slugToUse as string }],
			});

			const created = await ctx.adapter.create({
				model: "organization",
				data: {
					...orgData,
					id: orgId,
					slug: existingSlug
						? generateUniqueSlug(String(orgData.name || "org"))
						: slugToUse,
					createdAt: new Date(),
					updatedAt: new Date(),
				},
			});
			orgId = created.id;
		} else {
			// for update, find the existing organization
			const existingOrg = (await ctx.adapter.findOne({
				model: "organization",
				where: [{ field: "attioId", value: values.record_id as string }],
			})) as Organization | null;

			if (!existingOrg) {
				// this will be handled by the global sync logic based on onMissing
				// if onMissing is "create", the sync handler will call this adapter again with event="create"
				// if onMissing is "ignore" or "delete", the sync handler will handle it
				return orgData;
			}

			orgId = existingOrg.id;

			// update the organization
			await ctx.adapter.update({
				model: "organization",
				where: [{ field: "id", value: orgId }],
				update: {
					...orgData,
					updatedAt: new Date(),
				},
			});
		}

		// sync members based on user references from Attio
		// get current members
		const currentMembers = (await ctx.adapter.findMany({
			model: "member",
			where: [{ field: "organizationId", value: orgId }],
		})) as Member[];

		const currentUserIds = new Set(currentMembers.map((m: any) => m.userId));
		const newUserIds = new Set<string>();

		// resolve Attio user IDs to Better Auth user IDs
		for (const attioUserId of userRefs) {
			const user = (await ctx.adapter.findOne({
				model: "user",
				where: [{ field: "attioId", value: attioUserId }],
			})) as User | null;
			if (user) {
				newUserIds.add(user.id);
			}
			// if user doesn't exist locally, we skip them
			// could optionally fetch from Attio and create if onMissing === "create"
		}

		// remove members no longer in Attio
		for (const member of currentMembers) {
			if (!newUserIds.has(member.userId)) {
				await ctx.adapter.delete({
					model: "member",
					where: [
						{ field: "organizationId", value: orgId },
						{ field: "userId", value: member.userId },
					],
				});
			}
		}

		// add new members
		for (const userId of newUserIds) {
			if (!currentUserIds.has(userId)) {
				await ctx.adapter.create({
					model: "member",
					data: {
						id: ctx.generateId({ model: "member" }),
						organizationId: orgId,
						userId,
						role: "member", // default role
						createdAt: new Date(),
						updatedAt: new Date(),
					},
				});
			}
		}

		return null; // we handled everything, skip default flow
	},

	attioSchema: {
		workspace_id: {
			type: "text",
			title: "Workspace ID",
			description: "Better Auth organization ID",
			is_unique: true,
			is_required: true,
		},
		name: {
			type: "text",
			title: "Name",
			description: "Organization name",
			is_required: true,
		},
		slug: {
			type: "text",
			title: "Slug",
			description: "URL-friendly organization identifier",
			is_unique: true,
		},
		avatar_url: {
			type: "text",
			title: "Avatar URL",
			description: "Organization logo/avatar image URL",
		},
		users: {
			type: "record-reference",
			title: "Users",
			description: "Users who are members of this organization",
			is_multiselect: true,
			config: {
				allowed_objects: ["users"],
			},
		},
	},

	onMissing: "create",
	syncDeletions: true,
};
