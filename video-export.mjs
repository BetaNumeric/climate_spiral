const PRESETS = {
  '1080p': [1920, 1080],
  portrait: [1080, 1920],
  square: [1080, 1080],
};

export const VIDEO_EXPORT_FPS = 30;

export function getVideoLayout(width, height, includeLegend = false) {
  const fullFrame = { x: 0, y: 0, width, height };
  if (!includeLegend) return { scene: fullFrame, legend: null, placement: 'none' };

  const padding = Math.max(12, Math.round(Math.min(width, height) * 0.035));
  if (width > height) {
    return {
      scene: {
        x: Math.round(width * 0.03),
        y: 0,
        width: Math.round(width * 0.55),
        height,
      },
      legend: {
        x: Math.round(width * 0.59),
        y: Math.round(height * 0.34),
        width: Math.round(width * 0.29),
        height: Math.round(height * 0.32),
      },
      placement: 'side',
    };
  }

  const sceneHeight = Math.round(height * 0.74);
  const legendY = Math.round(height * 0.76);
  return {
    scene: { x: 0, y: 0, width, height: sceneHeight },
    legend: {
      x: padding,
      y: legendY,
      width: width - 2 * padding,
      height: Math.min(Math.round(height * 0.15), height - legendY - padding),
    },
    placement: 'below',
  };
}

export function getVideoDimensions(preset, width, height, sourceWidth, sourceHeight) {
  if (preset === 'window') {
    const scale = Math.min(1, 1920 / Math.max(sourceWidth, sourceHeight));
    return [sourceWidth, sourceHeight].map(value => Math.max(2, Math.floor(value * scale / 2) * 2));
  }
  if (Object.hasOwn(PRESETS, preset)) return [...PRESETS[preset]];
  if (preset !== 'custom') throw new Error('Choose a video resolution.');
  if (![width, height].every(value => Number.isInteger(value) && value >= 128 && value <= 3840 && value % 2 === 0)) {
    throw new Error('Width and height must be even numbers between 128 and 3840 pixels.');
  }
  if (width * height > 3840 * 2160) throw new Error('Use a resolution of 8.3 megapixels or less.');
  return [width, height];
}

export function getVideoOrbitFrame(radius, halfHeight, aspect, verticalFov = null) {
  const envelopeRadius = Math.hypot(radius, halfHeight);
  const framingScale = 1.04;
  const visibleHalfHeight = envelopeRadius * framingScale / Math.min(1, aspect);
  const halfFov = verticalFov === null ? null : verticalFov * Math.PI / 360;
  const distance = halfFov === null
    ? 2 * envelopeRadius + 10
    : envelopeRadius * framingScale / Math.sin(Math.atan(Math.tan(halfFov) * Math.min(1, aspect)));
  return { visibleHalfHeight, distance, far: distance + 2 * envelopeRadius };
}

export function getVideoRecorderOptions(mimeType, width, height) {
  return {
    mimeType,
    videoBitsPerSecond: Math.round(12000000 * Math.max(1, width * height / (1920 * 1080))),
    // Request regular independently decodable frames for seeking in desktop players.
    videoKeyFrameIntervalDuration: 500,
  };
}

export function getVideoFramePlan(observationCount, monthsPerFrame, turnSeconds = 0) {
  if (!Number.isInteger(observationCount) || observationCount < 2) throw new Error('No monthly data is available to export.');
  if (!Number.isInteger(monthsPerFrame) || monthsPerFrame < 1 || monthsPerFrame > 12) {
    throw new Error('Choose between 1 and 12 months per frame.');
  }
  if (!Number.isFinite(turnSeconds) || turnSeconds < 0 || turnSeconds > 10) {
    throw new Error('Camera turn must be between 0 and 10 seconds.');
  }
  const startHoldFrames = Math.round(0.25 * VIDEO_EXPORT_FPS);
  const drawSteps = Math.ceil((observationCount - 1) / monthsPerFrame);
  const turnFrames = Math.round(turnSeconds * VIDEO_EXPORT_FPS);
  const endHoldFrames = Math.round(0.5 * VIDEO_EXPORT_FPS);
  return {
    observationCount, monthsPerFrame, startHoldFrames, drawSteps, turnFrames, endHoldFrames,
    totalFrames: startHoldFrames + drawSteps + turnFrames + endHoldFrames,
  };
}

export function getVideoFrameTiming(frameIndex, plan) {
  const drawStep = Math.max(0, frameIndex - plan.startHoldFrames + 1);
  const observationIndex = Math.min(plan.observationCount - 1, drawStep * plan.monthsPerFrame);
  const turnStep = frameIndex - plan.startHoldFrames - plan.drawSteps;
  const fraction = plan.turnFrames > 1
    ? Math.max(0, Math.min(1, turnStep / (plan.turnFrames - 1)))
    : turnStep >= 0 && plan.turnFrames === 1 ? 1 : 0;
  return { observationIndex, turn: fraction * fraction * (3 - 2 * fraction) };
}
