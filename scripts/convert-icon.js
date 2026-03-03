import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Icon sizes for Android
const sizes = {
  'mipmap-mdpi': 48,
  'mipmap-hdpi': 72,
  'mipmap-xhdpi': 96,
  'mipmap-xxhdpi': 144,
  'mipmap-xxxhdpi': 192
};

const svgPath = path.join(__dirname, '..', 'public', 'lyseris.svg');
const androidResPath = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'res');

async function convertIcons() {
  console.log('Converting SVG to PNG icons for Android...\n');
  
  // Read SVG file
  const svgBuffer = fs.readFileSync(svgPath);
  
  for (const [folder, size] of Object.entries(sizes)) {
    const folderPath = path.join(androidResPath, folder);
    
    // Create folder if it doesn't exist
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }
    
    // Convert for regular launcher icon
    const regularIconPath = path.join(folderPath, 'ic_launcher.png');
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(regularIconPath);
    console.log(`✓ Created ${folder}/ic_launcher.png (${size}x${size})`);
    
    // Convert for round launcher icon
    const roundIconPath = path.join(folderPath, 'ic_launcher_round.png');
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(roundIconPath);
    console.log(`✓ Created ${folder}/ic_launcher_round.png (${size}x${size})`);
  }
  
  console.log('\n✅ All icons created successfully!');
  console.log('\nNote: The round icons are currently square. For a true round icon,');
  console.log('consider using a circular mask or redesigning the icon with a circular shape.');
}

convertIcons().catch(err => {
  console.error('Error converting icons:', err);
  process.exit(1);
});
