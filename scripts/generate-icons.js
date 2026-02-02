/**
 * Generate Microsoft Store icon assets from source icon
 *
 * Requirements:
 * - Source icon: resources/icon.png (1024x1024 recommended)
 * - sharp: npm install --save-dev sharp
 *
 * Usage: npm run generate-icons
 */

const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const SOURCE_ICON = path.join(__dirname, '..', 'resources', 'icon.png');
const OUTPUT_DIR = path.join(__dirname, '..', 'resources', 'icons');

// Microsoft Store required icon sizes
const ICON_SIZES = [
  { name: 'StoreLogo.png', width: 50, height: 50 },
  { name: 'Square44x44Logo.png', width: 44, height: 44 },
  { name: 'Square71x71Logo.png', width: 71, height: 71 },
  { name: 'Square150x150Logo.png', width: 150, height: 150 },
  { name: 'Square310x310Logo.png', width: 310, height: 310 },
  { name: 'Wide310x150Logo.png', width: 310, height: 150 },
];

async function generateIcons() {
  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    console.log(`Created directory: ${OUTPUT_DIR}`);
  }

  // Verify source icon exists
  if (!fs.existsSync(SOURCE_ICON)) {
    console.error(`Source icon not found: ${SOURCE_ICON}`);
    console.error('Please ensure resources/icon.png exists (1024x1024 recommended)');
    process.exit(1);
  }

  console.log(`Source icon: ${SOURCE_ICON}`);
  console.log(`Output directory: ${OUTPUT_DIR}\n`);

  for (const icon of ICON_SIZES) {
    const outputPath = path.join(OUTPUT_DIR, icon.name);

    try {
      await sharp(SOURCE_ICON)
        .resize(icon.width, icon.height, {
          fit: 'contain',
          background: { r: 20, g: 21, b: 26, alpha: 1 } // #14151a - matches app background
        })
        .png()
        .toFile(outputPath);

      console.log(`Generated: ${icon.name} (${icon.width}x${icon.height})`);
    } catch (err) {
      console.error(`Failed to generate ${icon.name}: ${err.message}`);
    }
  }

  console.log('\nIcon generation complete!');
  console.log('\nNote: For the Wide310x150Logo.png, you may want to manually adjust');
  console.log('the design to better fill the wide aspect ratio.');
}

generateIcons().catch(err => {
  console.error('Icon generation failed:', err);
  process.exit(1);
});
