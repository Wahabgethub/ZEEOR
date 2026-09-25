import fs from 'node:fs';
import bcrypt from '/home/ubuntu/zeeor-fashion-store/node_modules/bcryptjs/index.js';
const path = '/home/ubuntu/zeeor-fashion-store/data/store.json';
const data = JSON.parse(fs.readFileSync(path, 'utf8'));
const reseller = data.resellers[0];
reseller.passwordHash = bcrypt.hashSync('ZeeorPartner#2026', 12);
fs.writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
