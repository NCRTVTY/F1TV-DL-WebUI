# Worker watchdog CI stability design

## Problem

Drone build 6 failed in the worker supervision test even though the same commit passes locally. The test configures the production inactivity watchdog with a 60-millisecond deadline. On the shared Drone runner, process startup and event-loop scheduling can exceed that deadline, so the worker can terminate the successful second fixture before its first output is delivered.

The assertion is valid: a silent downloader must fail and the queue must advance. The 60-millisecond wall-clock assumption is not a valid part of that behavior.

## Design

Keep the test end-to-end through the real child-process and worker paths, but give the test watchdog a one-second inactivity window and give Vitest enough time to observe both jobs. The silent fixture sleeps for 30 seconds, so it remains unambiguously silent beyond the watchdog. The successful fixture writes output immediately, and the chatty fixture writes every 30 milliseconds, leaving a substantial scheduling margin without weakening what the tests prove.

Production configuration and worker behavior remain unchanged. Do not add retries, skip conditions, platform checks, or CI-specific branches.

## Verification

Run the worker test repeatedly to exercise process scheduling, then run the full repository verification command under the pinned Node version. Commit and push the fix, verify that the new commit reaches `origin/main`, and monitor its Drone build through repository verification, image publication, deployment, and health checking.
