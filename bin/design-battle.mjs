#!/usr/bin/env node

import { main } from "../src/cli.mjs";

process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});

try {
  await main(process.argv.slice(2));
} catch (error) {
  console.error(error?.stack || error);
  process.exitCode = 1;
}
