import React, { useState, useEffect, useMemo } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  CartesianGrid
} from "recharts";
import {
  TrendingUp,
  TrendingDown,
  Sparkles,
  Radio,
  Play,
  Pause,
  Clock,
  ShieldCheck,
  DollarSign,
  Maximize2,
  RefreshCw,
  Info
} from "lucide-react";

interface FloorPricePoint {
  time: string;
  hour: number;
  floor: number;
  ceiling: number;
  savings: number;
  volume: number;
  isNow?: boolean;
}

interface FloorPriceTrendChartProps {
  currentFloorEth: number;
  onFloorChange?: (newFloor: number) => void;
  beginnerMode: boolean;
}

export const FloorPriceTrendChart: React.FC<FloorPriceTrendChartProps> = ({
  currentFloorEth,
  onFloorChange,
  beginnerMode,
}) => {
  const [isLiveStreaming, setIsLiveStreaming] = useState<boolean>(true);
  const [lastSyncTime, setLastSyncTime] = useState<string>("Just now");
  const [liveJitter, setLiveJitter] = useState<number>(0);
  const [ticksCount, setTicksCount] = useState<number>(0);

  // Generate 24-hour historical baseline curve for Ry Hawthorne #4041
  // Historical pattern: minor dip 14h ago to ~3.15 ETH, steady recovery to ~3.40 ETH spot
  const historicalBase = useMemo<Array<{ hour: number; time: string; offset: number; volume: number }>>(() => {
    return [
      { hour: -24, time: "-24h", offset: -0.15, volume: 4.2 },
      { hour: -22, time: "-22h", offset: -0.12, volume: 3.8 },
      { hour: -20, time: "-20h", offset: -0.08, volume: 5.1 },
      { hour: -18, time: "-18h", offset: -0.05, volume: 4.6 },
      { hour: -16, time: "-16h", offset: -0.18, volume: 8.4 },
      { hour: -14, time: "-14h", offset: -0.25, volume: 11.2 }, // Local 24h dip
      { hour: -12, time: "-12h", offset: -0.20, volume: 7.9 },
      { hour: -10, time: "-10h", offset: -0.14, volume: 6.3 },
      { hour: -8,  time: "-8h",  offset: -0.08, volume: 5.5 },
      { hour: -6,  time: "-6h",  offset: -0.02, volume: 6.8 },
      { hour: -4,  time: "-4h",  offset: +0.06, volume: 7.4 },
      { hour: -2,  time: "-2h",  offset: +0.03, volume: 5.9 },
      { hour: -1,  time: "-1h",  offset: -0.01, volume: 4.8 },
      { hour: 0,   time: "Now",  offset: 0.00,  volume: 3.2 },
    ];
  }, []);

  // Periodic micro-fluctuation simulation (useEffect hook)
  useEffect(() => {
    if (!isLiveStreaming) return;

    const interval = setInterval(() => {
      // Micro-oscillation: random fluctuation between -0.02 and +0.02 ETH
      const delta = (Math.random() - 0.5) * 0.03;
      setLiveJitter((prev) => {
        const next = Math.max(-0.08, Math.min(0.08, prev + delta));
        return parseFloat(next.toFixed(4));
      });
      setLastSyncTime(new Date().toLocaleTimeString());
      setTicksCount((c) => c + 1);
    }, 4000);

    return () => clearInterval(interval);
  }, [isLiveStreaming]);

  // Combined dataset incorporating user slider input and live micro-jitter
  const chartData = useMemo<FloorPricePoint[]>(() => {
    const effectiveSpot = currentFloorEth + liveJitter;

    return historicalBase.map((point) => {
      let floorVal: number;
      let isNow = false;

      if (point.hour === 0) {
        floorVal = parseFloat(effectiveSpot.toFixed(4));
        isNow = true;
      } else {
        // Scale historical points relative to current floor
        const calculated = currentFloorEth + point.offset;
        floorVal = parseFloat(Math.max(1.0, calculated).toFixed(4));
      }

      const ceilingVal = parseFloat((floorVal * 0.8).toFixed(4));
      const savingsVal = parseFloat((floorVal * 0.2).toFixed(4));

      return {
        time: point.time,
        hour: point.hour,
        floor: floorVal,
        ceiling: ceilingVal,
        savings: savingsVal,
        volume: point.volume,
        isNow,
      };
    });
  }, [historicalBase, currentFloorEth, liveJitter]);

  const activeSpot = chartData[chartData.length - 1].floor;
  const activeCeiling = chartData[chartData.length - 1].ceiling;
  const activeSavings = chartData[chartData.length - 1].savings;

  // 24h High, Low, and % Change calculation
  const floorValues = chartData.map((d) => d.floor);
  const high24h = Math.max(...floorValues);
  const low24h = Math.min(...floorValues);
  const open24h = chartData[0].floor;
  const change24hEth = activeSpot - open24h;
  const change24hPercent = ((change24hEth / open24h) * 100).toFixed(2);
  const isPositive = change24hEth >= 0;

  // Custom Recharts Tooltip
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload as FloorPricePoint;
      const ethPriceUSD = 3400; // Reference valuation rate
      const floorUSD = Math.round(data.floor * ethPriceUSD);
      const ceilingUSD = Math.round(data.ceiling * ethPriceUSD);
      const savingsUSD = Math.round(data.savings * ethPriceUSD);

      return (
        <div className="bg-slate-950/95 border border-slate-800 p-3 rounded-xl shadow-2xl backdrop-blur-md text-xs font-mono space-y-2 min-w-[210px]">
          <div className="flex items-center justify-between pb-1.5 border-b border-slate-800">
            <span className="text-slate-400 font-semibold flex items-center space-x-1.5">
              <Clock className="w-3.5 h-3.5 text-indigo-400" />
              <span>{data.isNow ? "Live Spot (Now)" : `${data.time} Timeline`}</span>
            </span>
            <span className="text-[10px] text-slate-500">Vol: {data.volume} ETH</span>
          </div>

          <div className="space-y-1">
            <div className="flex justify-between items-center">
              <span className="text-indigo-300 flex items-center space-x-1">
                <span className="w-2 h-2 rounded-full bg-indigo-400 inline-block" />
                <span>Spot Floor:</span>
              </span>
              <span className="text-white font-bold">{data.floor.toFixed(4)} ETH</span>
            </div>
            <div className="text-[10px] text-slate-500 text-right">
              ≈ ${floorUSD.toLocaleString()} USD
            </div>

            <div className="flex justify-between items-center pt-1 border-t border-slate-900">
              <span className="text-emerald-400 flex items-center space-x-1">
                <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
                <span>80% Bid Ceiling:</span>
              </span>
              <span className="text-emerald-300 font-bold">{data.ceiling.toFixed(4)} ETH</span>
            </div>
            <div className="text-[10px] text-slate-500 text-right">
              ≈ ${ceilingUSD.toLocaleString()} USD
            </div>

            <div className="flex justify-between items-center pt-1 border-t border-slate-900 text-amber-300 font-semibold text-[11px]">
              <span>EdgeScout 20% Spread:</span>
              <span>+{data.savings.toFixed(4)} ETH (${savingsUSD})</span>
            </div>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
      {/* Header and Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h3 className="text-white font-bold text-sm tracking-tight">
                #4041 Floor Price Trend & 80% Valuation Corridor
              </h3>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-indigo-300 border border-indigo-500/30">
                Ry Hawthorne '_404/LostLayer'
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Real-time 24-hour spot tracking vs. mandatory 8000 BPS smart contract ceiling
            </p>
          </div>
        </div>

        {/* Live Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Live Periodic Ticking Badge */}
          <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-[11px] font-mono">
            <span
              className={`w-2 h-2 rounded-full ${
                isLiveStreaming ? "bg-emerald-400 animate-ping" : "bg-slate-600"
              }`}
            />
            <span className={isLiveStreaming ? "text-emerald-400 font-semibold" : "text-slate-400"}>
              {isLiveStreaming ? "STREAMING (4s)" : "PAUSED"}
            </span>
            <button
              type="button"
              onClick={() => setIsLiveStreaming(!isLiveStreaming)}
              className="ml-1 text-slate-400 hover:text-white p-0.5 rounded transition-colors"
              title={isLiveStreaming ? "Pause Live Price Updates" : "Resume Live Price Updates"}
            >
              {isLiveStreaming ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3 text-emerald-400" />}
            </button>
          </div>

          {/* 24h Trend Badge */}
          <div
            className={`px-2.5 py-1 rounded-lg border text-[11px] font-mono font-semibold flex items-center space-x-1 ${
              isPositive
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                : "bg-rose-500/10 text-rose-400 border-rose-500/30"
            }`}
          >
            {isPositive ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
            <span>{isPositive ? `+${change24hPercent}%` : `${change24hPercent}%`} (24h)</span>
          </div>
        </div>
      </div>

      {/* Beginner Explanation */}
      {beginnerMode && (
        <div className="bg-slate-800/80 p-3 rounded-lg border border-slate-700/70 text-xs text-slate-300 leading-relaxed flex items-start space-x-2.5">
          <Info className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold text-indigo-300 block mb-0.5">
              💡 Understanding the Valuation Corridor:
            </span>
            <span>
              The <strong>purple line</strong> is the market floor price for Ry Hawthorne token #4041 over the last 24 hours. The <strong>green line</strong> is the maximum price EdgeScout is legally permitted to bid (exactly 80% of the floor). The shaded gap between the lines represents the <strong>guaranteed 20% discount</strong> you lock in on acquisition.
            </span>
          </div>
        </div>
      )}

      {/* 4 Metric Badges */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {/* Metric 1: Live Spot Floor */}
        <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
          <span className="text-[11px] text-slate-400 block">Live Spot Floor (Now)</span>
          <div className="text-lg font-bold font-mono text-white flex items-center space-x-1">
            <span>{activeSpot.toFixed(4)} ETH</span>
          </div>
          <span className="text-[10px] text-slate-500 block font-mono">
            Sync: {lastSyncTime}
          </span>
        </div>

        {/* Metric 2: 80% Max Target Ceiling */}
        <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
          <span className="text-[11px] text-slate-400 block">Contract Ceiling (80%)</span>
          <div className="text-lg font-bold font-mono text-emerald-400">
            {activeCeiling.toFixed(4)} ETH
          </div>
          <span className="text-[10px] text-emerald-500/80 block font-mono">
            8000 BPS Strictly Enforced
          </span>
        </div>

        {/* Metric 3: Guaranteed 20% Spread */}
        <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
          <span className="text-[11px] text-slate-400 block">Enforced Discount</span>
          <div className="text-lg font-bold font-mono text-indigo-400">
            20.00% (-{activeSavings.toFixed(4)} ETH)
          </div>
          <span className="text-[10px] text-slate-500 block">
            Guaranteed Margin Cushion
          </span>
        </div>

        {/* Metric 4: 24h High / Low Range */}
        <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
          <span className="text-[11px] text-slate-400 block">24h Price Range</span>
          <div className="text-sm font-bold font-mono text-slate-200">
            {low24h.toFixed(2)} - {high24h.toFixed(2)} ETH
          </div>
          <span className="text-[10px] text-slate-500 block font-mono">
            Low: {low24h.toFixed(2)} | High: {high24h.toFixed(2)}
          </span>
        </div>
      </div>

      {/* Main Recharts Area */}
      <div className="w-full bg-slate-950/60 border border-slate-800/80 rounded-xl p-3 space-y-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between text-[11px] text-slate-400 font-mono px-1">
          <span className="text-slate-300 font-medium">24-Hour Price Action vs. 80% Bid Ceiling</span>
          <div className="flex items-center space-x-3 pt-1 sm:pt-0">
            <span className="flex items-center space-x-1.5 text-indigo-400">
              <span className="w-2.5 h-1 bg-indigo-500 rounded-sm inline-block" />
              <span>Spot Floor (ETH)</span>
            </span>
            <span className="flex items-center space-x-1.5 text-emerald-400">
              <span className="w-2.5 h-0.5 border-b-2 border-emerald-400 inline-block" />
              <span>80% Max Bid Ceiling</span>
            </span>
          </div>
        </div>

        <div className="w-full h-52 pt-2">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="floorAreaGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0.0} />
                </linearGradient>
                <linearGradient id="ceilingAreaGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis
                dataKey="time"
                stroke="#64748b"
                fontSize={10}
                tickLine={false}
              />
              <YAxis
                stroke="#64748b"
                fontSize={10}
                tickLine={false}
                domain={[(dataMin: number) => Math.max(0, parseFloat((dataMin - 0.2).toFixed(2))), (dataMax: number) => parseFloat((dataMax + 0.2).toFixed(2))]}
                tickFormatter={(val) => `${val.toFixed(2)} Ξ`}
              />
              <Tooltip content={<CustomTooltip />} />
              
              {/* Active Spot Reference Line */}
              <ReferenceLine
                y={activeSpot}
                stroke="#6366f1"
                strokeDasharray="2 2"
                strokeOpacity={0.6}
                label={{
                  value: `Spot ${activeSpot.toFixed(2)}Ξ`,
                  fill: "#818cf8",
                  fontSize: 9,
                  position: "insideTopLeft"
                }}
              />

              {/* Active 80% Ceiling Reference Line */}
              <ReferenceLine
                y={activeCeiling}
                stroke="#10b981"
                strokeDasharray="3 3"
                strokeOpacity={0.8}
                label={{
                  value: `Ceiling ${activeCeiling.toFixed(2)}Ξ`,
                  fill: "#34d399",
                  fontSize: 9,
                  position: "insideBottomRight"
                }}
              />

              {/* Shaded Area for Floor */}
              <Area
                type="monotone"
                dataKey="floor"
                fill="url(#floorAreaGradient)"
                stroke="none"
              />

              {/* Shaded Area for Ceiling */}
              <Area
                type="monotone"
                dataKey="ceiling"
                fill="url(#ceilingAreaGradient)"
                stroke="none"
              />

              {/* Floor Price Line */}
              <Line
                type="monotone"
                dataKey="floor"
                name="Spot Floor"
                stroke="#818cf8"
                strokeWidth={2.5}
                dot={{ r: 2, fill: "#818cf8" }}
                activeDot={{ r: 5, stroke: "#6366f1", strokeWidth: 2 }}
              />

              {/* Ceiling Price Line */}
              <Line
                type="monotone"
                dataKey="ceiling"
                name="80% Ceiling"
                stroke="#10b981"
                strokeWidth={2}
                strokeDasharray="4 2"
                dot={{ r: 2, fill: "#10b981" }}
                activeDot={{ r: 4, stroke: "#059669", strokeWidth: 2 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Scenario Presets Bar */}
      {onFloorChange && (
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 text-xs">
          <span className="text-slate-400 text-[11px] font-medium">
            Simulate #4041 Floor Shifts:
          </span>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => onFloorChange(3.10)}
              className="py-1 px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-indigo-300 border border-slate-700 text-[11px] transition-colors"
            >
              📉 Dip to 3.10 ETH
            </button>
            <button
              type="button"
              onClick={() => onFloorChange(3.40)}
              className="py-1 px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-indigo-300 border border-slate-700 text-[11px] transition-colors"
            >
              ⚖️ Baseline 3.40 ETH
            </button>
            <button
              type="button"
              onClick={() => onFloorChange(3.85)}
              className="py-1 px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-indigo-300 border border-slate-700 text-[11px] transition-colors"
            >
              📈 Rally to 3.85 ETH
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
