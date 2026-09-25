import Image from "next/image";
import type { CSSProperties } from "react";
import styles from "./powered-by-slider.module.css";

const integrations = [
  { name: "Ornn", src: "/brand/ornn.svg", width: 102, height: 22.359, displayWidth: 125 },
  { name: "Meteora", src: "/brand/meteora.svg", width: 1038, height: 240, displayWidth: 130, dbc: true },
  { name: "Solana", src: "/brand/solana.svg", width: 646, height: 96, displayWidth: 145 },
  { name: "Irys", src: "/brand/irys.svg", width: 150, height: 31.695, displayWidth: 115 },
  { name: "Helius", src: "/brand/helius.svg", width: 562, height: 118, displayWidth: 130 },
] as const;

function LogoGroup({ duplicate = false }: { duplicate?: boolean }) {
  return <div aria-hidden={duplicate || undefined} className={styles.group} role={duplicate ? undefined : "list"}>
    {integrations.map((integration) => <span className={styles.logo} key={integration.name} role={duplicate ? undefined : "listitem"}>
      <Image
        alt={duplicate ? "" : integration.name}
        height={integration.height}
        src={integration.src}
        style={{ "--logo-width": `${integration.displayWidth}px`, height: "auto" } as CSSProperties}
        width={integration.width}
      />
      {"dbc" in integration && <span className={styles.dbc}>DBC</span>}
    </span>)}
  </div>;
}

export function PoweredBySlider({ compact = false }: { compact?: boolean }) {
  return <section aria-label="Powered by" className={`${styles.root} ${compact ? styles.compact : styles.home}`}>
    <span className={styles.label}>POWERED BY</span>
    <div className={styles.window}>
      <div className={styles.track}>
        <LogoGroup />
        <LogoGroup duplicate />
      </div>
    </div>
  </section>;
}
