# 720p mobile conversion design

## Goal

Keep each completed high-quality F1 TV download while independently producing a tablet-friendly MP4 when needed. Downloading and conversion must run concurrently, survive restarts, and expose separate HQ and LQ downloads with their actual file sizes.

The mobile artifact must be no larger than 3,000,000,000 bytes. It should play reliably on an Android tablet and retain acceptable video and audio quality.

## Architecture

Add a durable `conversion_jobs` table associated one-to-one with completed download jobs. A dedicated conversion worker owns this queue and runs independently of the existing download worker. Each worker may have one active process at the same time, allowing the next F1 TV download to continue while FFmpeg converts the previous result.

When an HQ download completes, the server creates its conversion job without delaying the download worker. At startup, a reconciliation pass examines only completed downloads tracked in the database. It creates missing conversion jobs, adopts valid existing mobile artifacts, and requeues interrupted or incomplete work.

Conversion jobs have their own queued, running, completed, and failed states, progress, diagnostic message, timestamps, output path, and measured byte size. Conversion failure never changes the completed state or availability of the HQ download.

## Deterministic mobile-file policy

Before encoding, probe the HQ file with `ffprobe`. The source itself may be reused as the LQ variant only when all of the following are true:

- It is a readable MP4 containing both video and audio.
- The video codec is H.264 and uses a broadly compatible pixel format.
- The audio codec is AAC.
- Its displayed dimensions are no greater than 1280 by 720, accounting for rotation.
- Its exact size is less than 3,000,000,000 bytes.

Otherwise, create a mobile artifact with FFmpeg. Preserve aspect ratio, never upscale, constrain the result to 1280 by 720, encode H.264 video with `yuv420p`, encode AAC audio, and place fast-start metadata at the beginning of the MP4 for responsive playback.

Calculate the available average video bitrate from the probed duration, a fixed high-quality AAC audio allowance, container overhead, and a maximum target of approximately 2.85 GB. Also cap the normal 720p video bitrate so short sessions do not become needlessly large. Use two-pass encoding for predictable size and quality. Probe the final artifact and accept it only if it satisfies the compatibility rules and remains below the strict 3,000,000,000-byte ceiling.

Write all encoding output and pass logs to job-scoped temporary paths. Atomically rename a verified result to a stable name ending in `-720p-mobile.mp4`. Never expose temporary or unverified output.

## Worker lifecycle and recovery

The conversion worker has its own polling and wake mechanism, FFmpeg child process tracking, progress parsing, inactivity timeout, and process-tree termination. It does not share busy state with the download worker.

On shutdown, terminate an active conversion cleanly. On startup, return interrupted conversion jobs to the queue. Reconciliation compares conversion records with the filesystem and probe results:

- Create a conversion job for every tracked completed HQ download that lacks one.
- Mark a deterministic reusable source as completed without copying it.
- Adopt a valid, deterministically named mobile output.
- Requeue a missing or invalid output from an interrupted job.
- Remove stale temporary output and pass logs within that job's directory.
- Leave explicit conversion failures failed until the operator requests a retry, preventing endless conversion loops.

If the HQ source is missing, report a sanitized conversion failure while keeping the database association intact. All paths must continue to be resolved beneath the configured download root.

## API and interface

Completed-download responses expose two explicit variants:

- `hq`: availability, exact byte size, and an HQ file URL.
- `lq`: conversion state, progress or message, exact byte size when ready, and an LQ file URL.

The file endpoint accepts only a validated `hq` or `lq` selector. It never accepts a client-provided path or filename. Both variants retain MP4 content type, attachment disposition, `Content-Length`, and HTTP Range support. When the HQ source meets the deterministic reuse policy, both selectors may safely resolve to the same physical file.

Each completed item displays controls such as `Download HQ · 10.4 GB` and `Download LQ · 2.7 GB`. Before LQ completion, the disabled control displays queued or conversion progress. A failed conversion leaves HQ available and shows a concise failure state with a retry action.

Conversion changes travel over the existing server-sent events connection so the client updates without page refresh. Add a narrowly scoped retry endpoint that requeues only a failed conversion job.

## Errors and observability

Sanitize FFmpeg and FFprobe errors before storing or returning them. Keep bounded messages and do not expose provider URLs or environment data. A spawn error, inactivity timeout, invalid media, missing streams, incompatible final output, or oversized result fails only the conversion job.

Conversion progress is best-effort and must remain below 100 percent until final probing and atomic publication succeed. The HQ file remains downloadable throughout conversion and after any conversion failure.

## Verification

Automated coverage will verify:

- Database migration, claiming, state transitions, retry, and restart recovery.
- Startup reconciliation for tracked completed downloads only.
- Deterministic source reuse and required-transcode decisions.
- Duration-based bitrate calculation and strict 3 GB validation.
- Atomic publication and cleanup of temporary output.
- Concurrent operation of independent download and conversion workers.
- FFmpeg failure, timeout, shutdown, restart, and manual retry behavior.
- HQ/LQ response metadata, path safety, attachment headers, and Range responses.
- Client conversion states and human-readable file-size labels.

A local integration test will generate short synthetic media with FFmpeg, run it through the conversion pipeline, and validate the output with FFprobe. Final verification includes the complete typecheck, unit/API tests, and production builds.
