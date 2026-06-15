import crypto from "node:crypto";
import os from "node:os";
import type { MachineProfile, ScanOptions } from "./types.js";

export function getMachineProfile(options: ScanOptions = {}): MachineProfile {
  const username = os.userInfo().username;
  const homeDir = options.homeDir ?? os.homedir();
  const platform = options.platform ?? process.platform;
  const hostname = os.hostname();
  const arch = os.arch();
  const machineId = crypto
    .createHash("sha256")
    .update([hostname, username, platform, arch].join("|"))
    .digest("hex")
    .slice(0, 24);

  return {
    machine_id: machineId,
    hostname,
    platform,
    arch,
    username,
    home_dir: homeDir,
    generated_at: new Date().toISOString()
  };
}
