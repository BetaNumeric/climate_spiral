export function calendarYear(decimalYear) {
  return Math.floor(decimalYear + 1e-7);
}

export function isConnectedDataSegment(a, b, splitYears = false) {
  return !a.missing && !b.missing && b.decimalYear - a.decimalYear <= 1 / 12 + 1e-6
    && (!splitYears || a.stripYear === b.stripYear);
}

export function layoutEase(progress) {
  const t = Math.max(0, Math.min(1, progress));
  return t * t * t * (10 + t * (-15 + 6 * t));
}

export function monthLabelOpacity(clearance) {
  return layoutEase((clearance - 0.12) / 0.88);
}

export function graphYearLabelOffset(azimuth, layout) {
  const halfDepth = (layout.maxRadius - layout.minRadius) / 2;
  return Math.abs(Math.cos(azimuth)) * layout.width / 2
    + Math.abs(Math.sin(azimuth)) * halfDepth + 3.4;
}

export function verticalGuidePosition(radius, side, azimuth, progress, layout, target = {}) {
  const x = side * radius * Math.cos(azimuth);
  const z = -side * radius * Math.sin(azimuth);
  // Change edges only around the front/back, where the value guides fade out.
  const farSide = 2 * layoutEase((Math.sin(azimuth) / 0.2 + 1) / 2) - 1;
  target.x = x + (-farSide * layout.width / 2 - x) * progress;
  target.z = z + (layout.center - radius - z) * progress;
  return target;
}

export function monthlyGraphSamples(dates, samplesPerMonth) {
  const strips = yearlySegments(dates).map(({ start, end }) => {
    const year = calendarYear(dates[start]);
    const closesYear = end + 1 < dates.length && Math.abs(dates[end + 1] - year - 1) < 1e-7
      && dates[end + 1] - dates[end] <= 1 / 12 + 1e-6;
    return { start, lastOwned: end, end: end + Number(closesYear), year };
  });
  const samples = [], observationIndices = [];
  let stripIndex = 0;
  for (let index = 0; index <= (dates.length - 1) * samplesPerMonth; index++) {
    const sample = index / samplesPerMonth;
    const a = Math.floor(sample), b = Math.min(a + 1, dates.length - 1);
    while (stripIndex < strips.length - 1 && a > strips[stripIndex].lastOwned) stripIndex++;
    const strip = strips[stripIndex];
    const previous = strips[stripIndex - 1];
    // The same observed January closes one strip and starts the next. No month is discarded or predicted.
    if (sample === a && previous?.end === a && previous.year !== strip.year) {
      samples.push({ sourceIndex: index, strip: stripIndex - 1, year: previous.year, phase: 1, t: 1, missing: false });
    }
    if (sample === a) observationIndices.push(samples.length);
    const date = dates[a] + (dates[b] - dates[a]) * (sample - a);
    samples.push({ sourceIndex: index, strip: stripIndex, year: strip.year, phase: date - strip.year,
      t: (sample - strip.start) / (strip.end - strip.start || 1), missing: sample > strip.end });
  }
  return { strips, samples, observationIndices };
}

export function yearlySegments(dates) {
  if (!dates.length) return [];
  const segments = [];
  let start = 0;
  for (let index = 1; index <= dates.length; index++) {
    if (index === dates.length || calendarYear(dates[index]) !== calendarYear(dates[index - 1])
        || dates[index] - dates[index - 1] > 1 / 12 + 1e-6) {
      segments.push({ start, end: index - 1 });
      start = index;
    }
  }
  return segments;
}

export function graphLayout(minRadius, maxRadius) {
  const width = Math.max(32, maxRadius * 2);
  const center = (minRadius + maxRadius) / 2;
  return {
    width, center, minRadius, maxRadius,
    monthZ: center - minRadius + 3,
    yearZ: center - maxRadius - 4,
    radius: Math.hypot(width / 2 + 6, (maxRadius - minRadius) / 2 + 7),
  };
}

// Reduce the curvature to zero while retaining the value as a normal offset.
export function unrollPolar(radius, phase, progress, layout, target = {}) {
  const bend = 1 - progress;
  const reference = layout.width / (2 * Math.PI);
  const angle = 2 * Math.PI * phase * bend;
  if (bend < 1e-6) {
    target.x = layout.width * (phase - 0.5);
    target.z = layout.center - radius;
  } else {
    target.x = (reference / bend + radius - reference) * Math.sin(angle) - progress * layout.width / 2;
    target.z = reference / bend * 2 * Math.sin(angle / 2) ** 2
      - (radius - reference) * Math.cos(angle) - reference + progress * layout.center;
  }
  return target;
}

export function unrollFrame(progress, layout) {
  let x = 0, z = 0;
  const point = {};
  // A fixed arc centroid moves smoothly; a changing bounding-box extremum can introduce jolts.
  for (let step = 0; step < 64; step++) {
    unrollPolar(layout.center, (step + 0.5) / 64, progress, layout, point);
    x -= point.x / 64;
    z -= point.z / 64;
  }
  return {
    x, z,
    radius: (1 - progress) * (layout.maxRadius + 7) + progress * layout.radius
      + Math.sin(Math.PI * progress) ** 2 * layout.width * 0.08,
  };
}
