import type { Express } from "express";
import type { Server } from "http";
import fs from "fs";
import path from "path";
import { createServer as createViteServer } from "vite";
import viteConfig from "../vite.config";

/** Dev only: Vite middleware with hot reload on the same HTTP server. */
export async function setupVite(server: Server, app: Express, hmrPath: string) {
  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    server: { middlewareMode: true, hmr: { server, path: hmrPath }, allowedHosts: true },
    appType: "custom",
  });

  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    try {
      const template = await fs.promises.readFile(path.resolve(import.meta.dirname, "..", "client", "index.html"), "utf-8");
      const page = await vite.transformIndexHtml(req.originalUrl, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}
