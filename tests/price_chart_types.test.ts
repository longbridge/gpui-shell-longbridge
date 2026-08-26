/// <reference path="../app/types.d.ts" />

declare const prepared: PriceChartSeries;
declare const geometry: PriceChartGeometry;

prepared.points[0].timestamp;
prepared.points[0].date;

// Prepared data has not been placed in the plot yet.
// @ts-expect-error x exists only after layoutPriceSeries.
prepared.points[0].x;
// @ts-expect-error y exists only after layoutPriceSeries.
prepared.points[0].y;

geometry.points[0].x;
geometry.points[0].y;
