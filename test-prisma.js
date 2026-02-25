const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
console.log('All Prisma models:');
Object.keys(p).filter(k => k[0] !== '$').sort().forEach(m => console.log(' -', m));
