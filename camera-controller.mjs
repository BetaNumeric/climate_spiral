const CAMERA_RESET_DURATION_MS = 450;
const CAMERA_SNAP_DURATION_MS = 260;
const CAMERA_SNAP_ANGLE = 10 * Math.PI / 180;
const CAMERA_ROTATION_EPSILON = 0.1 * Math.PI / 180;
const DOUBLE_TAP_MAX_DELAY_MS = 500;
const TAP_MAX_DURATION_MS = 300;
const TAP_MAX_MOVEMENT_PX = 12;
const DOUBLE_TAP_MAX_DISTANCE_PX = 28;
const LAYOUT_PINCH_MIN_MOVEMENT_PX = 12;
const LAYOUT_PINCH_MIN_SCALE = 0.15;
const CAMERA_VIEWS = {
    top: { polar: 0, azimuth: 0 },
    front: { polar: Math.PI / 2, azimuth: 0 },
    right: { polar: Math.PI / 2, azimuth: Math.PI / 2 },
    left: { polar: Math.PI / 2, azimuth: -Math.PI / 2 },
    back: { polar: Math.PI / 2, azimuth: Math.PI }
};
const SIDE_VIEWS = ['front', 'right', 'back', 'left'];

export function createCameraController({ THREE, OrbitControls, canvas, getSceneState, isBusy, defaultDistance,
    onLayoutGesture = () => {} }) {
    const DEFAULT_ORTHOGRAPHIC_DISTANCE = defaultDistance;
    const defaultCameraQuaternion = getSceneState().orthographicCamera.quaternion.clone();
    let lastCameraResetTime = -Infinity;
    let lastCameraView = null;
    let cameraResetAnimation = null;

    function createOrbitControls(camera, target) {
        const nextControls = new OrbitControls(camera, canvas);
        const isFreeCamera = document.getElementById('freeCameraToggle')?.checked ?? false;

        nextControls.enableDamping = true;
        nextControls.dampingFactor = 0.05;
        nextControls.autoRotate = false;
        nextControls.maxPolarAngle = isFreeCamera ? Math.PI : Math.PI / 2;
        nextControls.enablePan = isFreeCamera;
        nextControls.target.copy(target);
        nextControls.update();

        const startDirection = new THREE.Vector3();
        const endDirection = new THREE.Vector3();
        let hasOrbitStart = false;
        nextControls.addEventListener('start', () => {
            startDirection.subVectors(nextControls.object.position, nextControls.target).normalize();
            hasOrbitStart = true;
        });
        nextControls.addEventListener('end', () => {
            if (!hasOrbitStart) return;
            hasOrbitStart = false;
            if (nextControls !== getSceneState().controls || isBusy() || cameraResetAnimation) return;
            endDirection.subVectors(nextControls.object.position, nextControls.target).normalize();
            if (startDirection.angleTo(endDirection) < CAMERA_ROTATION_EPSILON) return;
            const view = nearestCameraView(endDirection);
            if (view) requestAnimationFrame(() => {
                if (nextControls === getSceneState().controls && !isBusy() && !cameraResetAnimation) {
                    setCameraView(view, { preserveFraming: true, duration: CAMERA_SNAP_DURATION_MS });
                }
            });
        });

        return nextControls;
    }

    function nearestCameraView(direction) {
        let nearest = null;
        let nearestAngle = Infinity;
        for (const [view, { polar, azimuth }] of Object.entries(CAMERA_VIEWS)) {
            const targetDirection = new THREE.Vector3().setFromSphericalCoords(1, polar, azimuth);
            const angle = direction.angleTo(targetDirection);
            if (angle < nearestAngle) {
                nearest = view;
                nearestAngle = angle;
            }
        }
        return nearestAngle <= CAMERA_SNAP_ANGLE ? nearest : null;
    }

    function resetCameraView() {
        setCameraView('top');
    }

    function cycleSideView(step = 1, { fromTop = true } = {}) {
        if (isBusy()) return false;
        const { activeCamera, controls } = getSceneState();
        if (!activeCamera || !controls) return false;
        const current = new THREE.Spherical().setFromVector3(activeCamera.position.clone().sub(controls.target));
        // Repeated gestures continue from the destination even while a turn is in progress.
        const polar = cameraResetAnimation?.endPolar ?? current.phi;
        const azimuth = cameraResetAnimation
            ? cameraResetAnimation.startSpherical.theta + cameraResetAnimation.thetaDelta : current.theta;
        if (polar < Math.PI / 4 && !fromTop) return false;
        const next = (Math.round(azimuth / (Math.PI / 2)) + step + SIDE_VIEWS.length) % SIDE_VIEWS.length;
        setCameraView(polar < Math.PI / 4 ? 'front' : SIDE_VIEWS[next]);
        return true;
    }

    function setCameraView(view, { preserveFraming = false, duration = CAMERA_RESET_DURATION_MS } = {}) {
        if (!Object.hasOwn(CAMERA_VIEWS, view) || isBusy()) return;
        const { controls, activeCamera, perspectiveCamera, orthographicCamera, spiralHeight } = getSceneState();
        const now = performance.now();
        if (!controls || !activeCamera || (!preserveFraming && view === lastCameraView && now - lastCameraResetTime < 250)) return;
        lastCameraResetTime = now;
        lastCameraView = view;

        const camera = activeCamera;
        const controlsEnabled = cameraResetAnimation?.controlsEnabled ?? controls.enabled;
        const dampingEnabled = controls.enableDamping;
        const startPosition = camera.position.clone();
        const startTarget = controls.target.clone();
        const startZoom = camera.zoom;

        // Clear pending damping, then restore the current rendered view as the animation start.
        cameraResetAnimation = null;
        controls.enableDamping = false;
        controls.update();
        camera.position.copy(startPosition);
        controls.target.copy(startTarget);
        controls.update();
        controls.enableDamping = dampingEnabled;
        controls.enabled = false;

        let endDistance = DEFAULT_ORTHOGRAPHIC_DISTANCE;
        if (camera === perspectiveCamera) {
            const defaultVisibleHeight = orthographicCamera.top - orthographicCamera.bottom;
            const halfFov = THREE.MathUtils.degToRad(perspectiveCamera.fov / 2);
            endDistance = defaultVisibleHeight / (2 * Math.tan(halfFov));
        }

        const startSpherical = new THREE.Spherical().setFromVector3(
            startPosition.clone().sub(startTarget)
        );
        if (preserveFraming) endDistance = startSpherical.radius;
        const { polar: endPolar, azimuth: endAzimuth } = CAMERA_VIEWS[view];
        const thetaDelta = Math.atan2(
            Math.sin(endAzimuth - startSpherical.theta),
            Math.cos(endAzimuth - startSpherical.theta)
        );

        cameraResetAnimation = {
            camera,
            controlsEnabled,
            startTime: now,
            duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : duration,
            startTarget,
            endTarget: preserveFraming ? startTarget.clone() : new THREE.Vector3(0, spiralHeight / 2, 0),
            startZoom,
            endZoom: preserveFraming ? startZoom : 1,
            startSpherical,
            endDistance,
            endPolar,
            thetaDelta,
            currentSpherical: new THREE.Spherical(),
            currentOffset: new THREE.Vector3()
        };
        if (cameraResetAnimation.duration === 0) updateCameraResetAnimation();
    }

    function updateCameraResetAnimation() {
        const animation = cameraResetAnimation;
        if (!animation) return;
        const { controls, activeCamera } = getSceneState();

        if (activeCamera !== animation.camera) {
            controls.enabled = animation.controlsEnabled;
            cameraResetAnimation = null;
            controls.update();
            return;
        }

        const progress = animation.duration === 0 ? 1 : Math.min(
            (performance.now() - animation.startTime) / animation.duration,
            1
        );
        const eased = progress * progress * (3 - 2 * progress);

        controls.target.lerpVectors(animation.startTarget, animation.endTarget, eased);
        animation.currentSpherical.set(
            THREE.MathUtils.lerp(animation.startSpherical.radius, animation.endDistance, eased),
            THREE.MathUtils.lerp(animation.startSpherical.phi, animation.endPolar, eased),
            animation.startSpherical.theta + animation.thetaDelta * eased
        );
        animation.currentOffset.setFromSpherical(animation.currentSpherical);
        animation.camera.position.copy(controls.target).add(animation.currentOffset);
        animation.camera.zoom = THREE.MathUtils.lerp(animation.startZoom, animation.endZoom, eased);
        animation.camera.updateProjectionMatrix();
        controls.update();

        if (progress === 1) {
            if (animation.endPolar === 0) animation.camera.quaternion.copy(defaultCameraQuaternion);
            controls.enabled = animation.controlsEnabled;
            cameraResetAnimation = null;
        }
    }

    function setupCameraResetGestures(canvas) {
        const activeTouchPointers = new Map();
        let tapCandidate = null;
        let previousTap = null;
        let twoFingerCandidate = null;
        let previousTwoFingerTap = null;
        let rightClickCandidate = null;
        let previousRightClick = null;

        canvas.addEventListener('dblclick', (event) => {
            event.preventDefault();
            if (event.button === 0) resetCameraView();
        });

        document.addEventListener('keydown', (event) => {
            if (event.defaultPrevented || event.repeat || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey
                || event.target.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) return;
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                if (cycleSideView(event.key === 'ArrowLeft' ? -1 : 1, { fromTop: false })) event.preventDefault();
                return;
            }
            const view = { '1': 'top', '2': 'front', '3': 'right', '4': 'left', '5': 'back',
                ArrowUp: 'top', ArrowDown: 'front' }[event.key];
            if (!view || isBusy()) return;
            event.preventDefault();
            setCameraView(view);
        });

        canvas.addEventListener('pointerdown', (event) => {
            if (event.pointerType === 'mouse') {
                rightClickCandidate = event.button === 2 ? {
                    pointerId: event.pointerId, startTime: performance.now(),
                    startX: event.clientX, startY: event.clientY, moved: false
                } : null;
                if (event.button !== 2) previousRightClick = null;
            }
            if (event.pointerType !== 'touch') return;

            const now = performance.now();
            activeTouchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY, moved: false });
            if (activeTouchPointers.size > 1) {
                // Only a fresh pair qualifies; held fingers, pinches, and a third contact do not.
                if (activeTouchPointers.size === 2 && tapCandidate && !tapCandidate.moved
                    && now - tapCandidate.startTime <= TAP_MAX_DURATION_MS && !isBusy()) {
                    const points = [...activeTouchPointers.values()];
                    twoFingerCandidate = { startTime: tapCandidate.startTime,
                        x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
                } else {
                    twoFingerCandidate = null;
                    previousTwoFingerTap = null;
                }
                tapCandidate = null;
                previousTap = null;
                return;
            }

            tapCandidate = {
                pointerId: event.pointerId,
                startTime: now,
                startX: event.clientX,
                startY: event.clientY,
                moved: isBusy()
            };
        }, { passive: true });

        canvas.addEventListener('pointermove', (event) => {
            const touch = activeTouchPointers.get(event.pointerId);
            if (event.pointerType === 'touch' && touch
                && (isBusy() || Math.hypot(event.clientX - touch.x, event.clientY - touch.y) > TAP_MAX_MOVEMENT_PX)) {
                touch.moved = true;
                twoFingerCandidate = null;
                previousTwoFingerTap = null;
            }
            if (rightClickCandidate && event.pointerId === rightClickCandidate.pointerId
                && Math.hypot(event.clientX - rightClickCandidate.startX, event.clientY - rightClickCandidate.startY) > TAP_MAX_MOVEMENT_PX) {
                rightClickCandidate.moved = true;
            }
            if (!tapCandidate || event.pointerId !== tapCandidate.pointerId) return;
            const distance = Math.hypot(
                event.clientX - tapCandidate.startX,
                event.clientY - tapCandidate.startY
            );
            if (distance > TAP_MAX_MOVEMENT_PX) tapCandidate.moved = true;
        }, { passive: true });

        canvas.addEventListener('pointerup', (event) => {
            if (event.pointerType === 'mouse' && event.button === 2) {
                const now = performance.now();
                const isClick = rightClickCandidate && event.pointerId === rightClickCandidate.pointerId
                    && !rightClickCandidate.moved && now - rightClickCandidate.startTime <= TAP_MAX_DURATION_MS;
                if (isClick && previousRightClick && now - previousRightClick.time <= DOUBLE_TAP_MAX_DELAY_MS
                    && Math.hypot(event.clientX - previousRightClick.x, event.clientY - previousRightClick.y) <= DOUBLE_TAP_MAX_DISTANCE_PX) {
                    event.preventDefault();
                    previousRightClick = null;
                    cycleSideView();
                } else {
                    previousRightClick = isClick ? { time: now, x: event.clientX, y: event.clientY } : null;
                }
                rightClickCandidate = null;
                return;
            }
            if (event.pointerType !== 'touch') return;

            const touch = activeTouchPointers.get(event.pointerId);
            if (!touch) return;
            const involvedMultiplePointers = activeTouchPointers.size > 1;
            if (isBusy() || touch.moved
                || Math.hypot(event.clientX - touch.x, event.clientY - touch.y) > TAP_MAX_MOVEMENT_PX) {
                twoFingerCandidate = null;
                previousTwoFingerTap = null;
            }
            activeTouchPointers.delete(event.pointerId);
            if (twoFingerCandidate && activeTouchPointers.size === 0) {
                const now = performance.now();
                const tap = twoFingerCandidate;
                const isTap = now - tap.startTime <= TAP_MAX_DURATION_MS;
                const isDoubleTap = isTap && previousTwoFingerTap
                    && now - previousTwoFingerTap.time <= DOUBLE_TAP_MAX_DELAY_MS
                    && Math.hypot(tap.x - previousTwoFingerTap.x, tap.y - previousTwoFingerTap.y) <= DOUBLE_TAP_MAX_DISTANCE_PX;
                twoFingerCandidate = null;
                previousTwoFingerTap = isTap && !isDoubleTap ? { time: now, x: tap.x, y: tap.y } : null;
                if (isDoubleTap) {
                    event.preventDefault();
                    requestAnimationFrame(() => cycleSideView());
                }
            }
            if (
                involvedMultiplePointers ||
                !tapCandidate ||
                event.pointerId !== tapCandidate.pointerId
            ) {
                tapCandidate = null;
                return;
            }

            const now = performance.now();
            const duration = now - tapCandidate.startTime;
            const isTap = !isBusy() && !touch.moved && !tapCandidate.moved && duration <= TAP_MAX_DURATION_MS;
            previousTwoFingerTap = null;

            if (isTap) {
                const isDoubleTap = previousTap &&
                    now - previousTap.time <= DOUBLE_TAP_MAX_DELAY_MS &&
                    Math.hypot(event.clientX - previousTap.x, event.clientY - previousTap.y) <= DOUBLE_TAP_MAX_DISTANCE_PX;

                if (isDoubleTap) {
                    event.preventDefault();
                    previousTap = null;
                    requestAnimationFrame(resetCameraView);
                } else {
                    previousTap = { time: now, x: event.clientX, y: event.clientY };
                }
            } else {
                previousTap = null;
            }

            tapCandidate = null;
        }, { passive: false });

        canvas.addEventListener('pointercancel', (event) => {
            rightClickCandidate = null;
            previousRightClick = null;
            activeTouchPointers.delete(event.pointerId);
            tapCandidate = null;
            previousTap = null;
            twoFingerCandidate = null;
            previousTwoFingerTap = null;
        }, { passive: true });
    }

    function setupLayoutPinchGesture() {
        let pinch = null;
        const spread = touches => {
            const distance = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
            return (distance(touches[0], touches[1]) + distance(touches[1], touches[2])
                + distance(touches[2], touches[0])) / 3;
        };
        const isThreeFingers = event => event.touches.length === 3 && event.targetTouches.length === 3;

        canvas.addEventListener('touchstart', event => {
            pinch = isThreeFingers(event) && !isBusy() ? { spread: spread(event.touches), triggered: false } : null;
            if (pinch) event.preventDefault();
        }, { passive: false });
        canvas.addEventListener('touchmove', event => {
            if (!pinch) return;
            if (!isThreeFingers(event) || isBusy()) { pinch = null; return; }
            event.preventDefault();
            if (pinch.triggered) return;
            const change = spread(event.touches) - pinch.spread;
            if (Math.abs(change) < Math.max(LAYOUT_PINCH_MIN_MOVEMENT_PX, pinch.spread * LAYOUT_PINCH_MIN_SCALE)) return;
            pinch.triggered = true;
            onLayoutGesture(change > 0 ? 'graph' : 'spiral');
        }, { passive: false });
        const endPinch = () => { pinch = null; };
        canvas.addEventListener('touchend', endPinch, { passive: true });
        canvas.addEventListener('touchcancel', endPinch, { passive: true });
    }

    return {
        createControls: createOrbitControls,
        setupGestures() {
            setupCameraResetGestures(canvas);
            setupLayoutPinchGesture();
        },
        setView: setCameraView,
        update: updateCameraResetAnimation,
        get isAnimating() { return Boolean(cameraResetAnimation); },
        get controlsEnabled() { return cameraResetAnimation?.controlsEnabled ?? getSceneState().controls?.enabled; },
        cancelAnimation() {
            if (!cameraResetAnimation) return;
            getSceneState().controls.enabled = cameraResetAnimation.controlsEnabled;
            cameraResetAnimation = null;
        }
    };
}
