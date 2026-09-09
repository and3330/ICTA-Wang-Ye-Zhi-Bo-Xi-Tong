import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { runMigrations } from "stripe-replit-sync";
import { getStripeSync } from "./stripeClient";
import { WebhookHandlers } from "./webhookHandlers";
import { runAppMigrations } from "./db";
import { getApprovedPriceIds, SUBSCRIPTION_PLANS, ADDON_LOOKUP_KEY, ANNUAL_ADDON_LOOKUP_KEY } from "./subscriptionEntitlements";
import { persistProductionError } from "./errorReporter";
import { safeErrorText } from "./security";
import { startAnnualSubscriptionCreditScheduler } from "./subscriptionCreditGrants";
import { pool } from "./db";
import { registerOperationsHealth, setStripeReady } from "./operationsHealth";
import { appBaseUrl } from "./mail";
import {
  beginShutdown,
  drainOperations,
  isAcceptingWork,
  stopRegisteredResources,
} from "./operationsRuntime";

const app = express();
const httpServer = createServer(app);

app.set("trust proxy", 1);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

const PgStore = connectPgSimple(session);
const sessionSecret = process.env.SESSION_SECRET;

if (!sessionSecret) {
  throw new Error("SESSION_SECRET is required");
}

const sessionStore = new PgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: true,
  });
const sessionMiddleware = session({
  store: sessionStore,
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: "auto" as any,
    httpOnly: true,
    sameSite: "lax" as const,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
});

app.use((req, res, next) => {
  if (!isAcceptingWork()) {
    res.setHeader("Connection", "close");
    return res.status(503).json({ message: "Service is shutting down" });
  }
  next();
});
app.use(sessionMiddleware);
registerOperationsHealth(app);

app.post(
  '/api/stripe/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const signature = req.headers['stripe-signature'];
    if (!signature) {
      return res.status(400).json({ error: 'Missing stripe-signature' });
    }
    try {
      const sig = Array.isArray(signature) ? signature[0] : signature;
      if (!Buffer.isBuffer(req.body)) {
        console.error('STRIPE WEBHOOK ERROR: req.body is not a Buffer.');
        return res.status(500).json({ error: 'Webhook processing error' });
      }
      await WebhookHandlers.processWebhook(req.body as Buffer, sig);
      res.status(200).json({ received: true });
    } catch (error: any) {
      console.error('Webhook error:', error.message);
      res.status(400).json({ error: 'Webhook processing error' });
    }
  }
);

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      log(`${req.method} ${path} ${res.statusCode} in ${duration}ms`);
    }
  });

  next();
});

const shutdownTimeoutMs = Number(process.env.SHUTDOWN_TIMEOUT_MS || 25_000);
async function shutdown(signal: string) {
  if (!beginShutdown()) return;
  log(`Received ${signal}; beginning graceful shutdown`, "shutdown");

  const serverClosed = new Promise<void>((resolve) => {
    if (!httpServer.listening) return resolve();
    httpServer.close(() => resolve());
    httpServer.closeIdleConnections?.();
  });
  const stopDeadline = new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, shutdownTimeoutMs);
    timer.unref();
  });

  await Promise.race([
    Promise.allSettled([serverClosed, stopRegisteredResources()]).then(() => undefined),
    stopDeadline,
  ]);
  const drained = await drainOperations(Math.min(5_000, shutdownTimeoutMs));
  if (!drained) {
    console.warn("Shutdown drain deadline reached; fenced leases will recover unfinished jobs");
  }
  httpServer.closeAllConnections?.();
  sessionStore.close();
  await pool.end().catch((error) => console.error("Database pool shutdown failed:", safeErrorText(error)));
  log("Graceful shutdown complete", "shutdown");
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    const forceExitTimer = setTimeout(() => {
      console.error("Graceful shutdown deadline exceeded; forcing process exit");
      process.exit(1);
    }, shutdownTimeoutMs + 2_000);
    forceExitTimer.unref();
    void shutdown(signal).finally(() => {
      clearTimeout(forceExitTimer);
      process.exit(0);
    });
  });
}

(async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    log('Running application migrations...', 'db');
    await runAppMigrations();
    log('Application schema ready', 'db');

    try {
      log('Initializing Stripe schema...', 'stripe');
      await runMigrations({ databaseUrl });
      log('Stripe schema ready', 'stripe');

      const stripeSync = await getStripeSync();

       const webhookBaseUrl = appBaseUrl();
      const webhookResult = await stripeSync.findOrCreateManagedWebhook(
        `${webhookBaseUrl}/api/stripe/webhook`
      );
      const webhookUrl = webhookResult?.webhook?.url;
      log(webhookUrl ? `Webhook configured: ${webhookUrl}` : 'Managed webhook ready', 'stripe');

      await stripeSync.syncBackfill();
      log('Stripe data synced', 'stripe');

      const { byLookupKey } = await getApprovedPriceIds();
      const missingLookupKeys = [
        ...Object.values(SUBSCRIPTION_PLANS).flatMap((plan) => [plan.lookupKey, plan.annualLookupKey]),
        ADDON_LOOKUP_KEY,
        ANNUAL_ADDON_LOOKUP_KEY,
      ].filter((lookupKey) => !byLookupKey.has(lookupKey));
      if (missingLookupKeys.length) {
        console.warn(`Stripe subscription catalog is incomplete (${missingLookupKeys.join(", ")}); available plans can still use Checkout.`);
      } else {
        log('Stripe subscription catalog ready', 'stripe');
      }
      setStripeReady(true);
    } catch (error) {
      setStripeReady(false);
      console.error('Failed to initialize Stripe:', error);
    }
  }

  await registerRoutes(httpServer, app, sessionMiddleware);
  startAnnualSubscriptionCreditScheduler();

  if (process.env.NODE_ENV === "production" && process.env.UPLOADS_DIR) {
    console.warn("UPLOADS_DIR is only used for legacy local assets; new uploads use Replit App Storage");
  }

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = status >= 500 ? "Internal Server Error" : safeErrorText(err);
    console.error("Request failed:", safeErrorText(err));
    if (process.env.NODE_ENV === "production" && status >= 500) {
      void persistProductionError(err, _req, status).catch((reportError) => {
        console.error("Error persistence failed:", safeErrorText(reportError));
      });
    }

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
