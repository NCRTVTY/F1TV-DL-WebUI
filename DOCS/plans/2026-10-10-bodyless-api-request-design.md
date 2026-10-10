# Bodyless API request design

## Problem

The client API helper unconditionally sends `Content-Type: application/json`. Fastify correctly rejects a request carrying that header when its body is empty, so the queue's cancel request never reaches the cancellation route. The same defect affects other bodyless mutations such as credential removal.

## Design

Move the shared request helper into a small client API module and construct its headers with the browser's `Headers` API. Add the JSON content type only when the request has a body and the caller did not provide a content type. Bodyless `POST`, `DELETE`, and read requests will therefore omit the header, while existing JSON mutations retain their current behavior. Explicit caller headers remain authoritative.

Do not send placeholder objects and do not weaken server parsing. Keep the server routes unchanged.

## Verification

Add focused unit coverage for a bodyless mutation, a JSON-body mutation, and an explicit content-type override. Run the complete verification suite under the pinned Node version. Commit and push the implementation, then monitor Drone through repository verification, image publication, deployment, and the commit-specific health check.
