import { QuantitativeSeries } from '../types/scientific';

/**
 * Supported chart and statistical visualization primitives for quantitative series.
 */
export type QuantitativeRendererKind =
  | 'line' | 'range' | 'bar' | 'stacked-bar' | 'share'
  | 'histogram' | 'scatter' | 'threshold' | 'waterfall' | 'kpi';

/**
 * Registration metadata defining how a visual chart renderer matches
 * incoming scientific dataset properties and falls back when data is sparse.
 */
export interface RendererRegistration {
  id: string;
  title: string;
  aliases: RegExp[];
  requirements: string[];
  fallback: QuantitativeRendererKind;
}

/**
 * Registry of quantitative renderers mapping statistical semantics
 * to interactive charting components.
 */
export const quantitativeRenderers: RendererRegistration[] = [
  { id: 'line', title: 'Line / time series', aliases: [/line|time|trend|series/i], requirements: ['x', 'y'], fallback: 'line' },
  { id: 'range', title: 'Range / uncertainty band', aliases: [/range|band|interval|uncertainty/i], requirements: ['x', 'yLow', 'yHigh'], fallback: 'line' },
  { id: 'share', title: 'Category share', aliases: [/share|pie|donut|composition/i], requirements: ['category', 'y'], fallback: 'bar' },
  { id: 'stacked-bar', title: 'Grouped / stacked bars', aliases: [/stack|group/i], requirements: ['category', 'group', 'y'], fallback: 'bar' },
  { id: 'bar', title: 'Bar comparison', aliases: [/bar|categor|comparison|scenario|before|after/i], requirements: ['x', 'y'], fallback: 'bar' },
  { id: 'histogram', title: 'Histogram / distribution', aliases: [/histogram|distribution|frequency/i], requirements: ['y'], fallback: 'bar' },
  { id: 'scatter', title: 'Scatter relationship', aliases: [/scatter|relationship|correlation/i], requirements: ['x:number', 'y'], fallback: 'line' },
  { id: 'threshold', title: 'Threshold / exceedance', aliases: [/threshold|exceed|limit|compliance/i], requirements: ['y', 'threshold'], fallback: 'bar' },
  { id: 'waterfall', title: 'Waterfall / component budget', aliases: [/waterfall|budget|balance|component/i], requirements: ['x', 'y'], fallback: 'bar' },
  { id: 'kpi', title: 'KPI / statistical callout', aliases: [/kpi|stat|callout|scalar/i], requirements: ['y'], fallback: 'bar' },
];

/**
 * Inspects a series descriptor and data points to select the most appropriate
 * visualization renderer, with graceful degradation if required dimensions are missing.
 *
 * @param series - The quantitative series extracted from the study package.
 * @returns The selected renderer kind.
 */
export function chooseQuantitativeRenderer(series: QuantitativeSeries): QuantitativeRendererKind {
  const descriptor = `${series.kind} ${series.title}`;
  if (series.stackMode === 'grouped' || /\bgrouped\b/i.test(series.kind)) return 'bar';
  if (series.stackMode === 'stacked' || series.stackMode === 'normalized' || /\bstacked\b/i.test(series.kind)) return 'stacked-bar';
  const registration = quantitativeRenderers.find((candidate) => candidate.aliases.some((alias) => alias.test(descriptor)));
  if (!registration) return 'line';
  if (registration.id === 'range' && !series.points.some((point) => point.yLow != null && point.yHigh != null)) return registration.fallback;
  if (registration.id === 'threshold' && series.threshold == null && !series.points.some((point) => point.threshold != null)) return registration.fallback;
  if (registration.id === 'scatter' && !series.points.every((point) => Number.isFinite(Number(point.x)))) return registration.fallback;
  return registration.id as QuantitativeRendererKind;
}

export const extensionFallbackPolicy = {
  safePrimitiveTypes: ['string', 'number', 'boolean'],
  maxPreviewDepth: 4,
  maxPreviewItems: 100,
  note: 'Unknown extensions remain inspectable as sanitized structured evidence and never execute package-provided code.',
} as const;
