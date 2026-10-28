import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/auth.js";
import { ensureRoles } from "../src/permissions.js";

// usage: npm -w backend run create-admin -- you@example.com 'a long password' "Your Name"
const [email, password, name = ""] = process.argv.slice(2);
if (!email || !password || password.length < 10) {
  console.error("usage: create-admin <email> <password (min 10 chars)> [name]");
  process.exit(1);
}
const prisma = new PrismaClient();
await ensureRoles();
const owner = await prisma.role.findUniqueOrThrow({ where: { name: "Owner" } });
const passwordHash = await hashPassword(password);
const u = await prisma.adminUser.upsert({
  where: { email: email.toLowerCase() },
  create: { email: email.toLowerCase(), name, passwordHash, roleId: owner.id },
  update: { passwordHash, name: name || undefined, roleId: owner.id, active: true },
});
console.log(`admin ready: ${u.email}`);
await prisma.$disconnect();
