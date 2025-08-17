import type { ModelAdapter } from "./types";
import { extractAttioValue } from "./utils";

export const userAdapter: ModelAdapter = {
	betterAuthModel: "user",
	attioObject: "users",

	toAttio: async (event, values, _ctx) => {
		if (event === "delete") {
			return { _deleted: true, user_id: values.id };
		}

		return {
			user_id: values.id,
			primary_email_address: values.email,
			name: values.name,
			email_verified: values.emailVerified,
		};
	},

	fromAttio: async (event, values, ctx) => {
		if (event === "delete") {
			// return minimal data needed for deletion
			const userId = extractAttioValue(values.user_id);
			return { id: userId };
		}

		// extract values from Attio format
		const email = extractAttioValue(values.primary_email_address);
		const name = extractAttioValue(values.name);
		const emailVerified = extractAttioValue(values.email_verified);

		const base: Record<string, unknown> = {
			attioId: values.record_id,
		};

		// only include non-null values
		if (email !== null) base.email = email;
		if (name !== null) base.name = name;
		if (emailVerified !== null) base.emailVerified = emailVerified;

		if (event === "create") {
			// add creation-specific fields
			return {
				...base,
				id: ctx.generateId({ model: "user" }),
				createdAt: new Date(),
				updatedAt: new Date(),
			};
		}

		// for updates, return only the changed fields
		return base;
	},

	attioSchema: {
		user_id: {
			type: "text",
			title: "User ID",
			description: "Better Auth user ID",
			is_unique: true,
			is_required: true,
		},
		primary_email_address: {
			type: "email-address",
			title: "Primary Email",
			description: "User's primary email address",
			is_unique: true,
			is_required: true,
		},
		name: {
			type: "text",
			title: "Name",
			description: "User's display name",
		},
		email_verified: {
			type: "checkbox",
			title: "Email Verified",
			description: "Whether the user's email has been verified",
		},
	},

	onMissing: "create",
	syncDeletions: true,
};
