---
name: CX Compute Exchange
description: A monochrome, chart-first market interface for B200 GPU-hours, with a separate Meteora DBC launchpad.
colors:
  canvas: "#131313"
  panel: "#232323"
  rule: "#4d4d4d"
  signal: "#f2f2f2"
  text: "#f2f2f2"
  muted: "#b2b2b2"
  paper: "#e8e8e8"
typography:
  display:
    fontFamily: "Onest, sans-serif"
    fontSize: "clamp(43px, 5vw, 76px)"
    fontWeight: 650
    lineHeight: 1
    letterSpacing: "-0.07em"
  body:
    fontFamily: "Onest, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  data:
    fontFamily: "Azeret Mono, monospace"
    fontSize: "12px"
    fontWeight: 600
rounded:
  square: "0"
spacing:
  mobile-gutter: "20px"
  desktop-gutter: "68px"
components:
  button-primary:
    backgroundColor: "{colors.signal}"
    textColor: "{colors.canvas}"
    rounded: "{rounded.square}"
    height: "53px"
    padding: "0 18px"
---

# CX Compute Exchange

The B200 price chart is the first product object on the home page. The user-selected AI-generated Hour Dial emblem is the CX mark, shown transparently on the website and in the favicon. Black-backed logo treatments are reserved for social assets. Black, white, and gray keep the interface quiet. Copy is short on operating surfaces; detailed terms belong in docs.

## Layout

- Home: sticky navigation, large B200 chart, original B200 pixel illustration and mint panel, short compute thesis, proposed flywheel, launchpad invitation.
- Launchpad: name, ticker, description, website, and image fields on the left; a market preview and real Ornn B200 reference chart on the right. On mobile the preview follows the form.
- Markets: real B200 launches from chain data, plus disabled coming-soon GPU labels off the home page.
- Docs: readable explanation of the asset, Meteora DBC, proposed fee flywheel, and mainnet requirements.

## Asset use

Keep `assets/plates/gpu-b200.png` as the B200 illustration. Do not replace it with newly generated GPUs. The selected Hour Dial image is at `public/brand/cx-emblem.png`; the three original concepts remain in `references/logo-options/`. The official full-color Meteora logo from `MeteoraAg/brand-kit` is used alongside its DBC attribution. Graphic variety comes from the emblem, chart, simple grid, and token-pair composition.

## Truth constraints

Use real Ornn price history and real onchain B200 markets. The launch preview chart shows the B200 GPU-hour reference, never a price for the token being created. Fee recycling and GPU collateral purchases are proposed, and must be described as such until implemented and verified. Devnet test assets are never presented as mainnet funds.
