import React, { useMemo } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart,
  Line, Pie, PieChart, ReferenceLine, ResponsiveContainer, Scatter,
  ScatterChart, Tooltip, XAxis, YAxis,
} from 'recharts';
import { QuantitativeSeries } from '../../types/scientific';
import { chooseQuantitativeRenderer } from '../../core/RendererRegistry';

const palette = ['#35C4B5', '#C2A15C', '#4CC38A', '#E3B34E', '#E06C5F'];
const grid = '#1C262C';
const axis = '#7E8F89';
const tooltip = { background: '#0C1114', border: '1px solid #1C262C', borderRadius: 8 };

export function GenericChart({ series, onSelectFeature }: { series: QuantitativeSeries; onSelectFeature?: (id: string) => void }) {
  const kind = chooseQuantitativeRenderer(series);
  const groups = useMemo(() => Array.from(new Set(series.points.map((point) => point.group).filter(Boolean))) as string[], [series.points]);
  const grouped = useMemo(() => {
    if (!groups.length) return series.points;
    const byX = new Map<string | number, Record<string, unknown>>();
    series.points.forEach((point) => {
      const row = byX.get(point.x) || { x: point.x };
      row[point.group || 'value'] = point.y;
      byX.set(point.x, row);
    });
    return Array.from(byX.values());
  }, [groups, series.points]);
  const select = (payload: any) => {
    const point = payload?.payload || payload;
    if (point?.featureId && onSelectFeature) onSelectFeature(point.featureId);
  };
  const common = <><CartesianGrid stroke={grid} strokeDasharray="3 3"/><XAxis dataKey="x" stroke={axis} fontSize={10}/><YAxis stroke={axis} fontSize={10}/><Tooltip contentStyle={tooltip}/></>;

  if (kind === 'kpi') {
    const point = series.points[0];
    return <div className="h-64 grid place-items-center"><div className="text-center"><div className="text-5xl font-semibold text-accent tabular-nums">{point?.y ?? '—'}</div><div className="mt-2 text-xs uppercase tracking-widest text-muted">{series.unit || series.yLabel || 'reported value'}</div></div></div>;
  }
  if (kind === 'share') return <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={series.points} dataKey="y" nameKey="x" innerRadius="45%" outerRadius="78%" onClick={select}>{series.points.map((point, index) => <Cell key={`${point.x}:${index}`} fill={palette[index % palette.length]}/>)}</Pie><Tooltip contentStyle={tooltip}/></PieChart></ResponsiveContainer>;
  if (kind === 'scatter') {
    const points = series.points
      .map((point) => ({ ...point, x: Number(point.x), y: Number(point.y) }))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    return <ResponsiveContainer width="100%" height="100%"><ScatterChart margin={{ top: 12, right: 16, bottom: 8, left: 0 }}><CartesianGrid stroke={grid} strokeDasharray="3 3"/><XAxis type="number" dataKey="x" name={series.xLabel || 'X'} unit={series.xUnit ? ` ${series.xUnit}` : undefined} domain={['auto', 'auto']} stroke={axis} fontSize={10}/><YAxis type="number" dataKey="y" name={series.yLabel || 'Value'} unit={series.unit ? ` ${series.unit}` : undefined} domain={['auto', 'auto']} stroke={axis} fontSize={10}/><Tooltip cursor={{ stroke: '#7E8F89', strokeDasharray: '3 3' }} contentStyle={tooltip}/><Scatter data={points} fill={palette[0]} onClick={select}/></ScatterChart></ResponsiveContainer>;
  }
  if (kind === 'range') return <ResponsiveContainer width="100%" height="100%"><AreaChart data={series.points}>{common}<Area dataKey="yHigh" stroke="none" fill="#35C4B5" fillOpacity={0.12}/><Area dataKey="yLow" stroke="none" fill="#0C1114" fillOpacity={1}/><Line dataKey="y" stroke={palette[0]} strokeWidth={2} dot={{ r: 2 }} onClick={select}/></AreaChart></ResponsiveContainer>;
  if (kind === 'bar' || kind === 'stacked-bar' || kind === 'histogram' || kind === 'waterfall' || kind === 'threshold') {
    return <ResponsiveContainer width="100%" height="100%"><BarChart data={groups.length ? grouped : series.points}>{common}{groups.length ? groups.map((group, index) => <Bar key={group} dataKey={group} stackId={kind === 'stacked-bar' ? 'stack' : undefined} fill={palette[index % palette.length]}/>) : <Bar dataKey="y" fill={palette[0]} onClick={select}>{series.points.map((point, index) => <Cell key={`${point.x}:${index}`} fill={kind === 'threshold' && point.y > (point.threshold ?? series.threshold ?? Infinity) ? '#E06C5F' : palette[index % palette.length]}/>)}</Bar>}{kind === 'threshold' && series.threshold != null && <ReferenceLine y={series.threshold} stroke="#E3B34E" strokeDasharray="6 4" label={{ value: series.thresholdLabel || 'threshold', fill: '#E3B34E', fontSize: 10 }}/>}</BarChart></ResponsiveContainer>;
  }
  return <ResponsiveContainer width="100%" height="100%"><ComposedChart data={series.points}>{common}<Line type="monotone" dataKey="y" stroke={palette[0]} strokeWidth={2} dot={{ r: 3 }} onClick={select}/>{series.threshold != null && <ReferenceLine y={series.threshold} stroke="#E3B34E" strokeDasharray="6 4"/>}</ComposedChart></ResponsiveContainer>;
}
