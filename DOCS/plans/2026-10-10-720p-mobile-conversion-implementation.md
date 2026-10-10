# 720p mobile conversion implementation plan

1. Extend configuration and SQLite migrations with durable conversion-job state, independent claiming/recovery methods, retry support, and conversion change notifications.
2. Add an FFprobe/FFmpeg media module that probes compatibility, calculates a size-bounded 720p bitrate, performs supervised two-pass H.264/AAC conversion, validates the result, and atomically publishes it.
3. Add a conversion worker that reconciles tracked completed downloads at startup and processes one conversion independently of the existing download worker.
4. Wake conversion as soon as an HQ download completes, while allowing the downloader to claim the next download immediately.
5. Enrich completed-download API data with HQ/LQ state and exact file sizes, add variant-safe Range downloads, add conversion retry, and broadcast conversion updates over SSE.
6. Update the Downloads interface with separate HQ and LQ controls, human-readable sizes, live conversion progress, failure details, and retry.
7. Add database, media-policy, conversion-worker, API, and client-facing behavior coverage, including a real FFmpeg-generated fixture when FFmpeg is available.
8. Update operating documentation, run the complete verification suite and production build, review for sensitive data, commit, push, then verify the Drone deployment and deployed commit health.
