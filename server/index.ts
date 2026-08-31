import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { runMigrations } from "stripe-replit-sync";
import { getStripeSync } from "./stripeClient";
import { WebhookHandlers } from "./webhookHandlers";
import bcrypt from "bcryptjs";
import { storage } from "./storage";
import { runAppMigrations } from "./db";
import { getApprovedPriceIds, SUBSCRIPTION_PLANS, ADDON_LOOKUP_KEY } from "./subscriptionEntitlements";

const app = express();
const httpServer = createServer(app);

app.set("trust proxy", 1);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

const PgStore = connectPgSimple(session);

const sessionMiddleware = session({
  store: new PgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: true,
  }),
  secret: process.env.SESSION_SECRET || "webinar-secret-key-2024",
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: "auto" as any,
    httpOnly: true,
    sameSite: "lax" as const,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
});

app.use(sessionMiddleware);

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
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  try {
    const databaseUrl = process.env.DATABASE_URL;
    if (databaseUrl) {
      log('Running application migrations...', 'db');
      await runAppMigrations();
      log('Application schema ready', 'db');

      log('Initializing Stripe schema...', 'stripe');
      await runMigrations({ databaseUrl });
      log('Stripe schema ready', 'stripe');

      const stripeSync = await getStripeSync();

      const webhookBaseUrl = `https://${process.env.REPLIT_DOMAINS?.split(',')[0]}`;
      const webhookResult = await stripeSync.findOrCreateManagedWebhook(
        `${webhookBaseUrl}/api/stripe/webhook`
      );
      const webhookUrl = webhookResult?.webhook?.url;
      log(webhookUrl ? `Webhook configured: ${webhookUrl}` : 'Managed webhook ready', 'stripe');

      await stripeSync.syncBackfill();
      log('Stripe data synced', 'stripe');

      const { byLookupKey } = await getApprovedPriceIds();
      const catalogReady = [
        ...Object.values(SUBSCRIPTION_PLANS).map((plan) => plan.lookupKey),
        ADDON_LOOKUP_KEY,
      ].every((lookupKey) => byLookupKey.has(lookupKey));
      if (!catalogReady) {
        console.warn('Stripe subscription catalog is incomplete; Checkout will remain unavailable.');
      } else {
        log('Stripe subscription catalog ready', 'stripe');
      }
    }
  } catch (error) {
    console.error('Failed to initialize Stripe:', error);
  }

  try {
    let adminUser = await storage.getUserByUsername("admin");
    if (!adminUser) {
      const hashedPassword = await bcrypt.hash("aa3210", 10);
      try {
        await storage.createUser({
          username: "admin",
          password: hashedPassword,
          email: "admin@icta-webinar.com",
          companyName: "ICTA",
        });
        log("Default admin account created (admin / aa3210)", "seed");
      } catch (insertErr: any) {
        if (!String(insertErr?.message || "").toLowerCase().includes("unique")) {
          throw insertErr;
        }
      }
      adminUser = await storage.getUserByUsername("admin");
    }
    if (adminUser && (!adminUser.isSuperAdmin || adminUser.subscriptionPlan !== "enterprise")) {
      await storage.updateUser(adminUser.id, {
        isSuperAdmin: true,
        subscriptionPlan: "enterprise",
        maxWebinars: 999,
      });
    }
  } catch (err) {
    console.error("Failed to seed admin account:", err);
  }

  await registerRoutes(httpServer, app, sessionMiddleware);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

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
