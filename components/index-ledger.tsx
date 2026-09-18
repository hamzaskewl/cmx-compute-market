"use client";

import Image, { type StaticImageData } from "next/image";
import { useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import a100Plate from "@/assets/plates/gpu-a100.png";
import b200Plate from "@/assets/plates/gpu-b200.png";
import rtx5090Plate from "@/assets/plates/gpu-5090.png";
import h100Plate from "@/assets/plates/gpu-h100.png";
import h200Plate from "@/assets/plates/gpu-h200.png";
import type { OrnnHistoryPoint, OrnnIndex } from "@/lib/ornn";
import styles from "@/app/page.module.css";

type CatalogItem = {
  label: string;
  architecture: string;
  memory: string;
  plate: StaticImageData;
};

const catalog: Record<OrnnIndex["symbol"], CatalogItem> = {
  H100: { label: "NVIDIA H100", architecture: "Hopper", memory: "80 GB HBM3", plate: h100Plate },
  H200: { label: "NVIDIA H200", architecture: "Hopper", memory: "141 GB HBM3e", plate: h200Plate },
  B200: { label: "NVIDIA B200", architecture: "Blackwell", memory: "180 GB HBM3e", plate: b200Plate },
  A100: { label: "NVIDIA A100", architecture: "Ampere", memory: "80 GB HBM2e", plate: a100Plate },
  "5090": { label: "NVIDIA RTX 5090", architecture: "Blackwell", memory: "32 GB GDDR7", plate: rtx5090Plate },
};

function Arrow() {
  return (
    <svg aria-hidden="true" className={styles.arrow} viewBox="0 0 24 24">
      <path d="M5 12h13M13 7l5 5-5 5" fill="none" stroke="currentColor" strokeLinecap="square" strokeWidth="1.6" />
    </svg>
  );
}

type HistoryMap = Partial<Record<OrnnIndex["symbol"], OrnnHistoryPoint[]>>;

function ChartTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ value?: number }>;
  label?: string;
}) {
  if (!active || !payload?.[0]?.value || !label) return null;
  return (
    <div className={styles.chartTooltip}>
      <span>{new Date(label).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
      <strong>${payload[0].value.toFixed(4)}</strong>
    </div>
  );
}

export function IndexLedger({ indices, histories }: { indices: OrnnIndex[]; histories: HistoryMap }) {
  const [selected, setSelected] = useState<OrnnIndex["symbol"]>(indices[0]?.symbol ?? "B200");
  const [range, setRange] = useState<30 | 90>(90);
  const selectedIndex = indices.find((index) => index.symbol === selected) ?? indices[0];
  const history = (histories[selected] ?? []).slice(-range);
  const firstPrice = history[0]?.price;
  const lastPrice = history.at(-1)?.price ?? selectedIndex?.price;
  const change = firstPrice && lastPrice ? ((lastPrice - firstPrice) / firstPrice) * 100 : null;

  return (
    <div className={styles.indexRows}>
      {indices.map((index) => {
        const item = catalog[index.symbol];
        const isSelected = selected === index.symbol;
        const isLive = index.symbol === "B200";
        return (
          <div className={`${styles.indexRow} ${isSelected ? styles.selected : ""} ${!isLive ? styles.comingSoonRow : ""}`} key={index.symbol}>
            <button
              aria-label={`Select ${item.label} index`}
              aria-pressed={isSelected}
              className={styles.rowSelect}
              onClick={() => setSelected(index.symbol)}
              type="button"
            />
            <span className={styles.gpuIdentity}>
              <span className={styles.gpuPlate}>
                <Image alt="" aria-hidden="true" fill sizes="92px" src={item.plate} />
              </span>
              <span className={styles.gpuName}>
                <strong>{item.label} <em className={isLive ? styles.liveBadge : styles.soonBadge}>{isLive ? "Available" : "Coming soon"}</em></strong>
                <small className={styles.specLine}>{item.architecture}</small>
                <small className={styles.specLine}>{item.memory}</small>
              </span>
            </span>
            <span className={styles.price}>${index.price.toFixed(4)}</span>
            <a
              aria-label={`Read pricing methodology for ${item.label}`}
              className={styles.source}
              href="/docs#reference"
            >
              Composite<Arrow />
            </a>
          </div>
        );
      })}
      {selectedIndex && (
        <section aria-label={`${catalog[selectedIndex.symbol].label} historical price chart`} className={styles.chartPanel}>
          <div className={styles.chartHeader}>
            <div>
              <span>Ornn historical reference</span>
              <strong>{catalog[selectedIndex.symbol].label}</strong>
            </div>
            <div className={styles.chartStats}>
              <span className={change !== null && change < 0 ? styles.negative : styles.positive}>
                {change === null ? "—" : `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`}
              </span>
              <div className={styles.rangeSwitch} aria-label="Chart range">
                <button aria-pressed={range === 30} onClick={() => setRange(30)} type="button">1M</button>
                <button aria-pressed={range === 90} onClick={() => setRange(90)} type="button">3M</button>
              </div>
            </div>
          </div>
          {history.length > 1 ? (
            <div className={styles.chartCanvas}>
              <ResponsiveContainer height="100%" width="100%">
                <LineChart data={history} margin={{ top: 12, right: 10, bottom: 2, left: 0 }}>
                  <CartesianGrid stroke="#38474e" strokeDasharray="2 6" vertical={false} />
                  <XAxis axisLine={false} dataKey="timestamp" minTickGap={42} tick={{ fill: "#9fa9bc", fontSize: 10 }} tickFormatter={(value) => new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" })} tickLine={false} />
                  <YAxis axisLine={false} domain={["dataMin - 0.15", "dataMax + 0.15"]} tick={{ fill: "#9fa9bc", fontSize: 10 }} tickFormatter={(value) => `$${Number(value).toFixed(2)}`} tickLine={false} width={54} />
                  <Tooltip content={<ChartTooltip />} cursor={{ stroke: "#727b84", strokeWidth: 1 }} />
                  <Line dataKey="price" dot={false} isAnimationActive={false} stroke="#959cf7" strokeWidth={2} type="monotone" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className={styles.chartUnavailable}>Historical pricing is temporarily unavailable.</p>
          )}
        </section>
      )}
    </div>
  );
}
