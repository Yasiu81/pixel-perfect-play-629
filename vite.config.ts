import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  // Deploy target: Vercel (zamiast domyślnego Cloudflare).
  // Bez tego Nitro buduje pod Cloudflare Workers i Vercel zwraca 404,
  // bo nie rozpoznaje wygenerowanego formatu wyjściowego.
  nitro: {
    preset: "vercel",
  },
});