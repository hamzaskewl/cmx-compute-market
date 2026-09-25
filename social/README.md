# CX social kit

The website uses the selected Hour Dial mark on a transparent background. This kit places the same mark on black for social profiles and posts. All graphics are monochrome and use the original B200 illustration where hardware is shown.

## Exported files

| File | Size | Use |
| --- | ---: | --- |
| `logo-black-1024.png` | 1024 × 1024 | General social profile/logo |
| `x-avatar-400.png` | 400 × 400 | X profile photo |
| `x-header-market.png` | 1500 × 500 | X header: market message |
| `x-header-launch.png` | 1500 × 500 | X header: launchpad message |
| `post-01-b200.png` | 1600 × 900 | B200 announcement |
| `post-02-launch.png` | 1600 × 900 | Launchpad announcement |
| `post-03-thesis.png` | 1600 × 900 | GPU-hour positioning |
| `post-04-flywheel.png` | 1600 × 900 | Proposed flywheel discussion |
| `logo-transparent.png` | 1254 × 1254 | Transparent master symbol |
| `contact-sheet.png` | 1500 × 1094 | Overview of both headers and four posts |

Editable SVG files with matching names are in `exports/`. Run `node social/render-social.mjs` from the repository root to regenerate the PNGs.

## Suggested X posts

### Post 01 — B200

Compute has a price. Start with the B200 GPU-hour reference. CX is building the market layer around it on Solana devnet.

Explore: https://cmx-compute-market-production.up.railway.app/

Alt text: A monochrome graphic with the words “Compute has a price” beside the original B200 GPU illustration. It notes the B200 GPU-hour reference is live on devnet.

### Post 02 — Launchpad

Your token can trade against cmB200, the B200 GPU-hour market asset. Launch through Meteora DBC on CX devnet.

Try the launchpad: https://cmx-compute-market-production.up.railway.app/launch

Alt text: A black and white graphic reading “Your token. A compute pair.” A diagram connects “Your token” to “cmB200” and credits Meteora DBC.

### Post 03 — Thesis

GPU stocks and GPU-hours are different market units. CX starts with the price of a B200 hour and lets builders launch markets paired with its devnet asset.

What would you build around a GPU-hour?

Alt text: A black and gray graphic reading “GPU stocks ≠ GPU hours” with the CX emblem and B200 GPU-hour label.

### Post 04 — Flywheel proposal

What should market fees help build? We’re designing a flywheel that could route an agreed share toward liquidity and, where viable, a compute reserve.

This is a proposal; fee routing is not active on devnet. Which part should come first?

Alt text: A dark graphic asking what market fees should help build. It shows Trade → Liquidity → Compute and clearly labels the idea a design proposal.

## Claims boundary

CX currently runs on Solana devnet with test assets. The Ornn B200 index is a reference price, not proof of owned GPU inventory. The fee flywheel and GPU reserve purchases are proposed, not active.
