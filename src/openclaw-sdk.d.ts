// The published openclaw package ships no type declarations for its
// plugin-sdk subpaths, so declare the one entry point this plugin uses.
declare module "openclaw/plugin-sdk/provider-entry" {
  export function defineSingleProviderPluginEntry(options: {
    id: string;
    name: string;
    description: string;
    manifest?: unknown;
    provider: {
      label: string;
      docsPath?: string;
      catalog: {
        order?: "simple" | "profile" | "paired" | "late";
        run: (ctx: unknown) => Promise<unknown>;
        staticRun?: (ctx: unknown) => Promise<unknown>;
      };
    };
  }): {
    id: string;
    name: string;
    description: string;
    register(api: unknown): void;
  };
}
