const fs = require('fs');
const path = require('path');

const srcDir = __dirname;
const destDir = path.join(__dirname, 'dist-firefox');

// Create/clear destination directory
if (fs.existsSync(destDir)) {
  fs.rmSync(destDir, { recursive: true, force: true });
}
fs.mkdirSync(destDir);

// Files and folders to copy
const items = ['background.js', 'content.js', 'popup.html', 'popup.css', 'popup.js', 'icons'];

items.forEach(item => {
  const srcPath = path.join(srcDir, item);
  const destPath = path.join(destDir, item);
  
  if (fs.existsSync(srcPath)) {
    if (fs.statSync(srcPath).isDirectory()) {
      fs.cpSync(srcPath, destPath, { recursive: true });
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
});

// Modify manifest for Firefox
const manifest = require('./manifest.json');
manifest.browser_specific_settings = {
  gecko: {
    id: "youtube-auto-pause@example.com",
    strict_min_version: "121.0"
  }
};

fs.writeFileSync(
  path.join(destDir, 'manifest.json'),
  JSON.stringify(manifest, null, 2)
);

console.log('Firefox extension built successfully in /dist-firefox');
