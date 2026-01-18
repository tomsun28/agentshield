#!/usr/bin/env bun
import { runCli } from "./cli.js";

runCli(process.argv).catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
