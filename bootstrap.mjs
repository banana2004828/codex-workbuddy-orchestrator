#!/usr/bin/env node

import { runCli } from "./scripts/install.mjs";

await runCli(process.argv.slice(2));
