import 'dotenv/config';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import config from '../src/config.js';
import AdminUser from '../src/models/AdminUser.js';

async function main() {
  await mongoose.connect(config.mongo.uri);
  const username = process.argv[2] || config.admin.username;
  const password = process.argv[3] || config.admin.password;

  const existing = await AdminUser.findOne({ username }).lean();
  if (existing) {
    console.log(`El usuario "${username}" ya existe.`);
    await mongoose.disconnect();
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await AdminUser.create({ username, passwordHash });
  console.log(`Usuario "${username}" creado correctamente.`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
