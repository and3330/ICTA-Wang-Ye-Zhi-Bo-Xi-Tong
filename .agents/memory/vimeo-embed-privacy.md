---
name: Vimeo embed privacy
description: Why Vimeo needs origin-only referrer information and intact unlisted-link verification.
---

Treat Vimeo's “Because of its privacy settings” message separately from autoplay denial. Preserve unlisted-link verification and provide origin-only referrer information to Vimeo, without exposing the viewer URL.

**Why:** Vimeo checks embed-domain privacy using the referrer. A missing referrer can reject an otherwise authorized site; dropping an unlisted video's hash can independently reject playback. A public viewing setting does not prove the video's embedding policy allows the site.

**How to apply:** Keep this policy specific to the Vimeo iframe, not a global referrer-policy relaxation or a change to other media providers. Do not send full room URLs containing watch credentials. Do not remove domain privacy, change allowlists, or make a video public as a workaround. Browser stubs can prove URL/header construction but cannot certify real Safari playback or the owner's actual Vimeo allowlist.

Official reference: https://help.vimeo.com/hc/en-us/articles/35817429341457-Troubleshooting-video-playback-errors-due-to-referrer-policy-conflicts
