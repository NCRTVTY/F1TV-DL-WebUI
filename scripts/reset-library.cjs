// Explicit maintenance command; never runs during application startup or deployment.
const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");
async function reset() {
  if (!process.argv.includes("--confirm-reset-library"))
    throw new Error(
      "Pass --confirm-reset-library for the authorized fresh start",
    );
  const root = process.env.DATA_DIR || "/app/data";
  const db = new Database(path.join(root, "f1tv-dl-webui.sqlite"));
  db.pragma("busy_timeout = 5000");
  const assertIdle = () => {
    if (
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM jobs WHERE status IN ('queued','running')",
        )
        .get().count
    )
      throw new Error("Cancel pending downloads before resetting the library");
  };
  try {
    assertIdle();
    const backups = path.join(root, "backups");
    fs.mkdirSync(backups, { recursive: true, mode: 0o700 });
    const backup = path.join(
      backups,
      "before-fresh-start-" + Date.now() + ".sqlite",
    );
    await db.backup(backup);
    fs.chmodSync(backup, 0o600);
    db.transaction(() => {
      assertIdle();
      const before = db
        .prepare("SELECT value FROM settings WHERE key='f1tv_credentials'")
        .get()?.value;
      db.exec("DELETE FROM pending_deletions; DELETE FROM jobs;");
      db.prepare("DELETE FROM settings WHERE key <> 'f1tv_credentials'").run();
      const after = db
        .prepare("SELECT value FROM settings WHERE key='f1tv_credentials'")
        .get()?.value;
      if (before !== after)
        throw new Error("Saved account preservation failed");
    })();
    console.log(
      JSON.stringify({
        libraryReset: true,
        savedAccountPreserved: true,
        privateBackupCreated: true,
        mediaFilesChanged: false,
      }),
    );
  } finally {
    db.close();
  }
}
reset().catch(() => {
  console.error(
    "Library reset did not complete; no account values are logged. Check that the queue is empty and local data is writable.",
  );
  process.exitCode = 1;
});
