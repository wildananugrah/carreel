/**
 * Post-generate hook: creates index.ts barrel files for Prisma clients.
 * Prisma v7 generates client.ts as the entry point, but our imports use
 * directory imports (from '../generated/prisma') which need index.ts.
 *
 * Run after: bunx prisma generate
 */
import fs from "node:fs";
import path from "node:path";

const barrel = 'export * from "./client";\nexport * from "./models";\n';

const targets = [
  path.resolve(import.meta.dirname, "../../backend/src/generated/prisma/index.ts"),
  path.resolve(import.meta.dirname, "../../../planner-app/backend/src/generated/prisma/index.ts"),
];

for (const target of targets) {
  fs.writeFileSync(target, barrel);
  console.log(`Created barrel: ${path.relative(process.cwd(), target)}`);
}
