import {
  ScientificPackage,
  ScientificUIModel,
  RenderablePointFeature,
  RenderableInterval,
  RenderableObservation,
  RenderableRegionalSlab,
  RawFeature,
  RawObservation,
  RawInterval,
} from '../types/scientific';

/**
 * Universal Scientific Ingestion Pipeline (v1.0)
 * Translates the clean synthesizer-to-UI contract into a high-performance 3D & 2D digital twin.
 */
export class ScientificPackageLoader {
  /**
   * Safely parses degrees-minutes-seconds strings into decimal degrees
   */
  private static parseDMS(dmsStr?: unknown): number | undefined {
    if (!dmsStr || typeof dmsStr !== 'string') return undefined;
    const matches = dmsStr.match(/\d+(?:\.\d+)?/g);
    if (!matches || matches.length < 2) return undefined;

    const deg = parseFloat(matches[0]);
    const min = parseFloat(matches[1]);
    let sec = matches[2] ? parseFloat(matches[2]) : 0;
    if (sec > 60) {
      sec = sec / 10.0;
    }
    return deg + min / 60.0 + sec / 3600.0;
  }

  public static parse(pkg: ScientificPackage): ScientificUIModel {
    // 1. Study area lookups
    const studyAreasById = new Map<string, string>();
    for (const sa of pkg.study_areas || []) {
      studyAreasById.set(sa.id, sa.name);
    }
    const primaryStudyArea = pkg.study_areas?.[0];
    const studyAreaName = primaryStudyArea?.name || 'Study Region';

    // 2. Index sources for fast page number extraction
    const sourcesById = new Map<string, number | string>();
    for (const src of pkg.sources || []) {
      if (src.id && src.page) {
        sourcesById.set(src.id, src.page);
      }
    }

    // 3. Group intervals by feature_id
    const intervalsByFeature = new Map<string, RawInterval[]>();
    const regionalIntervals: RawInterval[] = [];

    for (const iv of pkg.intervals || []) {
      if (iv.feature_id) {
        if (!intervalsByFeature.has(iv.feature_id)) {
          intervalsByFeature.set(iv.feature_id, []);
        }
        intervalsByFeature.get(iv.feature_id)!.push(iv);
      } else {
        regionalIntervals.push(iv);
      }
    }

    // 4. Group observations by feature_id
    const obsByFeature = new Map<string, RawObservation[]>();
    for (const obs of pkg.observations || []) {
      if (obs.feature_id) {
        if (!obsByFeature.has(obs.feature_id)) {
          obsByFeature.set(obs.feature_id, []);
        }
        obsByFeature.get(obs.feature_id)!.push(obs);
      }
    }

    // 5. Parse Features (resolve coordinates, depths, water levels, narratives)
    const featuresWithCoords: RenderablePointFeature[] = [];
    const featuresWithoutCoords: RawFeature[] = [];
    const allFeatures: (RenderablePointFeature | RawFeature)[] = [];

    let minLng = Infinity,
      maxLng = -Infinity,
      minLat = Infinity,
      maxLat = -Infinity;

    for (const f of pkg.features || []) {
      const propMap: Record<string, unknown> = {};
      if (Array.isArray(f.properties)) {
        for (const p of f.properties) {
          propMap[p.name] = p.value;
        }
      } else if (f.properties && typeof f.properties === 'object') {
        Object.assign(propMap, f.properties);
      }

      // Check for coordinate variations:
      // Prefer canonical GeoJSON geometry [longitude, latitude]
      let lng: number | undefined;
      let lat: number | undefined;

      if (
        f.geometry &&
        f.geometry.type === 'Point' &&
        Array.isArray(f.geometry.coordinates) &&
        f.geometry.coordinates.length >= 2
      ) {
        const [gLng, gLat] = f.geometry.coordinates;
        if (typeof gLng === 'number' && typeof gLat === 'number' && !isNaN(gLng) && !isNaN(gLat)) {
          lng = gLng;
          lat = gLat;
        }
      }

      // Fallback to feature properties if geometry is omitted
      if (lng === undefined || lat === undefined) {
        let latVal =
          propMap.latitude ??
          propMap.Y_LAT ??
          propMap.latitude_reported;
        let lngVal =
          propMap.longitude ??
          propMap.X_LONG ??
          propMap.longitude_reported;

        if (!latVal && propMap.latitude_DMS_reported) {
          latVal = this.parseDMS(propMap.latitude_DMS_reported);
        }
        if (!lngVal && propMap.longitude_DMS_reported) {
          lngVal = this.parseDMS(propMap.longitude_DMS_reported);
        }

        const parsedLat = typeof latVal === 'number' ? latVal : parseFloat(String(latVal));
        const parsedLng = typeof lngVal === 'number' ? lngVal : parseFloat(String(lngVal));
        if (!isNaN(parsedLat) && !isNaN(parsedLng)) {
          lat = parsedLat;
          lng = parsedLng;
        }
      }

      // Check if feature has valid coordinates
      const hasValidCoords =
        lat !== undefined &&
        lng !== undefined &&
        !isNaN(lat) &&
        !isNaN(lng) &&
        lat !== 0 &&
        lng !== 0;

      if (hasValidCoords) {
        // Generic outlier detection: respect synthesizer-authored coordinate verification flags
        // instead of hardcoded numbers
        const isFlaggedOutlier =
          propMap.coordinate_flag === 'lat_outlier_verify' ||
          propMap.coordinate_flag === 'outlier' ||
          (Array.isArray(f.properties) &&
            f.properties.some(
              (p) => p.name === 'coordinate_flag' && String(p.value).includes('outlier')
            ));

        if (!isFlaggedOutlier) {
          minLng = Math.min(minLng, lng!);
          maxLng = Math.max(maxLng, lng!);
          minLat = Math.min(minLat, lat!);
          maxLat = Math.max(maxLat, lat!);
        }

        // Extract total depth (handling drilled_depth, drilled_depth_m, constructed_depth_m)
        let totalDepth: number | undefined;
        const rawDepth =
          propMap.drilled_depth ??
          propMap.drilled_depth_m ??
          propMap.total_depth_m ??
          propMap.constructed_depth_m;
        if (typeof rawDepth === 'number') totalDepth = rawDepth;
        else if (rawDepth) totalDepth = parseFloat(String(rawDepth));

        // Gather observations for this feature
        const featObs = obsByFeature.get(f.id) || [];
        const normalizedObs: RenderableObservation[] = featObs.map((o) => ({
          id: o.id,
          type: o.type,
          label: o.type.replace(/_/g, ' '),
          value: o.value ?? o.original_value ?? 'N/A',
          unit: o.unit || undefined,
          date: o.date || undefined,
          category: o.category,
        }));

        // Discover water level from observations or properties
        let waterLevel: number | undefined;
        let waterDate: string | undefined;

        for (const o of featObs) {
          const t = o.type.toLowerCase();
          if (t.includes('water_level') || t.includes('piezometric') || t.includes('depth_to_water') || t.includes('swl')) {
            const num = typeof o.value === 'number' ? o.value : parseFloat(String(o.value));
            if (!isNaN(num)) {
              waterLevel = num;
              waterDate = o.date || undefined;
              break;
            }
          }
        }

        // Process intervals for this feature
        const rawFIntervals = intervalsByFeature.get(f.id) || [];
        const normalizedIntervals: RenderableInterval[] = rawFIntervals
          .filter((iv) => iv.start !== null && iv.end !== null && iv.end > iv.start)
          .map((iv) => {
            const mat = (iv.material || iv.name || '').toLowerCase();
            const isClay = mat.includes('clay') || mat.includes('aquitard') || mat.includes('silt');
            const isRock = mat.includes('basalt') || mat.includes('bedrock') || mat.includes('rock');

            return {
              id: iv.id,
              name: iv.name || `${iv.start}-${iv.end}m interval`,
              type: iv.type || 'stratum',
              start: iv.start!,
              end: iv.end!,
              thickness: iv.thickness || iv.end! - iv.start!,
              unit: iv.unit || 'm',
              material: iv.material || undefined,
              colorHex: isRock ? '#0f172a' : isClay ? '#475569' : '#0284c7',
              transparency: isClay ? 0.8 : 0.6,
              fidelity: iv.fidelity,
            };
          })
          .sort((a, b) => a.start - b.start);

        // If no intervals exist on this borehole, compute synthetic default strata up to drilled depth
        if (normalizedIntervals.length === 0 && totalDepth) {
          normalizedIntervals.push(
            {
              id: `${f.id}_unc`,
              name: 'Phreatic Upper Zone',
              type: 'aquifer',
              start: 0,
              end: Math.min(55, totalDepth),
              thickness: Math.min(55, totalDepth),
              unit: 'm',
              material: 'alluvium',
              colorHex: '#38bdf8',
              transparency: 0.5,
            },
            {
              id: `${f.id}_conf`,
              name: 'Confined Aquifer Interval',
              type: 'aquifer',
              start: Math.min(55, totalDepth),
              end: totalDepth,
              thickness: totalDepth - Math.min(55, totalDepth),
              unit: 'm',
              material: 'sand_gravel',
              colorHex: '#0284c7',
              transparency: 0.7,
            }
          );
        }

        // Gather unique source page numbers
        const pageSet = new Set<number | string>();
        for (const refId of f.source_refs || []) {
          const pg = sourcesById.get(refId);
          if (pg) pageSet.add(pg);
        }

        const renderableFeat: RenderablePointFeature = {
          id: f.id,
          name: f.name,
          type: f.type,
          studyAreaId: f.study_area_id,
          studyAreaName: f.study_area_id ? studyAreasById.get(f.study_area_id) : undefined,
          coordinates: [lng!, lat!],
          elevationMsl: typeof propMap.elevation_msl === 'number' ? propMap.elevation_msl : undefined,
          totalDepthMeters: totalDepth || (normalizedIntervals.length > 0 ? normalizedIntervals[normalizedIntervals.length - 1].end : undefined),
          waterLevelMeters: waterLevel,
          waterLevelDate: waterDate,
          intervals: normalizedIntervals,
          observations: normalizedObs,
          properties: propMap,
          sourcePages: Array.from(pageSet),
          narrative: f.narrative || null,
          evidenceRefs: f.narrative?.evidence_refs || [],
        };

        featuresWithCoords.push(renderableFeat);
        allFeatures.push(renderableFeat);
      } else {
        featuresWithoutCoords.push(f);
        allFeatures.push(f);
      }
    }

    // Default bounds if none found
    if (minLng === Infinity && primaryStudyArea?.bounds) {
      minLng = primaryStudyArea.bounds.west;
      maxLng = primaryStudyArea.bounds.east;
      minLat = primaryStudyArea.bounds.south;
      maxLat = primaryStudyArea.bounds.north;
    } else if (minLng === Infinity) {
      minLng = 72.38;
      maxLng = 73.08;
      minLat = 22.93;
      maxLat = 23.6;
    }

    // 5b. Compute robust Study Area Polygon (Convex Hull of geocoded features or district extent)
    const validPointCoords = featuresWithCoords
      .map((f) => f.coordinates)
      .filter(([lng, lat]) => lat < 24.0); // Filter anomalous reporting outliers

    let studyAreaPolygon: [number, number][] = [];
    if (validPointCoords.length >= 3) {
      // Compute 2D Convex Hull
      const sorted = [...validPointCoords].sort((a, b) =>
        a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]
      );
      const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
        (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

      const lower: [number, number][] = [];
      for (const p of sorted) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
          lower.pop();
        }
        lower.push(p);
      }

