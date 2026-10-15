import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: "src",
  modules: ["@wxt-dev/module-svelte"],
  publicDir: "public",
  // "tree" builds DOM fragments without innerHTML, which keeps `web-ext lint` clean.
  svelte: { vite: { compilerOptions: { fragments: "tree" } } },
  manifest: ({ browser }) => ({
    name: "OpenShield",
    description: "Remote for a running OpenShield instance: send pages and selections, watch sessions, approve tool calls.",
    permissions: ["storage", "contextMenus", "notifications", "alarms", "activeTab", "scripting"],
    // Loopback only by default. LAN hosts are requested at runtime from the settings page.
    host_permissions: ["http://127.0.0.1/*", "http://localhost/*"],
    optional_host_permissions: ["http://*/*"],
    ...(browser === "firefox"
      ? { browser_specific_settings: {
            gecko: {
              id: "openshield-extension@blackshield.company",
              strict_min_version: "142.0",
              data_collection_permissions: { required: ["none"] },
            },
          },
          optional_permissions: ["http://*/*"],
        }
      : {}),
  }),
});
