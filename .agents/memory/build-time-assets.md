---
name: Build-time static assets
description: Why built-in branding must not depend on uploaded attachment paths.
---

Small built-in brand assets needed to build the application must live in a tracked frontend asset directory, not the uploaded attachment directory.

**Why:** This environment's global Git ignore excludes uploaded attachments. A merge removed the original logo attachment while leaving its import intact, so the production build failed with ENOENT even though earlier local builds had passed.

**How to apply:** Before importing an uploaded image as a permanent app dependency, place the small static asset in a tracked frontend directory and confirm it is not ignored. Use App Storage for large or user-managed media. Preserve the original artwork rather than replacing missing brand assets with an approximate logo.
