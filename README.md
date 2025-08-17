# Attio Better Auth Plugin

A [Better Auth](https://better-auth.com) plugin for [Attio](https://attio.com) that provides bidirectional sync between your application and Attio, enabling user management, organization sync, and session tracking directly from Attio

- Sync users, workspaces and arbitrary database objects between your Better Auth app and Attio in both directions
- Create users, ban/unban them, and send password reset emails directly from Attio
- View active sessions with device and browser information and revoke them remotely
- Manage organization members and handle invitations across both systems
- Impersonate users for support and debugging purposes

## Installation

```bash
npm install better-auth-attio-plugin
# or
pnpm add better-auth-attio-plugin
# or
bun add better-auth-attio-plugin
```

## Setup

### 1. Generate Connection Secret

Visit the [Attio Connection Generator](https://better-auth-attio-plugin.vercel.app/) to create your connection secret:

1. Enter your application's live URL (e.g., `https://your-app.com`)
2. Enter the path to your Better Auth endpoints (default: `/api/auth`)
3. Generate the connection secret
4. Copy the generated base64-encoded connection string

### 2. Configure the Plugin

Add the Attio plugin to your Better Auth configuration:

```ts
import { betterAuth } from "better-auth";
import { attio } from "better-auth-attio-plugin";

export const auth = betterAuth({
  // ... your other config
  plugins: [
    attio({
      secret: process.env.ATTIO_SECRET, // Shared secret for authentication from step 1
      waitUntil: ctx.waitUntil, // Defer sync until after response is sent, for edge environments like Cloudflare Workers
    }),
    // You'll also want the admin, and organization plugins for full functionality
    admin(),
    organization(),
  ],
});
```

### 3. Install the Attio App

In Attio:
1. Navigate to Settings > Apps
2. Install the Better Auth integration
3. Paste the connection string from step 1
4. The app will automatically set up the required objects and attributes

## Configuration

By default, the plugin syncs users and organizations with predefined field mappings. You can customize this behavior with adapters.

### Custom Adapters

Adapters control how data is transformed between Better Auth and Attio. Use them to:
- Add custom fields to the sync
- Change field mappings
- Sync custom database models to any Attio object

```ts
import { userAdapter } from "better-auth-attio-plugin/adapters";

attio({
  secret: process.env.ATTIO_SECRET,
  adapters: [
    {
      ...userAdapter,
      // Add custom fields to Attio
      attioSchema: {
        ...userAdapter.attioSchema,
        subscription_tier: {
          type: "text",
          title: "Subscription Tier",
        },
      },
      // Map data when syncing to Attio
      toAttio: async (event, values, ctx) => {
        const base = await userAdapter.toAttio(event, values, ctx);
        return {
          ...base,
          subscription_tier: values.metadata?.tier || "free",
        };
      },
    },
  ],
})
```

> [!NOTE]
> You can create adapters for any Better Auth model to sync with any Attio object, not just users and organizations.

## Support

> [!NOTE]
> This app is provided free of charge & published under the permissive MIT License. If you use it for your company, please consider to [sponsor me on GitHub](https://github.com/sponsors/tobimori) to support further development and continued maintenance of the Better Auth Attio App.

## License

[MIT License](./LICENSE)
Copyright © 2025 Tobias Möritz
