"use client";

import { useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { OrnnHistoryPoint } from "@/lib/ornn";
import styles from "@/app/page.module.css";

const ranges = [7, 30, 90] as const;

export function B200Chart({ history, price }: { history: OrnnHistoryPoint[]; price: number | null }) {
  const [range, setRange] = useState<(typeof ranges)[number]>(30);
  const points = history.slice(-range);
  const first = points[0]?.price;
  const last = points.at(-1)?.price ?? price;
  const change = first && last ? ((last - first) / first) * 100 : null;
  return <section className={styles.chartShell} aria-label="B200 GPU hour price chart">
    <div className={styles.chartTop}>
      <div>
        <div className={styles.instrument}><span className={styles.pulse} /> B200 / USD <span>GPU HOUR</span></div>
        <div className={styles.chartPrice}>{last === null || last === undefined ? "—" : `$${last.toFixed(4)}`}<small>per GPU-hour</small></div>
      </div>
      <div className={styles.chartControls}>
        {change !== null && <span className={change < 0 ? styles.down : styles.up}>{change >= 0 ? "+" : ""}{change.toFixed(2)}%</span>}
        <div className={styles.ranges} aria-label="Chart timeframe">
          {ranges.map((item) => <button aria-pressed={range === item} key={item} onClick={() => setRange(item)} type="button">{item === 7 ? "7D" : item === 30 ? "30D" : "90D"}</button>)}
        </div>
      </div>
    </div>
    <div className={styles.chartArea}>
      {points.length > 1 ? <ResponsiveContainer height="100%" width="100%">
        <AreaChart data={points} margin={{ top: 14, right: 7, left: 0, bottom: 2 }}>
          <defs><linearGradient id="b200Glow" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#dbdbdb" stopOpacity=".32"/><stop offset="95%" stopColor="#dbdbdb" stopOpacity="0"/></linearGradient></defs>
          <CartesianGrid stroke="#303030" strokeDasharray="2 5" vertical={false} />
          <XAxis axisLine={false} dataKey="timestamp" minTickGap={32} tick={{ fill: "#8c8c8c", fontSize: 10 }} tickFormatter={(value: string) => new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" })} tickLine={false} />
          <YAxis axisLine={false} domain={["dataMin - 0.15", "dataMax + 0.15"]} orientation="right" tick={{ fill: "#8c8c8c", fontSize: 10 }} tickFormatter={(value: number) => `$${value.toFixed(2)}`} tickLine={false} width={54} />
          <Tooltip content={({ active, payload, label }) => active && payload?.[0]?.value ? <div className={styles.tooltip}><span>{new Date(String(label)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span><strong>${Number(payload[0].value).toFixed(4)}</strong></div> : null} cursor={{ stroke: "#c5c5c5" }} />
          <Area dataKey="price" dot={false} fill="url(#b200Glow)" isAnimationActive={false} stroke="#f2f2f2" strokeWidth={2.5} type="monotone" />
        </AreaChart>
      </ResponsiveContainer> : <p className={styles.chartMissing}>Price history is temporarily unavailable.</p>}
    </div>
    <div className={styles.chartFoot}><span>GPU-hour reference price</span><span>Source: Ornn · updated every 5 min</span></div>
  </section>;
}
