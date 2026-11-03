#!/usr/bin/env node
// Exit 0 if deploys are frozen. A deploy loop checks this first: `node scripts/ops/frozen.mjs && continue`.
import { isFrozen } from "./ops-log.mjs";
process.exitCode = isFrozen() ? 0 : 1;
