import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "social", "exports");
await fs.mkdir(out, { recursive: true });

const logo = `data:image/png;base64,${(await fs.readFile(path.join(root, "public/brand/cx-emblem.png"))).toString("base64")}`;
const gpu = `data:image/png;base64,${(await fs.readFile(path.join(root, "assets/plates/gpu-b200.png"))).toString("base64")}`;
const c = { black: "#0b0b0b", panel: "#1b1b1b", gray: "#898989", faint: "#555555", white: "#f4f4f4" };

function frame(width, height, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" fill="${c.black}"/>
    <style>
      text{font-family:Arial,Helvetica,sans-serif}
      .display{font-weight:800;letter-spacing:-.055em}
      .label{font-weight:700;letter-spacing:.2em}
      .body{font-weight:500;letter-spacing:-.015em}
    </style>
    ${body}
  </svg>`;
}

function image(src, x, y, size, opacity = 1) {
  return `<image x="${x}" y="${y}" width="${size}" height="${size}" opacity="${opacity}" href="${src}"/>`;
}

function lockup(x, y, dark = true) {
  return `${image(logo, x, y - 44, 74)}<text x="${x + 78}" y="${y}" fill="${dark ? c.white : c.black}" font-size="21" class="label">COMPUTE EXCHANGE</text>`;
}

function arrow(x, y, size = 48, color = c.white) {
  return `<path d="M${x} ${y + size}L${x + size} ${y}M${x + size * .28} ${y}H${x + size}V${y + size * .72}" fill="none" stroke="${color}" stroke-width="4"/>`;
}

const assets = [
  ["logo-black-1024", 1024, 1024, frame(1024, 1024, `
    <rect x="38" y="38" width="948" height="948" fill="none" stroke="#343434" stroke-width="2"/>
    ${image(logo, 72, 72, 880)}
  `)],
  ["x-header-market", 1500, 500, frame(1500, 500, `
    <path d="M300 76V425M300 425H1440" stroke="#424242" stroke-width="2"/>
    <text x="354" y="119" fill="${c.gray}" font-size="19" class="label">CX / COMPUTE EXCHANGE</text>
    <text x="348" y="240" fill="${c.white}" font-size="77" class="display">THE MARKET FOR</text>
    <text x="348" y="330" fill="${c.white}" font-size="88" class="display">GPU-HOURS.</text>
    <text x="354" y="400" fill="#bdbdbd" font-size="19" class="label">B200 LIVE ON SOLANA DEVNET</text>
    ${image(logo, 1048, -34, 478, .52)}
  `)],
  ["x-header-launch", 1500, 500, frame(1500, 500, `
    <rect x="324" y="79" width="852" height="342" fill="#202020"/>
    <path d="M324 79H1176M324 421H1176" stroke="#777" stroke-width="2"/>
    <text x="367" y="140" fill="${c.gray}" font-size="18" class="label">THE CX LAUNCHPAD</text>
    <text x="360" y="248" fill="${c.white}" font-size="75" class="display">LAUNCH AGAINST</text>
    <text x="360" y="334" fill="${c.white}" font-size="84" class="display">COMPUTE.</text>
    <text x="367" y="391" fill="#c4c4c4" font-size="18" class="label">cmB200  /  METEORA DBC  /  DEVNET</text>
    ${image(logo, 1073, 2, 450, .28)}
  `)],
  ["post-01-b200", 1600, 900, frame(1600, 900, `
    ${lockup(82, 96)}
    <path d="M82 139H1518" stroke="#4d4d4d" stroke-width="2"/>
    <text x="77" y="340" fill="${c.white}" font-size="115" class="display">COMPUTE</text>
    <text x="77" y="458" fill="${c.white}" font-size="108" class="display">HAS A PRICE.</text>
    <text x="84" y="548" fill="#b9b9b9" font-size="31" class="body">Start with a B200 GPU-hour.</text>
    <text x="82" y="717" fill="none" stroke="#3b3b3b" stroke-width="3" font-size="155" class="display">B200</text>
    ${image(gpu, 880, 62, 720)}
    <path d="M82 788H1518" stroke="#555" stroke-width="2"/>
    <text x="84" y="842" fill="${c.white}" font-size="20" class="label">B200 GPU-HOUR REFERENCE</text>
    <text x="1100" y="842" fill="${c.gray}" font-size="19" class="label">LIVE ON DEVNET</text>
  `)],
  ["post-02-launch", 1600, 900, frame(1600, 900, `
    ${lockup(82, 96)}
    <path d="M82 139H1518" stroke="#4d4d4d" stroke-width="2"/>
    <text x="77" y="306" fill="${c.white}" font-size="100" class="display">YOUR TOKEN.</text>
    <text x="77" y="421" fill="${c.white}" font-size="100" class="display">A COMPUTE PAIR.</text>
    <text x="84" y="508" fill="#b9b9b9" font-size="29" class="body">Launch with cmB200 as the quote asset.</text>
    <rect x="84" y="592" width="558" height="112" fill="#eeeeee"/>
    <text x="112" y="662" fill="#111" font-size="42" class="display">YOUR TOKEN</text>
    ${arrow(705, 624, 55)}
    <rect x="830" y="592" width="608" height="112" fill="#303030" stroke="#666" stroke-width="2"/>
    <text x="860" y="662" fill="${c.white}" font-size="43" class="display">cmB200</text>
    <path d="M82 788H1518" stroke="#555" stroke-width="2"/>
    <text x="84" y="842" fill="${c.white}" font-size="20" class="label">POWERED BY METEORA DBC</text>
    <text x="1288" y="842" fill="${c.gray}" font-size="19" class="label">DEVNET</text>
  `)],
  ["post-03-thesis", 1600, 900, frame(1600, 900, `
    ${lockup(82, 96)}
    <path d="M82 139H1518" stroke="#4d4d4d" stroke-width="2"/>
    <text x="77" y="325" fill="${c.white}" font-size="109" class="display">GPU STOCKS</text>
    <text x="77" y="447" fill="${c.gray}" font-size="107" class="display">≠ GPU HOURS.</text>
    <text x="84" y="538" fill="#c1c1c1" font-size="30" class="body">CX puts the price of compute at the center of a market.</text>
    <rect x="84" y="634" width="660" height="106" fill="#292929"/>
    <text x="114" y="700" fill="${c.white}" font-size="37" class="display">B200 / GPU-HOUR</text>
    ${image(logo, 1046, 305, 420, .78)}
    <path d="M82 788H1518" stroke="#555" stroke-width="2"/>
    <text x="84" y="842" fill="${c.white}" font-size="20" class="label">A DIFFERENT MARKET UNIT</text>
    <text x="1233" y="842" fill="${c.gray}" font-size="19" class="label">CX / B200</text>
  `)],
  ["post-04-flywheel", 1600, 900, frame(1600, 900, `
    ${lockup(82, 96)}
    <path d="M82 139H1518" stroke="#4d4d4d" stroke-width="2"/>
    <text x="77" y="281" fill="${c.white}" font-size="85" class="display">WHAT SHOULD MARKET</text>
    <text x="77" y="376" fill="${c.white}" font-size="85" class="display">FEES HELP BUILD?</text>
    <text x="84" y="468" fill="#bdbdbd" font-size="28" class="body">Our proposed compute flywheel:</text>
    <path d="M84 570H1518M84 730H1518" stroke="#454545" stroke-width="2"/>
    <text x="84" y="620" fill="${c.gray}" font-size="18" class="label">01 / MARKET</text>
    <text x="84" y="681" fill="${c.white}" font-size="44" class="display">Trade</text>
    ${arrow(475, 631, 48, c.gray)}
    <text x="626" y="620" fill="${c.gray}" font-size="18" class="label">02 / DEPTH</text>
    <text x="626" y="681" fill="${c.white}" font-size="44" class="display">Liquidity</text>
    ${arrow(1034, 631, 48, c.gray)}
    <text x="1183" y="620" fill="${c.gray}" font-size="18" class="label">03 / RESERVE</text>
    <text x="1183" y="681" fill="${c.white}" font-size="44" class="display">Compute</text>
    <text x="84" y="818" fill="${c.gray}" font-size="21" class="body">Design proposal. Fee routing is not active on devnet.</text>
  `)],
];

for (const [name, width, height, source] of assets) {
  await fs.writeFile(path.join(out, `${name}.svg`), source);
  await sharp(Buffer.from(source)).png({ compressionLevel: 9 }).toFile(path.join(out, `${name}.png`));
  console.log(`${name}: ${width}×${height}`);
}
await sharp(path.join(out, "logo-black-1024.png")).resize(400, 400).png({ compressionLevel: 9 }).toFile(path.join(out, "x-avatar-400.png"));
await fs.copyFile(path.join(root, "public/brand/cx-emblem.png"), path.join(out, "logo-transparent.png"));
const tiles = [
  ["x-header-market", 0, 0, 750, 250],
  ["x-header-launch", 750, 0, 750, 250],
  ["post-01-b200", 0, 250, 750, 422],
  ["post-02-launch", 750, 250, 750, 422],
  ["post-03-thesis", 0, 672, 750, 422],
  ["post-04-flywheel", 750, 672, 750, 422],
];
await sharp({ create: { width: 1500, height: 1094, channels: 4, background: c.black } })
  .composite(await Promise.all(tiles.map(async ([name, left, top, width, height]) => ({
    input: await sharp(path.join(out, `${name}.png`)).resize(width, height).toBuffer(),
    left,
    top,
  }))))
  .png({ compressionLevel: 9 })
  .toFile(path.join(out, "contact-sheet.png"));
console.log("x-avatar-400: 400×400");
