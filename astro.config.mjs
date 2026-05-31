import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";

export default defineConfig({
  output: "server",
  adapter: cloudflare({
    imageService: "passthrough",
    platformProxy: { enabled: false },
    sessionKVBindingName: undefined,
  }),
  vite: {
    ssr: {
      external: ["@supabase/supabase-js", "@supabase/postgrest-js", "@supabase/realtime-js", "@supabase/storage-api", "@supabase/auth-js"],
    },
  },
});
