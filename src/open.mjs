import { spawn } from "node:child_process";

export function openLocalUrl(url, platform = process.platform) {
  const options = { detached: true, stdio: "ignore", windowsHide: true };
  let child;
  if (platform === "win32") child = spawn("cmd", ["/c", "start", "", url], options);
  else if (platform === "darwin") child = spawn("open", [url], options);
  else child = spawn("xdg-open", [url], options);
  child.unref();
}
