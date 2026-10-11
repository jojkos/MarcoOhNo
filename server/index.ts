import "dotenv/config";
import { createApp, HMR_PATH } from "./app";
import { log } from "./log";

const port = Number(process.env.PORT || 5000);
const server = createApp({
  async mountClient(app, httpServer) {
    if (process.env.NODE_ENV === "production") {
      const { serveStatic } = await import("./static");
      serveStatic(app);
    } else {
      const { setupVite } = await import("./vite");
      await setupVite(httpServer, app, HMR_PATH);
    }
  },
});

server
  .listen(port)
  .then(() => log(`serving on port ${port}`))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
