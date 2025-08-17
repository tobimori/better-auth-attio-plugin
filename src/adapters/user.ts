import type {ModelAdapter} from "./types.js"

export const userAdapter: ModelAdapter = {
  betterAuthModel: "user",
  attioObject: "users",
  idField: "user_id",

  toAttio: async (event, values, _ctx) => {
    if (event === "delete") {
      return {_deleted: true, user_id: values.id}
    }

    return {
      record_id: values.attioId as string,
      user_id: values.id,
      primary_email_address: values.email,
      name: values.name,
      email_verified: values.emailVerified,
    }
  },

  fromAttio: async (event, values, ctx) => {
    if (event === "delete") {
      // return minimal data needed for deletion
      return {id: values.user_id}
    }

    const base: Record<string, unknown> = {
      attioId: values.record_id,
    }

    // only include non-null values
    if (values.primary_email_address !== null) base.email = values.primary_email_address
    if (values.name !== null) base.name = values.name
    if (values.email_verified !== null) base.emailVerified = values.email_verified

    if (event === "create") {
      // add creation-specific fields
      return {
        ...base,
        id: ctx.generateId({model: "user"}),
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    }

    // for updates, return only the changed fields
    return base
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
}
