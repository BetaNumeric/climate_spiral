const PRESETS = {
  '1080p': [1920, 1080],
  portrait: [1080, 1920],
  square: [1080, 1080],
};

export const VIDEO_EXPORT_FPS = 30;
export const MAX_VIDEO_PATH_STEPS = 20;
export const DEFAULT_VIDEO_MOVE_SECONDS = 2;
export const DEFAULT_VIDEO_PAUSE_SECONDS = 1;
export const DEFAULT_VIDEO_CAMERA_PATH = {
  start: 'spiral-top',
  steps: [
    { type: 'pause', seconds: DEFAULT_VIDEO_PAUSE_SECONDS },
    { type: 'view', view: 'spiral-front' },
    { type: 'pause', seconds: DEFAULT_VIDEO_PAUSE_SECONDS },
  ],
};

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

export function getVideoOrbitFrame(radius, halfHeight, aspect, verticalFov = null,
  sceneScale = 1) {
  if (!Number.isFinite(sceneScale) || sceneScale <= 0) throw new Error('Scene scale must be greater than zero.');
  const envelopeRadius = Math.hypot(radius, halfHeight);
  const framingScale = 1.04 / sceneScale;
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

export function getVideoFramePlan(observationCount, monthsPerFrame, turnSeconds = 0, pathSteps = 1) {
  if (!Number.isInteger(observationCount) || observationCount < 2) throw new Error('No monthly data is available to export.');
  if (!Number.isInteger(monthsPerFrame) || monthsPerFrame < 1 || monthsPerFrame > 12) {
    throw new Error('Choose between 1 and 12 months per frame.');
  }
  if (!Number.isFinite(turnSeconds) || turnSeconds < 0 || turnSeconds > 10) {
    throw new Error('Transition must be between 0 and 10 seconds.');
  }
  if (Number.isInteger(pathSteps) && (pathSteps < 0 || pathSteps > MAX_VIDEO_PATH_STEPS)) {
    throw new Error(`Choose up to ${MAX_VIDEO_PATH_STEPS} valid camera steps.`);
  }
  const steps = Number.isInteger(pathSteps)
    ? Array.from({ length: pathSteps }, () => ({ type: 'view', seconds: turnSeconds }))
    : pathSteps;
  if (!Array.isArray(steps) || steps.length > MAX_VIDEO_PATH_STEPS || steps.some(step =>
    !['view', 'pause'].includes(step?.type) || !Number.isFinite(step.seconds)
    || step.seconds < 0 || step.seconds > (step.type === 'pause' ? 30 : 10))) {
    throw new Error(`Choose up to ${MAX_VIDEO_PATH_STEPS} valid camera steps.`);
  }
  const startHoldFrames = Math.round(0.25 * VIDEO_EXPORT_FPS);
  const drawSteps = Math.ceil((observationCount - 1) / monthsPerFrame);
  const framesPerMove = Math.round(turnSeconds * VIDEO_EXPORT_FPS);
  const stepFrames = steps.map(step => Math.round(step.seconds * VIDEO_EXPORT_FPS));
  const turnFrames = stepFrames.reduce((total, frames) => total + frames, 0);
  const endHoldFrames = Math.round(0.5 * VIDEO_EXPORT_FPS);
  return {
    observationCount, monthsPerFrame, startHoldFrames, drawSteps, framesPerMove,
    moveCount: steps.length, stepFrames, stepTypes: steps.map(step => step.type), turnFrames, endHoldFrames,
    totalFrames: startHoldFrames + drawSteps + turnFrames + endHoldFrames,
  };
}

export function getVideoFrameTiming(frameIndex, plan) {
  const drawStep = Math.max(0, frameIndex - plan.startHoldFrames + 1);
  const observationIndex = Math.min(plan.observationCount - 1, drawStep * plan.monthsPerFrame);
  const turnStep = frameIndex - plan.startHoldFrames - plan.drawSteps;
  let moveIndex = 0;
  let stepStart = 0;
  while (moveIndex < plan.stepFrames.length - 1 && turnStep >= stepStart + plan.stepFrames[moveIndex]) {
    stepStart += plan.stepFrames[moveIndex++];
  }
  const frames = plan.stepFrames[moveIndex] || 0;
  const moveStep = turnStep - stepStart;
  const fraction = frames > 1 ? Math.max(0, Math.min(1, moveStep / (frames - 1)))
    : moveStep >= 0 && frames === 1 ? 1 : 0;
  return { observationIndex, moveIndex, transition: fraction,
    turn: fraction * fraction * (3 - 2 * fraction) };
}