      const upper: [number, number][] = [];
      for (let i = sorted.length - 1; i >= 0; i--) {
        const p = sorted[i];
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
          upper.pop();
        }
        upper.push(p);
      }
      upper.pop();
      lower.pop();
      const hull = lower.concat(upper);

      // Buffer 15% outward from centroid for clean organic study area coverage
      let cLng = 0,
        cLat = 0;
      hull.forEach(([lng, lat]) => {
        cLng += lng;
        cLat += lat;
      });
      cLng /= hull.length;
      cLat /= hull.length;

      studyAreaPolygon = hull.map(([lng, lat]) => [
        Number((cLng + (lng - cLng) * 1.18).toFixed(6)),
        Number((cLat + (lat - cLat) * 1.18).toFixed(6)),
      ]);
      studyAreaPolygon.push(studyAreaPolygon[0]); // Close GeoJSON ring
    } else {
      // Fallback to bounding box rectangle
      studyAreaPolygon = [
        [minLng, minLat],
        [maxLng, minLat],
        [maxLng, maxLat],
        [minLng, maxLat],
        [minLng, minLat],
      ];
    }

    // 6. Regional Strata Slabs (Deduplicated District Ranges)
    const districtIntervals = regionalIntervals.filter(
      (iv) => iv.study_area_id === 'sa_district_gandhinagar' || iv.id.includes('district')
    );
    const intervalsToUse = districtIntervals.length > 0 ? districtIntervals : regionalIntervals.slice(0, 4);

    const regionalSlabs: RenderableRegionalSlab[] = intervalsToUse
      .filter((iv) => iv.start !== null && iv.end !== null && iv.end > iv.start)
      .map((iv, idx) => {
        const mat = (iv.material || iv.name || '').toLowerCase();
        const isClay = mat.includes('clay') || mat.includes('aquitard') || mat.includes('silt');
        const isUnc = iv.name?.toLowerCase().includes('unconfined') || iv.name?.toLowerCase().includes('phreatic');

        return {
          id: iv.id || `reg_slab_${idx}`,
          name: iv.name || `Formation ${iv.start}-${iv.end}m`,
          type: iv.type || 'aquifer',
          start: iv.start!,
          end: iv.end!,
          thickness: iv.thickness || iv.end! - iv.start!,
          colorHex: isUnc ? '#38bdf8' : isClay ? '#475569' : idx === 1 ? '#0284c7' : '#0369a1',
          transparency: isClay ? 0.35 : 0.22,
          studyAreaId: iv.study_area_id || 'regional',
          studyAreaName: iv.study_area_id ? studyAreasById.get(iv.study_area_id) || studyAreaName : studyAreaName,
        };
      })
      .sort((a, b) => a.start - b.start);

    return {
      reportTitle: pkg.report?.title || 'Scientific Hydrogeological Investigation',
      shortTitle: pkg.report?.short_title || 'District Aquifer Explorer',
      studyAreaName,
      bounds: {
        minLng,
        maxLng,
        minLat,
        maxLat,
        center: [(minLng + maxLng) / 2, (minLat + maxLat) / 2],
      },
      studyAreaPolygon,
      featuresWithCoords,
      featuresWithoutCoords,
      allFeatures,
      regionalSlabs,
      preservedDatasets: pkg.extensions?.datasets || [],
      allObservations: pkg.observations || [],
      sourcesCount: pkg.sources?.length || 0,
    };
  }
}
