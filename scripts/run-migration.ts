import fs from 'fs/promises';
import path from 'path';
import { pg } from '../src/lib/core/db';
import { config } from '../src/config';

async function run() {
  try {
    const filePath = path.resolve(process.cwd(), 'db', 'migrations', '002_product_image_detections.sql');
    const sql = await fs.readFile(filePath, 'utf8');

    console.log('Applying migration:', filePath);
    await pg.query(sql);
    console.log('Migration applied successfully.');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await pg.end();
  }
}

run();
