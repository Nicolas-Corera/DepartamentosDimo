import { execFileSync } from "node:child_process";

try {
  execFileSync("git", ["config", "core.hooksPath", ".githooks"], { stdio: "pipe" });
  console.log("Hook de secretos activado (core.hooksPath = .githooks).");
} catch {
  console.log("No se pudo activar el hook de secretos: esto no parece un repo de git.");
}
