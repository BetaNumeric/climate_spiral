import { VIDEO_EXPORT_FPS, MAX_VIDEO_PATH_STEPS, getVideoDimensions, getVideoFramePlan, getVideoFrameTiming,
    getVideoLayout, getVideoOrbitFrame, getVideoRecorderOptions } from './video-export.mjs';

const VIDEO_VIEW_PRESETS = {
    'spiral-top': { label: 'Spiral · Top', layout: 0, polar: 0, azimuth: 0 },
    'spiral-front': { label: 'Spiral · Front', layout: 0, polar: Math.PI / 2, azimuth: 0 },
    'spiral-right': { label: 'Spiral · Right', layout: 0, polar: Math.PI / 2, azimuth: Math.PI / 2 },
    'graph-top': { label: 'Unwrapped · Top', layout: 1, polar: 0, azimuth: 0 },
    'graph-front': { label: 'Unwrapped · Front', layout: 1, polar: Math.PI / 2, azimuth: 0 },
    'graph-right': { label: 'Unwrapped · Right', layout: 1, polar: Math.PI / 2, azimuth: Math.PI / 2 }
};

export function createVideoController({ THREE, renderer, cameraController, fontFamily, getSceneState,
    getActiveDisplay, getFraming, finishLayoutTransition, cancelLocalLoad, setPlaybackPosition,
    toggleAnimation, setLayoutMix, advanceToObservation }) {
    let videoExport = null;
    let videoPreview = null;
    let videoDownloadUrl = null;

    function getVideoMimeType() {
        if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) return null;
        return [
            'video/mp4;codecs=avc1',
            'video/mp4',
            'video/webm;codecs=vp9',
            'video/webm;codecs=vp8',
            'video/webm'
        ].find(type => MediaRecorder.isTypeSupported(type)) || null;
    }

    function getConfiguredVideoPath() {
        const start = document.getElementById('videoCamera').value;
        const steps = Array.from(document.querySelectorAll('#videoViewList .video-view-step'), row => {
            const view = row.querySelector('.video-step-view').value;
            if (view !== 'pause') return { type: 'view', view };
            const seconds = row.querySelector('.video-pause-seconds').valueAsNumber;
            if (!Number.isFinite(seconds) || seconds < 0.5 || seconds > 30) {
                throw new Error('Pause length must be between 0.5 and 30 seconds.');
            }
            return { type: 'pause', seconds };
        });
        if (start !== 'current' && !Object.hasOwn(VIDEO_VIEW_PRESETS, start)) throw new Error('Choose a start view.');
        if (steps.length > MAX_VIDEO_PATH_STEPS || steps.some(step =>
            step.type === 'view' && !Object.hasOwn(VIDEO_VIEW_PRESETS, step.view))) {
            throw new Error(`Choose up to ${MAX_VIDEO_PATH_STEPS} camera steps.`);
        }
        return { start, steps };
    }

    function getCurrentVideoFramePlan() {
        const { timelineStops, monthsPerFrame } = getSceneState();
        const { steps } = getConfiguredVideoPath();
        const hasMoves = steps.some(step => step.type === 'view');
        const seconds = hasMoves ? document.getElementById('videoTransition').valueAsNumber : 0;
        if (hasMoves && (!Number.isFinite(seconds) || seconds < 0.5 || seconds > 10)) {
            throw new Error('Seconds per move must be between 0.5 and 10.');
        }
        return getVideoFramePlan(timelineStops.length, monthsPerFrame, seconds,
            steps.map(step => ({ type: step.type, seconds: step.type === 'pause' ? step.seconds : seconds })));
    }

    function updateVideoPathControls() {
        const rows = Array.from(document.querySelectorAll('#videoViewList .video-view-step'));
        rows.forEach((row, index) => {
            const select = row.querySelector('select');
            select.setAttribute('aria-label', `Camera step ${index + 1}`);
            row.querySelector('.video-pause-duration').hidden = select.value !== 'pause';
            row.querySelector('.video-pause-seconds').setAttribute('aria-label', `Pause ${index + 1} length in seconds`);
            for (const [action, unavailable] of [['up', index === 0], ['down', index === rows.length - 1]]) {
                const button = row.querySelector(`[data-action="${action}"]`);
                button.disabled = unavailable;
                button.setAttribute('aria-label', `Move view ${index + 1} ${action}`);
                button.title = button.getAttribute('aria-label');
            }
            const remove = row.querySelector('[data-action="remove"]');
            remove.setAttribute('aria-label', `Remove view ${index + 1}`);
            remove.title = remove.getAttribute('aria-label');
        });
        for (const id of ['videoAddView', 'videoAddPause']) {
            document.getElementById(id).disabled = rows.length >= MAX_VIDEO_PATH_STEPS || Boolean(videoExport || videoPreview);
        }
        document.getElementById('videoTransitionRow').hidden = !rows.some(row => row.querySelector('select').value !== 'pause');
        updateVideoDurationEstimate();
    }

    function addVideoStep(type = 'view') {
        const list = document.getElementById('videoViewList');
        if (list.children.length >= MAX_VIDEO_PATH_STEPS || videoExport || videoPreview) return;
        const row = document.createElement('div');
        row.className = 'video-view-step';
        const select = document.createElement('select');
        select.className = 'video-step-view';
        for (const [key, view] of Object.entries(VIDEO_VIEW_PRESETS)) select.add(new Option(view.label, key));
        select.add(new Option('Pause', 'pause'));
        const previous = Array.from(list.querySelectorAll('select')).map(element => element.value)
            .filter(value => value !== 'pause').at(-1)
            || document.getElementById('videoCamera').value;
        const keys = Object.keys(VIDEO_VIEW_PRESETS);
        select.value = type === 'pause' ? 'pause'
            : previous === 'current' ? 'spiral-front' : keys[(keys.indexOf(previous) + 1) % keys.length];
        row.append(select);
        for (const [action, symbol] of [['up', '↑'], ['down', '↓'], ['remove', '×']]) {
            const button = document.createElement('button');
            button.className = 'video-step-button';
            button.type = 'button';
            button.dataset.action = action;
            button.textContent = symbol;
            row.append(button);
        }
        const duration = document.createElement('label');
        duration.className = 'video-pause-duration';
        duration.textContent = 'Pause length (s)';
        const input = document.createElement('input');
        input.className = 'video-pause-seconds video-number';
        input.type = 'number';
        input.min = '0.5'; input.max = '30'; input.step = '0.5'; input.value = '2';
        input.inputMode = 'decimal';
        duration.append(input);
        row.append(duration);
        list.append(row);
        updateVideoPathControls();
        (type === 'pause' ? input : select).focus();
    }

    function updateVideoDurationEstimate() {
        const output = document.getElementById('videoDurationEstimate');
        try {
            const { totalFrames } = getCurrentVideoFramePlan();
            const totalSeconds = Math.round(totalFrames / VIDEO_EXPORT_FPS);
            output.textContent = Math.floor(totalSeconds / 60) + ':' + String(totalSeconds % 60).padStart(2, '0');
        } catch {
            output.textContent = '--:--';
        }
    }

    function resolveVideoPath(session) {
        const offset = session.savedCamera.position.clone().sub(session.target);
        const spherical = new THREE.Spherical().setFromVector3(offset);
        const startView = session.cameraPath.start === 'current'
            ? { layout: session.savedLayoutMix, polar: spherical.phi, azimuth: spherical.theta }
            : VIDEO_VIEW_PRESETS[session.cameraPath.start];
        session.views = [startView];
        for (const step of session.cameraPath.steps) {
            session.views.push(step.type === 'pause'
                ? session.views.at(-1) : VIDEO_VIEW_PRESETS[step.view]);
        }
        session.isCurrentOnly = session.cameraPath.start === 'current'
            && session.cameraPath.steps.every(step => step.type === 'pause');
    }

    function formatVideoTime(seconds) {
        const whole = Math.floor(seconds);
        return Math.floor(whole / 60) + ':' + String(whole % 60).padStart(2, '0');
    }

    function startVideoPreview() {
        const { activeCamera, controls, spiralMesh, timelineStops, animationIndex, isAnimating, totalIndices } = getSceneState();
        if (videoPreview) { stopVideoPreview(); return; }
        if (videoExport || !spiralMesh || !timelineStops.length) return;
        cancelLocalLoad();
        let cameraPath, framePlan;
        try {
            cameraPath = getConfiguredVideoPath();
            framePlan = getCurrentVideoFramePlan();
        } catch (error) {
            setVideoExportStatus(error.message);
            return;
        }
        finishLayoutTransition();
        const session = {
            cameraPath, framePlan, savedLayoutMix: getSceneState().layoutMix,
            savedCamera: activeCamera.clone(), target: controls.target.clone(),
            dampingEnabled: controls.enableDamping,
            controlsEnabled: cameraController.controlsEnabled,
            index: animationIndex, wasAnimating: isAnimating,
            settingsVisible: document.getElementById('settingsPanel').classList.contains('visible'),
            transportVisibility: document.getElementById('bottomWrapper').style.visibility,
            layout: { scene: { width: renderer.domElement.width, height: renderer.domElement.height } },
            startedAt: performance.now(),
            totalFrames: framePlan.startHoldFrames + framePlan.turnFrames + framePlan.endHoldFrames
        };
        resolveVideoPath(session);
        if (isAnimating) toggleAnimation();
        videoPreview = session;
        cameraController.cancelAnimation();
        controls.enableDamping = false;
        controls.update();
        controls.enabled = false;
        if (!session.isCurrentOnly) initializeVideoOrbit(session);
        setPlaybackPosition(totalIndices);
        document.getElementById('settingsPanel').classList.remove('visible');
        document.getElementById('bottomWrapper').style.visibility = 'hidden';
        document.getElementById('videoPreviewBar').hidden = false;
        document.getElementById('videoPreviewBtn').textContent = 'Stop preview';
        updateVideoPathControls();
    }

    function updateVideoPreview() {
        const session = videoPreview;
        const elapsedFrames = Math.floor((performance.now() - session.startedAt) * VIDEO_EXPORT_FPS / 1000);
        if (elapsedFrames >= session.totalFrames) { stopVideoPreview(); return; }
        const frame = Math.min(session.totalFrames - 1, elapsedFrames);
        const timing = getVideoFrameTiming(frame + session.framePlan.drawSteps, session.framePlan);
        updateVideoCamera(session, timing.moveIndex, timing.turn);
        document.getElementById('videoPreviewTime').textContent =
            `${formatVideoTime(frame / VIDEO_EXPORT_FPS)} / ${formatVideoTime(Math.ceil(session.totalFrames / VIDEO_EXPORT_FPS))}`;
    }

    function stopVideoPreview() {
        const { activeCamera, controls, layoutMix } = getSceneState();
        const session = videoPreview;
        if (!session) return;
        videoPreview = null;
        if (layoutMix !== session.savedLayoutMix) {
            setLayoutMix(session.savedLayoutMix);
        }
        activeCamera.copy(session.savedCamera, false);
        controls.target.copy(session.target);
        controls.update();
        controls.enableDamping = session.dampingEnabled;
        controls.enabled = session.controlsEnabled;
        setPlaybackPosition(session.index);
        if (session.wasAnimating) toggleAnimation();
        document.getElementById('bottomWrapper').style.visibility = session.transportVisibility;
        document.getElementById('videoPreviewBar').hidden = true;
        document.getElementById('videoPreviewBtn').textContent = 'Preview';
        if (session.settingsVisible) document.getElementById('settingsPanel').classList.add('visible');
        updateVideoPathControls();
    }

    function setVideoExportStatus(message) {
        document.getElementById('videoExportStatus').textContent = message;
        document.getElementById('exportSectionStatus').textContent = videoExport
            ? (videoExport.stopping ? 'Finishing...' : videoExport.paused ? 'Paused' : 'Recording')
            : (videoDownloadUrl ? 'Ready' : '');
    }

    function drawVideoLegend(session) {
        const { currentDatasetKey, localSnapshot } = getSceneState();
        const rect = session.layout.legend;
        if (!rect) return;

        const context = session.context;
        // Keep legend type and strokes proportional to a 1080px short edge.
        const pixelScale = Math.min(session.canvas.width, session.canvas.height) / 1080;
        const date = document.getElementById('infoMonth').textContent + ' '
            + document.getElementById('infoYear').textContent;
        const valueElement = document.getElementById('infoTemp');
        const value = valueElement.textContent;
        let headlineSize = Math.max(11 * pixelScale, Math.min(46 * pixelScale, rect.width / 14, rect.height * 0.22));
        const headlineGap = Math.max(8 * pixelScale, rect.width * 0.04);

        context.save();
        context.textBaseline = 'alphabetic';
        if (currentDatasetKey === 'local' && localSnapshot) {
            context.font = `500 ${Math.min(22 * pixelScale, rect.height * 0.09)}px ${fontFamily}`;
            context.fillStyle = '#bbbbbb';
            context.textAlign = 'left';
            context.fillText(localSnapshot.location.name.replaceAll('_', ' ') + (localSnapshot.location.isCountry ? ' (representative point)' : ''),
                rect.x, rect.y + rect.height * 0.08, rect.width);
        }
        context.font = `700 ${headlineSize}px ${fontFamily}`;
        while (headlineSize > 11 * pixelScale && context.measureText(date).width + context.measureText(value).width + headlineGap > rect.width) {
            headlineSize -= pixelScale;
            context.font = `700 ${headlineSize}px ${fontFamily}`;
        }

        const headlineY = rect.y + rect.height * 0.28;
        context.fillStyle = '#ffffff';
        context.textAlign = 'left';
        context.fillText(date, rect.x, headlineY);
        context.fillStyle = getComputedStyle(valueElement).color;
        context.textAlign = 'right';
        context.fillText(value, rect.x + rect.width, headlineY);

        const barY = rect.y + rect.height * 0.47;
        const barHeight = Math.max(6 * pixelScale, Math.min(18 * pixelScale, rect.height * 0.075));
        const gradient = context.createLinearGradient(rect.x, 0, rect.x + rect.width, 0);
        getActiveDisplay().legendStops.forEach(([position, color]) => gradient.addColorStop(position, color));
        context.fillStyle = gradient;
        context.fillRect(rect.x, barY, rect.width, barHeight);

        const marker = document.getElementById('legendMarker');
        if (!marker.hidden) {
            const markerFraction = Math.max(0, Math.min(1, Number.parseFloat(marker.style.left) / 100));
            const markerWidth = Math.max(2 * pixelScale, rect.width * 0.003);
            context.fillStyle = '#ffffff';
            context.shadowColor = 'rgba(0, 0, 0, 0.8)';
            context.shadowBlur = markerWidth * 2;
            context.fillRect(
                Math.round(rect.x + rect.width * markerFraction - markerWidth / 2),
                barY - barHeight * 0.45,
                markerWidth,
                barHeight * 1.9
            );
            context.shadowBlur = 0;
        }

        const labels = Array.from(document.querySelectorAll('.legend-labels span'), element => element.textContent);
        const labelSize = Math.max(9 * pixelScale, Math.min(24 * pixelScale, rect.width / Math.max(18, labels.length * 5), rect.height * 0.12));
        context.font = `600 ${labelSize}px ${fontFamily}`;
        context.fillStyle = '#dddddd';
        const labelY = barY + barHeight + rect.height * 0.16;
        labels.forEach((label, index) => {
            const fraction = labels.length === 1 ? 0.5 : index / (labels.length - 1);
            context.textAlign = index === 0 ? 'left' : index === labels.length - 1 ? 'right' : 'center';
            context.fillText(label, rect.x + rect.width * fraction, labelY);
        });
        if (currentDatasetKey === 'local') {
            context.font = `400 ${Math.min(16 * pixelScale, rect.height * 0.07)}px ${fontFamily}`;
            context.fillStyle = '#aaaaaa';
            context.textAlign = 'left';
            const attribution = localSnapshot?.country ? `CRU-CY ${localSnapshot.release} / UEA (country average)`
                : localSnapshot?.station ? 'NOAA GHCN-Monthly v4 (adjusted)' : 'ERA5-Land / Open-Meteo (CC BY 4.0)';
            context.fillText(attribution + ' | Baseline 1951-1980', rect.x, rect.y + rect.height * 0.94, rect.width);
        }
        context.restore();
    }

    function startVideoExport() {
        cancelLocalLoad();
        if (videoPreview) stopVideoPreview();
        if (videoExport) {
            cancelVideoExport();
            return;
        }

        const { activeCamera, controls, spiralMesh, animationIndex, isAnimating, totalIndices, currentDatasetKey, startYear, endYear } = getSceneState();
        const status = document.getElementById('videoExportStatus');
        let dimensions;
        let cameraPath;
        let framePlan;
        try {
            cameraPath = getConfiguredVideoPath();
            framePlan = getCurrentVideoFramePlan();
            dimensions = getVideoDimensions(
                document.getElementById('videoResolution').value,
                document.getElementById('videoWidth').valueAsNumber,
                document.getElementById('videoHeight').valueAsNumber,
                renderer.domElement.width, renderer.domElement.height
            );
        } catch (error) {
            setVideoExportStatus(error.message);
            return;
        }
        const mimeType = getVideoMimeType();
        if (!mimeType || !spiralMesh || totalIndices <= 0 || document.hidden) {
            setVideoExportStatus(mimeType ? 'No animation is available to export.' : 'Video export is unavailable in this browser.');
            return;
        }
        finishLayoutTransition();

        let stream;
        try {
            const canvas = document.createElement('canvas');
            const source = renderer.domElement;
            [canvas.width, canvas.height] = dimensions;
            const layout = getVideoLayout(
                canvas.width, canvas.height, document.getElementById('videoLegendToggle').checked
            );
            const context = canvas.getContext('2d', { alpha: false });
            if (!context) throw new Error('Could not create a recording canvas.');
            // A zero-rate stream captures only explicitly requested frames.
            stream = canvas.captureStream(0);
            const videoTrack = stream.getVideoTracks()[0];
            if (!videoTrack || typeof videoTrack.requestFrame !== 'function') {
                throw new Error('This browser cannot capture video at a fixed frame rate.');
            }
            const recorder = new MediaRecorder(stream, getVideoRecorderOptions(mimeType, canvas.width, canvas.height));
            const session = {
                canvas, context, stream, videoTrack, recorder, chunks: [],
                abortController: new AbortController(),
                layout,
                cameraPath,
                savedLayoutMix: getSceneState().layoutMix,
                framePlan,
                savedCamera: activeCamera.clone(),
                target: controls.target.clone(),
                dampingEnabled: controls.enableDamping,
                rendererSize: renderer.getSize(new THREE.Vector2()),
                pixelRatio: renderer.getPixelRatio(),
                objectFit: source.style.objectFit,
                totalFrames: framePlan.totalFrames,
                frameIndex: 0,
                nextFrameAt: performance.now(),
                captureDue: false,
                paused: false,
                stopping: false,
                lastPercent: -1,
                index: animationIndex,
                wasAnimating: isAnimating,
                controlsEnabled: cameraController.controlsEnabled,
                filename: 'climate-spiral-' + currentDatasetKey + '-' + startYear + '-' + endYear,
                disabledControls: []
            };

            resolveVideoPath(session);

            videoExport = session;
            cameraController.cancelAnimation();
            // Drain any pending OrbitControls motion before locking the recording view.
            controls.enableDamping = false;
            controls.update();
            activeCamera.copy(session.savedCamera, false);
            controls.target.copy(session.target);
            controls.update();
            controls.enabled = false;
            renderer.setPixelRatio(1);
            renderer.setSize(layout.scene.width, layout.scene.height, false);
            source.style.objectFit = 'contain';
            const aspect = layout.scene.width / layout.scene.height;
            if (activeCamera.isPerspectiveCamera) {
                activeCamera.zoom *= Math.min(1, aspect / activeCamera.aspect);
                activeCamera.aspect = aspect;
            } else {
                const halfHeight = Math.max(activeCamera.top, activeCamera.right / aspect);
                activeCamera.left = -halfHeight * aspect;
                activeCamera.right = halfHeight * aspect;
                activeCamera.top = halfHeight;
                activeCamera.bottom = -halfHeight;
            }
            activeCamera.updateProjectionMatrix();
            if (!session.isCurrentOnly) initializeVideoOrbit(session);
            setPlaybackPosition(0);
            const inputs = document.querySelectorAll(
                '#settingsPanel input, #settingsPanel select, #settingsPanel button:not(.close-btn):not(#videoExportBtn), #transportGroup button, #timelineSlider'
            );
            session.disabledControls = Array.from(inputs, element => ({ element, disabled: element.disabled }));
            inputs.forEach(element => { element.disabled = true; });
            document.getElementById('videoExportBtn').textContent = 'Cancel export';
            document.getElementById('videoExportProgress').value = 0;
            document.getElementById('videoExportProgress').hidden = false;
            setVideoExportStatus('Recording 0%');
            status.scrollIntoView({ block: 'nearest' });

            recorder.ondataavailable = event => {
                if (videoExport === session && event.data.size) session.chunks.push(event.data);
            };
            recorder.onerror = () => {
                if (videoExport === session) cancelVideoExport('Recording failed. Try a lower resolution or another browser.');
            };
            recorder.onstop = async () => {
                if (videoExport !== session) return;
                const blob = new Blob(session.chunks, { type: recorder.mimeType || mimeType });
                if (!session.stopping || !blob.size) {
                    finishVideoExport(session, 'Recording ended before the video was complete.');
                    return;
                }
                session.chunks.length = 0;
                setVideoExportStatus('Finalizing video index...');
                try {
                    const { finalizeVideo } = await import('./video-mux.mjs');
                    const indexedBlob = await finalizeVideo(blob, session.abortController.signal, VIDEO_EXPORT_FPS);
                    if (videoExport === session) finishVideoExport(session, 'Download started.', indexedBlob);
                } catch (error) {
                    if (videoExport !== session) return;
                    console.error('Video finalization failed:', error);
                    finishVideoExport(session, 'Could not finalize the video. Try a lower resolution or another browser.');
                }
            };
            recorder.start();
        } catch (error) {
            console.error('Video export failed:', error);
            stream?.getTracks().forEach(track => track.stop());
            if (videoExport) cancelVideoExport('Could not start recording. Try a lower resolution or another browser.');
            else setVideoExportStatus('Could not start recording. Try a lower resolution or another browser.');
        }
    }

    function initializeVideoOrbit(session) {
        const { activeCamera, controls, spiralHeight } = getSceneState();
        const aspect = session.layout.scene.width / session.layout.scene.height;
        const { radius, height: framingHeight, scale } = getFraming(session.views.map(view => view.layout));
        const { visibleHalfHeight, distance, far } = getVideoOrbitFrame(
            radius, framingHeight / 2,
            aspect, activeCamera.isPerspectiveCamera ? activeCamera.fov : null,
            scale
        );
        // Frame once, then orbit with the same fixed target, distance and projection as a viewport drag.
        session.orbitDistance = distance;
        activeCamera.zoom = 1;
        if (activeCamera.isOrthographicCamera) {
            activeCamera.left = -visibleHalfHeight * aspect;
            activeCamera.right = visibleHalfHeight * aspect;
            activeCamera.top = visibleHalfHeight;
            activeCamera.bottom = -visibleHalfHeight;
        }
        activeCamera.far = Math.max(session.savedCamera.far, far);
        controls.target.set(0, spiralHeight / 2, 0);
        activeCamera.updateProjectionMatrix();
        updateVideoCamera(session, 0, 0);
    }

    function updateVideoCamera(session, moveIndex, turn) {
        const { activeCamera, controls, layoutMix } = getSceneState();
        if (session.isCurrentOnly) return;
        const from = session.views[moveIndex];
        const to = session.views[Math.min(moveIndex + 1, session.views.length - 1)];
        const mix = THREE.MathUtils.lerp(from.layout, to.layout, turn);
        if (layoutMix !== mix) {
            setLayoutMix(mix);
        }
        const polar = Math.max(0.000001, THREE.MathUtils.lerp(from.polar, to.polar, turn));
        const delta = Math.atan2(Math.sin(to.azimuth - from.azimuth), Math.cos(to.azimuth - from.azimuth));
        const azimuth = from.azimuth + delta * turn;
        const distance = session.orbitDistance;
        activeCamera.position.set(
            controls.target.x + distance * Math.sin(polar) * Math.sin(azimuth),
            controls.target.y + distance * Math.cos(polar),
            controls.target.z + distance * Math.sin(polar) * Math.cos(azimuth)
        );
        controls.update();
    }

    function updateVideoExport() {
        const session = videoExport;
        if (session.stopping || session.paused || session.captureDue) return;
        const now = performance.now();
        if (now < session.nextFrameAt) return;
        const { observationIndex, moveIndex, turn } = getVideoFrameTiming(session.frameIndex, session.framePlan);
        updateVideoCamera(session, moveIndex, turn);
        advanceToObservation(observationIndex);
        session.captureDue = true;
        const percent = Math.min(100, Math.floor(session.frameIndex / session.totalFrames * 100));
        if (percent !== session.lastPercent) {
            session.lastPercent = percent;
            document.getElementById('videoExportProgress').value = percent;
            setVideoExportStatus('Recording ' + percent + '%');
        }
    }

    function captureVideoFrame() {
        const session = videoExport;
        if (!session || session.stopping || session.paused || !session.captureDue) return;
        try {
            // Copy immediately after rendering, before WebGL clears its drawing buffer.
            session.context.globalCompositeOperation = 'copy';
            session.context.fillStyle = '#000000';
            session.context.fillRect(0, 0, session.canvas.width, session.canvas.height);
            session.context.globalCompositeOperation = 'source-over';
            const scene = session.layout.scene;
            session.context.drawImage(renderer.domElement, scene.x, scene.y, scene.width, scene.height);
            drawVideoLegend(session);
            session.videoTrack.requestFrame();
            session.captureDue = false;
            session.frameIndex++;
            session.nextFrameAt = performance.now() + 1000 / VIDEO_EXPORT_FPS;
            if (session.frameIndex >= session.totalFrames) {
                session.stopping = true;
                document.getElementById('videoExportProgress').value = 100;
                setVideoExportStatus('Finishing video...');
                // Give the encoder a turn to consume the final requested canvas frame.
                setTimeout(() => {
                    if (videoExport === session && session.recorder.state !== 'inactive') session.recorder.stop();
                }, 100);
            }
        } catch (error) {
            console.error('Video recording failed:', error);
            cancelVideoExport('Recording failed. Try another browser.');
        }
    }

    function setVideoExportPaused(paused) {
        const session = videoExport;
        if (!session || session.stopping || session.paused === paused) return;
        session.paused = paused;
        session.captureDue = false;
        if (paused) {
            if (session.recorder.state === 'recording') session.recorder.pause();
            const percent = Math.floor(session.frameIndex / session.totalFrames * 100);
            setVideoExportStatus('Paused at ' + percent + '%. Return to this page to continue.');
        } else {
            if (session.recorder.state === 'paused') session.recorder.resume();
            session.nextFrameAt = performance.now();
            setVideoExportStatus('Recording ' + Math.floor(session.frameIndex / session.totalFrames * 100) + '%');
        }
    }

    function cancelVideoExport(message = 'Export cancelled.') {
        if (videoExport) finishVideoExport(videoExport, message);
    }

    function finishVideoExport(session, message, blob = null) {
        const { activeCamera, controls, layoutMix } = getSceneState();
        videoExport = null;
        session.abortController.abort();
        if (session.recorder.state !== 'inactive') session.recorder.stop();
        session.stream.getTracks().forEach(track => track.stop());
        session.disabledControls.forEach(({ element, disabled }) => { element.disabled = disabled; });
        if (layoutMix !== session.savedLayoutMix) {
            setLayoutMix(session.savedLayoutMix);
        }
        activeCamera.copy(session.savedCamera, false);
        controls.target.copy(session.target);
        controls.update();
        controls.enableDamping = session.dampingEnabled;
        controls.enabled = session.controlsEnabled;
        renderer.setPixelRatio(session.pixelRatio);
        renderer.setSize(session.rendererSize.x, session.rendererSize.y);
        renderer.domElement.style.objectFit = session.objectFit;
        setPlaybackPosition(session.index);
        if (session.wasAnimating) toggleAnimation();

        const download = document.getElementById('videoDownload');
        if (blob) {
            if (videoDownloadUrl) URL.revokeObjectURL(videoDownloadUrl);
            videoDownloadUrl = URL.createObjectURL(blob);
            const extension = blob.type.startsWith('video/mp4') ? 'mp4' : 'webm';
            download.href = videoDownloadUrl;
            download.download = session.filename + '.' + extension;
            download.click();
        }
        document.getElementById('videoExportBtn').textContent = 'Export video';
        document.getElementById('videoExportProgress').hidden = true;
        const status = document.getElementById('videoExportStatus');
        setVideoExportStatus(message);
        if (document.getElementById('settingsPanel').classList.contains('visible')
            && document.getElementById('exportSettings').open) {
            status.scrollIntoView({ block: 'nearest' });
        }
        session.chunks.length = 0;
        session.canvas.width = session.canvas.height = 0;
    }

    function setupUI() {
        document.getElementById('videoExportBtn').addEventListener('click', startVideoExport);
        document.getElementById('videoResolution').addEventListener('change', event => {
            document.getElementById('videoCustomSize').hidden = event.target.value !== 'custom';
        });
        document.getElementById('videoCamera').addEventListener('change', updateVideoDurationEstimate);
        const videoViewList = document.getElementById('videoViewList');
        videoViewList.addEventListener('change', event => {
            if (event.target.classList.contains('video-step-view')) updateVideoPathControls();
            else updateVideoDurationEstimate();
        });
        videoViewList.addEventListener('input', event => {
            if (event.target.classList.contains('video-pause-seconds')) updateVideoDurationEstimate();
        });
        videoViewList.addEventListener('click', event => {
            const button = event.target.closest('[data-action]');
            if (!button || videoExport || videoPreview) return;
            const row = button.closest('.video-view-step');
            if (button.dataset.action === 'up') row.previousElementSibling?.before(row);
            if (button.dataset.action === 'down') row.nextElementSibling?.after(row);
            if (button.dataset.action === 'remove') row.remove();
            updateVideoPathControls();
        });
        document.getElementById('videoAddView').addEventListener('click', () => addVideoStep('view'));
        document.getElementById('videoAddPause').addEventListener('click', () => addVideoStep('pause'));
        document.getElementById('videoPreviewBtn').addEventListener('click', startVideoPreview);
        document.getElementById('videoPreviewStop').addEventListener('click', stopVideoPreview);
        document.addEventListener('keydown', event => {
            if (event.defaultPrevented || event.repeat || event.isComposing
                || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey
                || event.getModifierState?.('AltGraph')) return;
            if (event.key === 'Escape' && videoPreview) { event.preventDefault(); stopVideoPreview(); }
        });
        updateVideoPathControls();
        document.getElementById('videoTransition').addEventListener('input', updateVideoDurationEstimate);
        if (!getVideoMimeType()) {
            document.getElementById('videoExportBtn').disabled = true;
            setVideoExportStatus('Video export is unavailable in this browser.');
        }
        document.addEventListener('visibilitychange', () => {
            setVideoExportPaused(document.hidden);
            if (document.hidden) stopVideoPreview();
        });
        renderer.domElement.addEventListener('webglcontextlost', () => {
            cancelVideoExport('Export cancelled: the 3D view was interrupted.');
            stopVideoPreview();
        });
    }

    return {
        setupUI,
        get isBusy() { return Boolean(videoExport || videoPreview); },
        get isRecording() { return Boolean(videoExport); },
        get isPreviewing() { return Boolean(videoPreview); },
        getFramePlan: getCurrentVideoFramePlan,
        updateDurationEstimate: updateVideoDurationEstimate,
        drawLegend: drawVideoLegend,
        startPreview: startVideoPreview,
        stopPreview: stopVideoPreview,
        cancel: cancelVideoExport,
        setPaused: setVideoExportPaused,
        update() {
            if (videoExport) updateVideoExport();
            else if (videoPreview) updateVideoPreview();
        },
        captureFrame: captureVideoFrame
    };
}
