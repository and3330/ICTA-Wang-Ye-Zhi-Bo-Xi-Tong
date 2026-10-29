import type { RequestHandler } from "express";

export const EMBED_FRAME_ANCESTORS = "'self' https://noncodingai.com https://e230f6ea-fe56-41a1-a3c3-4e31b4c213e7-00-z94nnqgcs6a8.janeway.replit.dev";

// Install before API routes and both SPA fallbacks (Vite and production static).
// Only the two embed namespaces may be framed by these external origins.
export const embedFramePolicy: RequestHandler = (req, res, next) => {
  const isEmbed = req.path.startsWith("/embed/register/") || req.path.startsWith("/embed/webinar/");
  const existing = res.getHeader("Content-Security-Policy");
  if (isEmbed) {
    const policies = Array.isArray(existing) ? existing : existing ? [String(existing)] : [];
    const directives = policies.flatMap(policy => policy.split(";"))
      .map(value => value.trim()).filter(value => value && !/^frame-ancestors(?:\s|$)/i.test(value));
    res.setHeader("Content-Security-Policy", [...directives, `frame-ancestors ${EMBED_FRAME_ANCESTORS}`].join("; "));
    res.removeHeader("X-Frame-Options");
  } else if (!existing) {
    // Preserve existing stricter CSPs and every other route's X-Frame-Options.
    res.setHeader("Content-Security-Policy", "frame-ancestors 'self'");
  }
  next();
};
