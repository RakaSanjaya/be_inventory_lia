import dotenv from 'dotenv';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

dotenv.config();

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/inventory';

async function seed() {
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected to MongoDB');

  const db = mongoose.connection.db!;

  // Clear collections
  await db.collection('users').deleteMany({});
  await db.collection('categories').deleteMany({});
  await db.collection('locations').deleteMany({});
  console.log('🗑️  Cleared existing data');

  // Seed users
  const passwordHash = await bcrypt.hash('admin123', 10);
  const staffHash    = await bcrypt.hash('staff123', 10);

  const users = [
    {
      name: 'Super Admin',
      email: 'superadmin@kampus.ac.id',
      password: passwordHash,
      role: 'super_admin',
      department: 'IT Department',
      phone: '081234567890',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      name: 'Admin Inventaris',
      email: 'admin@kampus.ac.id',
      password: passwordHash,
      role: 'admin',
      department: 'Sarana & Prasarana',
      phone: '081234567891',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      name: 'Budi Santoso',
      email: 'staff@kampus.ac.id',
      password: staffHash,
      role: 'staff',
      department: 'Teknik Informatika',
      phone: '081234567892',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      name: 'Ani Mahasiswi',
      email: 'mahasiswa@kampus.ac.id',
      password: staffHash,
      role: 'student',
      department: 'Sistem Informasi',
      phone: '081234567893',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  await db.collection('users').insertMany(users);
  console.log('👤 Users seeded');

  // Seed categories
  const categories = [
    { name: 'Elektronik',    description: 'Peralatan elektronik seperti laptop, proyektor, dll', createdAt: new Date(), updatedAt: new Date() },
    { name: 'Furnitur',      description: 'Meja, kursi, lemari, rak', createdAt: new Date(), updatedAt: new Date() },
    { name: 'Alat Tulis',    description: 'Kertas, bolpoin, spidol (habis pakai)', createdAt: new Date(), updatedAt: new Date() },
    { name: 'Olahraga',      description: 'Peralatan olahraga', createdAt: new Date(), updatedAt: new Date() },
    { name: 'Lab',           description: 'Peralatan laboratorium', createdAt: new Date(), updatedAt: new Date() },
    { name: 'Kebersihan',    description: 'Perlengkapan kebersihan (habis pakai)', createdAt: new Date(), updatedAt: new Date() },
  ];

  const catResult = await db.collection('categories').insertMany(categories);
  console.log('🏷️  Categories seeded');

  // Seed locations
  const locations = [
    { building: 'Gedung A', room: 'Lab Komputer 1', shelf: 'Rak A-1', description: 'Lantai 2', createdAt: new Date(), updatedAt: new Date() },
    { building: 'Gedung A', room: 'Lab Komputer 2', shelf: 'Rak B-1', description: 'Lantai 2', createdAt: new Date(), updatedAt: new Date() },
    { building: 'Gedung B', room: 'Ruang Kelas 101', shelf: '',        description: 'Lantai 1', createdAt: new Date(), updatedAt: new Date() },
    { building: 'Gedung B', room: 'Gudang',          shelf: 'Rak C-3', description: 'Basement', createdAt: new Date(), updatedAt: new Date() },
    { building: 'Gedung C', room: 'Sekretariat',     shelf: 'Laci 1',  description: 'Lantai 1', createdAt: new Date(), updatedAt: new Date() },
  ];

  const locResult = await db.collection('locations').insertMany(locations);
  console.log('📍 Locations seeded');

  // Cat & Loc IDs
  const catIds = Object.values(catResult.insertedIds);
  const locIds = Object.values(locResult.insertedIds);

  // Seed items
  const items = [
    { name: 'Laptop Dell Latitude 14', code: 'LAP-001', type: 'returnable', category: catIds[0], location: locIds[0], totalQty: 10, availableQty: 8, condition: 'good',  minStock: 2, description: 'Laptop untuk lab komputer', createdAt: new Date(), updatedAt: new Date() },
    { name: 'Proyektor Epson EB-S41',  code: 'PRO-001', type: 'returnable', category: catIds[0], location: locIds[2], totalQty: 5,  availableQty: 4, condition: 'good',  minStock: 1, description: 'Proyektor untuk presentasi', createdAt: new Date(), updatedAt: new Date() },
    { name: 'Tripod Kamera',           code: 'TRI-001', type: 'returnable', category: catIds[0], location: locIds[3], totalQty: 3,  availableQty: 3, condition: 'good',  minStock: 1, description: 'Tripod kamera profesional', createdAt: new Date(), updatedAt: new Date() },
    { name: 'Meja Kerja Kayu',         code: 'MJA-001', type: 'returnable', category: catIds[1], location: locIds[2], totalQty: 20, availableQty: 18, condition: 'fair', minStock: 5, description: 'Meja kerja standar', createdAt: new Date(), updatedAt: new Date() },
    { name: 'Kursi Ergonomis',         code: 'KUR-001', type: 'returnable', category: catIds[1], location: locIds[2], totalQty: 40, availableQty: 35, condition: 'good', minStock: 10, description: 'Kursi kantor ergonomis', createdAt: new Date(), updatedAt: new Date() },
    { name: 'Kertas A4 (Rim)',         code: 'KRT-001', type: 'consumable', category: catIds[2], location: locIds[4], totalQty: 50, availableQty: 45, condition: 'good', minStock: 10, description: '80gsm, 500 lembar/rim', createdAt: new Date(), updatedAt: new Date() },
    { name: 'Spidol Whiteboard',       code: 'SPI-001', type: 'consumable', category: catIds[2], location: locIds[4], totalQty: 100,availableQty: 80, condition: 'good', minStock: 20, description: 'Spidol whiteboard aneka warna', createdAt: new Date(), updatedAt: new Date() },
    { name: 'Tisu Basah (Pack)',       code: 'TIS-001', type: 'consumable', category: catIds[5], location: locIds[3], totalQty: 200,availableQty: 5, condition: 'good',  minStock: 50, description: 'Tisu basah kemasan 40 lembar', createdAt: new Date(), updatedAt: new Date() },
  ];

  await db.collection('items').insertMany(items);
  console.log('📦 Items seeded');

  console.log('\n✨ Seeding selesai! Akun yang tersedia:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('👑 Super Admin : superadmin@kampus.ac.id / admin123');
  console.log('🔑 Admin       : admin@kampus.ac.id        / admin123');
  console.log('👨 Staff       : staff@kampus.ac.id        / staff123');
  console.log('🎓 Mahasiswa   : mahasiswa@kampus.ac.id    / staff123');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  await mongoose.disconnect();
}

seed().catch(err => { console.error('❌ Seed error:', err); process.exit(1); });
