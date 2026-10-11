import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // Hashed bundles never change, so cache them hard; index.html must stay fresh.
  app.use(
    express.static(distPath, {
      setHeaders(res, file) {
        res.setHeader("Cache-Control", file.includes(`${path.sep}assets${path.sep}`) ? "public, max-age=31536000, immutable" : "no-cache");
      },
    }),
  );

  // A missing bundle is a real 404 (e.g. a stale tab after a deploy), not the app shell.
  app.use("/assets", (_req, res) => {
    res.status(404).end();
  });

  // Client-side routes fall through to index.html.
  app.use("*", (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
