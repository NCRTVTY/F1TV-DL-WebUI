const ansiPattern = /\u001b\[[0-9;]*m/g;

export function stripAnsi(value: string): string {
  return value.replace(ansiPattern, "");
}

export function redact(value: string, secrets: string[] = []): string {
  let output = stripAnsi(value);
  for (const secret of secrets) {
    if (secret) output = output.split(secret).join("[REDACTED]");
  }

  return output
    .replace(/(password|passwd|f1tv_pass)(\s*[=:]\s*)\S+/gi, "$1$2[REDACTED]")
    .replace(/(entitlement[_-]?token|authorization)(\s*[=:]\s*)\S+/gi, "$1$2[REDACTED]")
    .replace(/([?&](?:token|auth|signature|sig)=)[^&\s]+/gi, "$1[REDACTED]");
}
