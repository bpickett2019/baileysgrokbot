import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { expect, it } from "vitest";

// Opt-in, offline smoke against the built image; no host data or published ports.
it.skipIf(process.env.VERIFY_DOCKER_COMPUTER_STARTUP !== "1").each([
  [1000, 1000],
  [501, 20],
  [12345, 12345],
])(
  "starts the desktop and session bus as %s:%s",
  async (uid, gid) => {
    const name = `rakazo-startup-test-${randomUUID()}`;
    const docker = (...args: string[]) =>
      execFileSync("docker", args, { encoding: "utf8", timeout: 15_000, stdio: "pipe" });
    try {
      docker(
        "run",
        "-d",
        "--name",
        name,
        "--user",
        `${uid}:${gid}`,
        "--network",
        "none",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges:true",
        "--tmpfs",
        `/home/rakazo:uid=${uid},gid=${gid},mode=700`,
        process.env.RAKAZO_COMPUTER_IMAGE ?? "rakazo/computer:local",
      );
      let ready = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (docker("inspect", "--format", "{{.State.Running}}", name).trim() !== "true") {
          throw new Error(`Computer exited during startup:\n${docker("logs", name)}`);
        }
        try {
          docker(
            "exec",
            name,
            "bash",
            "-c",
            [
              "set -euo pipefail",
              "source /tmp/rakazo/dbus-session",
              "dbus-send --session --print-reply --dest=org.freedesktop.DBus / org.freedesktop.DBus.ListNames",
              "xdpyinfo -display :1 >/dev/null",
              "pgrep -f '^/usr/libexec/xdg-desktop-portal$' >/dev/null",
              "pgrep -f '^/usr/libexec/xdg-desktop-portal-gtk$' >/dev/null",
              "pgrep -f '^/usr/bin/python3 /usr/bin/websockify' >/dev/null",
            ].join("\n"),
          );
          ready = true;
          break;
        } catch {
          await setTimeout(100);
        }
      }
      expect(ready, docker("logs", name)).toBe(true);
      expect(docker("exec", name, "id", "-u").trim()).toBe(String(uid));
      expect(docker("inspect", "--format", "{{.State.OOMKilled}}", name).trim()).toBe("false");
    } finally {
      docker("rm", "-f", name);
    }
  },
  30_000,
);
