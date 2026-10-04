import { monthlyGraphSamples, unrollPolar, isConnectedDataSegment } from './spiral-layout.mjs';
import { getMonthlySegments } from './sea-ice-data.mjs';

export function createSpiralGeometry(THREE) {
    function getNextMonthlyDecimalYear(decimalYear) {
        const absoluteMonth = Math.round(decimalYear * 12);
        return (absoluteMonth + 1) / 12;
    }

    function createDataTubeGeometry(points, colors, radius, radialSegments, metadata = null, flat = false) {
        const numPoints = points.length;
        const numSegments = numPoints - 1;
        const visibleSegments = Array.from({ length: numSegments }, (_, i) => !metadata
            || isConnectedDataSegment(metadata[i], metadata[i + 1], flat));

        const vertexCount = (numPoints * radialSegments) + 2;

        const geometry = new THREE.BufferGeometry();
        const positionArray = new Float32Array(vertexCount * 3);
        const colorArray = new Float32Array(vertexCount * 3);
        const indexArray = [];

        const P = new THREE.Vector3();
        const T = new THREE.Vector3();
        const N = new THREE.Vector3();
        const B = new THREE.Vector3();
        const T1 = new THREE.Vector3();
        const T2 = new THREE.Vector3();

        for (let i = 0; i < numPoints; i++) {
            P.copy(points[i]);
            let previous = i - 1, next = i + 1;
            while (previous > 0 && visibleSegments[previous] && P.distanceToSquared(points[previous]) < 1e-12) previous--;
            while (next < numPoints - 1 && visibleSegments[next - 1] && P.distanceToSquared(points[next]) < 1e-12) next++;

            if (visibleSegments[i] && (i === 0 || !visibleSegments[i - 1])) {
                T.subVectors(points[next], points[i]).normalize();
            } else if (i > 0 && visibleSegments[i - 1] && !visibleSegments[i]) {
                T.subVectors(points[i], points[previous]).normalize();
            } else if (visibleSegments[i] && visibleSegments[i - 1]) {
                T1.subVectors(points[i], points[previous]);
                T2.subVectors(points[next], points[i]);
                T.addVectors(T1, T2).normalize();
            } else {
                T.set(0, 1, 0);
            }

            if (flat) N.set(0, 0, -1);
            else N.set(P.x, 0, P.z);
            if (N.lengthSq() < 0.001) N.set(1, 0, 0);
            N.normalize();

            B.crossVectors(T, N).normalize();
            N.crossVectors(B, T).normalize();

            const baseIndex = i * radialSegments;
            const c = colors[i];

            for (let j = 0; j < radialSegments; j++) {
                const theta = (j / radialSegments) * Math.PI * 2;
                const sin = Math.sin(theta);
                const cos = Math.cos(theta);

                const px = P.x + radius * (cos * N.x + sin * B.x);
                const py = P.y + radius * (cos * N.y + sin * B.y);
                const pz = P.z + radius * (cos * N.z + sin * B.z);

                positionArray[baseIndex*3 + j*3]     = px;
                positionArray[baseIndex*3 + j*3 + 1] = py;
                positionArray[baseIndex*3 + j*3 + 2] = pz;

                colorArray[baseIndex*3 + j*3]     = c.r;
                colorArray[baseIndex*3 + j*3 + 1] = c.g;
                colorArray[baseIndex*3 + j*3 + 2] = c.b;
            }
        }

        const startCenterIdx = vertexCount - 2;
        positionArray[startCenterIdx*3]     = points[0].x;
        positionArray[startCenterIdx*3 + 1] = points[0].y;
        positionArray[startCenterIdx*3 + 2] = points[0].z;
        colorArray[startCenterIdx*3]     = colors[0].r;
        colorArray[startCenterIdx*3 + 1] = colors[0].g;
        colorArray[startCenterIdx*3 + 2] = colors[0].b;

        const endCenterIdx = vertexCount - 1;
        positionArray[endCenterIdx*3]     = points[numPoints-1].x;
        positionArray[endCenterIdx*3 + 1] = points[numPoints-1].y;
        positionArray[endCenterIdx*3 + 2] = points[numPoints-1].z;
        colorArray[endCenterIdx*3]     = colors[numPoints-1].r;
        colorArray[endCenterIdx*3 + 1] = colors[numPoints-1].g;
        colorArray[endCenterIdx*3 + 2] = colors[numPoints-1].b;

        for (let j = 0; j < radialSegments; j++) {
            const i = j;
            const nextI = (j + 1) % radialSegments;
            indexArray.push(startCenterIdx, nextI, i);
        }

        // Counterclockwise winding gives outward-facing body normals.
        for (let i = 0; i < numSegments; i++) {
            for (let j = 0; j < radialSegments; j++) {
                const nextJ = (j + 1) % radialSegments;

                const a = i * radialSegments + j;
                const b = i * radialSegments + nextJ;
                const c = (i + 1) * radialSegments + nextJ;
                const d = (i + 1) * radialSegments + j;

                if (visibleSegments[i]) {
                    indexArray.push(a, b, d);
                    indexArray.push(b, c, d);
                } else {
                    // Cap real gap endpoints; keep degenerate slots so timeline indices stay stable.
                    if (!metadata[i].missing) indexArray.push(i * radialSegments, a, b);
                    else indexArray.push(a, a, a);
                    if (!metadata[i + 1].missing) indexArray.push((i + 1) * radialSegments, c, d);
                    else indexArray.push(d, d, d);
                }
            }
        }

        // End Cap Indices (Triangle Fan)
        // Center -> i -> nextI produces Forward Normal (Out of tube end)
        const lastRingStart = (numPoints - 1) * radialSegments;
        for (let j = 0; j < radialSegments; j++) {
            const i = lastRingStart + j;
            const nextI = lastRingStart + ((j + 1) % radialSegments);
            indexArray.push(endCenterIdx, i, nextI);
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positionArray, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colorArray, 3));
        // January has two rings for unwrapping. Weld them in the spiral so both sides
        // contribute to the same surface normals, without changing timeline slots.
        const ringSources = Uint32Array.from({ length: numPoints }, (_, i) => i);
        if (!flat) {
            for (let i = 1; i < numPoints; i++) {
                if (!visibleSegments[i - 1] || !points[i].equals(points[i - 1])) continue;
                ringSources[i] = ringSources[i - 1];
                const source = ringSources[i] * radialSegments * 3;
                positionArray.copyWithin(i * radialSegments * 3, source, source + radialSegments * 3);
            }
            for (let i = 0; i < indexArray.length; i++) {
                const vertex = indexArray[i], ring = Math.floor(vertex / radialSegments);
                if (ring < numPoints) indexArray[i] = ringSources[ring] * radialSegments + vertex % radialSegments;
            }
        }
        geometry.setIndex(indexArray);
        geometry.computeVertexNormals();
        // Keep the unused copies ready to separate smoothly during the layout morph.
        const normals = geometry.attributes.normal.array;
        for (let i = 1; i < numPoints; i++) {
            if (ringSources[i] === i) continue;
            const source = ringSources[i] * radialSegments * 3;
            normals.copyWithin(i * radialSegments * 3, source, source + radialSegments * 3);
        }

        return geometry;
    }

    function createMonthlyGraph(metadata, samplesPerMonth, smooth, { layout, originYear, heightPerYear, radiusAtValue }) {
        const plan = monthlyGraphSamples(metadata.map(point => point.decimalYear), samplesPerMonth);
        const graphPoint = ({ decimalYear, anomaly }, year) => new THREE.Vector3(
                layout.width * (decimalYear - year - 0.5),
                (decimalYear - originYear) * heightPerYear,
                layout.center - radiusAtValue(anomaly)
            );
        const curves = plan.strips.map(strip => strip.end > strip.start
            ? new THREE.CatmullRomCurve3(metadata.slice(strip.start, strip.end + 1)
                .map(point => graphPoint(point, strip.year)), false, 'centripetal') : null);
        const points = [], resultMetadata = [];
        for (const sample of plan.samples) {
            const a = Math.floor(sample.sourceIndex / samplesPerMonth);
            const curve = curves[sample.strip];
            const point = smooth && curve && !sample.missing ? curve.getPoint(sample.t)
                : graphPoint(metadata[a], sample.year);
            if (!sample.missing) {
                point.x = layout.width * (sample.phase - 0.5);
                point.y = (sample.year + sample.phase - originYear) * heightPerYear;
            }
            points.push(point);
            resultMetadata.push({ decimalYear: sample.year + sample.phase, stripYear: sample.year, missing: sample.missing });
        }
        return { ...plan, points, metadata: resultMetadata };
    }

    function createDataLineGeometry(tubeGeometry, sourceMetadata, graphMetadata, radialSegments) {
        const geometry = new THREE.BufferGeometry();
        // At zero radius each tube ring is one point. Share its morph and highlight buffers.
        geometry.setAttribute('position', tubeGeometry.attributes.position);
        geometry.setAttribute('color', tubeGeometry.attributes.color);
        const indices = (metadata, splitYears) => {
            const result = [];
            for (let i = 0; i < graphMetadata.length - 1; i++) {
                const connected = !metadata || isConnectedDataSegment(metadata[i], metadata[i + 1], splitYears);
                const start = i * radialSegments;
                result.push(start, connected ? start + radialSegments : start);
            }
            return new Uint32Array(result);
        };
        geometry.layoutIndices = {
            source: indices(sourceMetadata, false), target: indices(graphMetadata, true)
        };
        geometry.setIndex(new THREE.BufferAttribute(geometry.layoutIndices.source.slice(), 1));
        return geometry;
    }

    function prepareLayoutMorph(geometry, graphGeometry, phaseAtVertex, { layout, radialSegments }) {
        const source = geometry.attributes.position.array.slice();
        const target = graphGeometry.attributes.position.array.slice();
        const groups = [];
        const ringSize = geometry.parameters ? geometry.parameters.radialSegments + 1 : radialSegments;
        const point = {};
        for (let vertex = 0; vertex < source.length / 3;) {
            const count = vertex + ringSize <= source.length / 3 ? ringSize : 1;
            const unique = geometry.parameters ? count - 1 : count;
            const from = [0, 0, 0], to = [0, 0, 0];
            for (let j = 0; j < unique; j++) {
                for (let axis = 0; axis < 3; axis++) {
                    from[axis] += source[(vertex + j) * 3 + axis] / unique;
                    to[axis] += target[(vertex + j) * 3 + axis] / unique;
                }
            }
            const radius = Math.hypot(from[0], from[2]);
            const angle = Math.atan2(from[0], -from[2]) / (Math.PI * 2);
            const phase = angle + Math.round(phaseAtVertex(vertex) - angle);
            unrollPolar(radius, phase, 1, layout, point);
            groups.push({ start: vertex * 3, end: (vertex + count) * 3, from, to, radius, phase,
                dx: to[0] - point.x, dz: to[2] - point.z, position: [0, 0, 0] });
            vertex += count;
        }
        // Keep render-only buffers outside userData so GLTF doesn't serialize them.
        geometry.layoutMorph = {
            source, target, groups,
            sourceNormals: geometry.attributes.normal.array.slice(),
            targetNormals: graphGeometry.attributes.normal.array.slice(),
            sourceIndex: geometry.index.array.slice(), targetIndex: graphGeometry.index.array.slice(),
            graphTopology: false,
        };
        geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
        geometry.attributes.normal.setUsage(THREE.DynamicDrawUsage);
    }

    function morphGeometry(geometry, bend, { layout, frame, height }) {
        const morph = geometry.layoutMorph;
        const position = geometry.attributes.position;
        if (bend === 0 || bend === 1) {
            position.array.set(bend === 0 ? morph.source : morph.target);
            geometry.attributes.normal.array.set(bend === 0 ? morph.sourceNormals : morph.targetNormals);
            geometry.attributes.normal.needsUpdate = true;
        } else {
            const point = {};
            const normal = geometry.attributes.normal.array;
            const correction = bend * bend;
            const weight = 1 - correction;
            const { source, target, sourceNormals, targetNormals } = morph;
            // Bend each cross-section once; rotate and blend its cached normals instead of rebuilding every triangle.
            for (const group of morph.groups) {
                unrollPolar(group.radius, group.phase, bend, layout, point);
                const center = group.position;
                center[0] = point.x + correction * group.dx + frame.x;
                center[1] = THREE.MathUtils.lerp(group.from[1], group.to[1], bend);
                center[2] = point.z + correction * group.dz + frame.z;
                const angle = group.phase * Math.PI * 2 * bend, cos = Math.cos(angle), sin = Math.sin(angle);
                for (let i = group.start; i < group.end; i += 3) {
                    const x = source[i] - group.from[0], z = source[i + 2] - group.from[2];
                    position.array[i] = center[0] + weight * (x * cos + z * sin) + correction * (target[i] - group.to[0]);
                    position.array[i + 1] = center[1] + weight * (source[i + 1] - group.from[1]) + correction * (target[i + 1] - group.to[1]);
                    position.array[i + 2] = center[2] + weight * (z * cos - x * sin) + correction * (target[i + 2] - group.to[2]);
                    const nx = weight * (sourceNormals[i] * cos + sourceNormals[i + 2] * sin) + correction * targetNormals[i];
                    const ny = weight * sourceNormals[i + 1] + correction * targetNormals[i + 1];
                    const nz = weight * (sourceNormals[i + 2] * cos - sourceNormals[i] * sin) + correction * targetNormals[i + 2];
                    const length = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
                    normal[i] = nx / length; normal[i + 1] = ny / length; normal[i + 2] = nz / length;
                }
            }
            geometry.attributes.normal.needsUpdate = true;
        }
        position.needsUpdate = true;
        if (bend === 0 || bend === 1) geometry.computeBoundingSphere();
        else {
            geometry.boundingSphere ??= new THREE.Sphere();
            geometry.boundingSphere.center.set(0, height / 2, 0);
            geometry.boundingSphere.radius = Math.hypot(layout.width + 2 * layout.maxRadius, height / 2 + 4);
        }
    }

    function morphPoint(source, target, phase, bend, result, { layout, frame }) {
        if (bend === 0 || bend === 1) return result.copy(bend === 0 ? source : target);
        const radius = Math.hypot(source.x, source.z);
        const angle = Math.atan2(source.x, -source.z) / (Math.PI * 2);
        phase = angle + Math.round(phase - angle);
        const point = unrollPolar(radius, phase, bend, layout);
        const flat = unrollPolar(radius, phase, 1, layout);
        return result.set(point.x + bend * bend * (target.x - flat.x) + frame.x,
            THREE.MathUtils.lerp(source.y, target.y, bend),
            point.z + bend * bend * (target.z - flat.z) + frame.z);
    }

    function createSpiralBuffers(rawPoints, rawColors, rawMetaData, { smooth, preserveMonthlyGaps, pointAt,
        layout, originYear, heightPerYear, radiusAtValue, tubeRadius, radialSegments }) {
        let finalPoints = [];
        let finalColors = [];
        let finalMetaData = [];
        let pointsPerObservation = 1;

        if (smooth) {
            const segments = preserveMonthlyGaps
                ? getMonthlySegments(rawMetaData.map(point => point.decimalYear))
                : [{ start: 0, end: rawPoints.length - 1 }];
            const curves = segments.map(segment => {
                const lastMeta = rawMetaData[segment.end];
                // Rendering-only persistence boundary; never sample the ghost month.
                const ghostPoint = pointAt(getNextMonthlyDecimalYear(lastMeta.decimalYear), lastMeta.anomaly);
                const curve = new THREE.CatmullRomCurve3([...rawPoints.slice(segment.start, segment.end + 1), ghostPoint]);
                curve.curveType = 'centripetal';
                return { ...segment, curve };
            });
            let curveIndex = 0;

            pointsPerObservation = 6;
            const finalPointCount = (rawPoints.length - 1) * pointsPerObservation + 1;

            for (let i = 0; i < finalPointCount; i++) {
                const floatIdx = i / pointsPerObservation;
                const idxA = Math.floor(floatIdx);
                const idxB = Math.min(idxA + 1, rawPoints.length - 1);
                const alpha = floatIdx - idxA;
                while (curveIndex < curves.length - 1 && idxA > curves[curveIndex].end) curveIndex++;
                const segment = curves[curveIndex];
                const missing = floatIdx > segment.end;
                finalPoints.push(missing ? rawPoints[idxA].clone()
                    : segment.curve.getPoint((floatIdx - segment.start) / (segment.end - segment.start + 1)));

                finalColors.push(new THREE.Color().lerpColors(rawColors[idxA], rawColors[idxB], alpha));

                const yearA = rawMetaData[idxA].decimalYear;
                const yearB = rawMetaData[idxB].decimalYear;
                const interpYear = yearA + (yearB - yearA) * alpha;

                const valA = rawMetaData[idxA].anomaly;
                const valB = rawMetaData[idxB].anomaly;
                const interpVal = valA + (valB - valA) * alpha;

                const displayA = rawMetaData[idxA].displayValue;
                const displayB = rawMetaData[idxB].displayValue;
                const interpDisplay = displayA + (displayB - displayA) * alpha;

                finalMetaData.push({
                    decimalYear: interpYear,
                    anomaly: interpVal,
                    displayValue: interpDisplay,
                    missing
                });
            }

        } else {
            finalPoints = rawPoints;
            finalColors = rawColors;
            finalMetaData = rawMetaData;
        }

        const graphData = createMonthlyGraph(rawMetaData, pointsPerObservation, smooth, { layout, originYear, heightPerYear, radiusAtValue });
        finalPoints = graphData.samples.map(sample => finalPoints[sample.sourceIndex]);
        finalColors = graphData.samples.map(sample => finalColors[sample.sourceIndex]);
        finalMetaData = graphData.samples.map(sample => finalMetaData[sample.sourceIndex]);
        const graphGeometry = createDataTubeGeometry(graphData.points, finalColors,
            tubeRadius, radialSegments, graphData.metadata, true);

        const geometry = createDataTubeGeometry(finalPoints, finalColors, tubeRadius, radialSegments,
            preserveMonthlyGaps ? finalMetaData : null);
        prepareLayoutMorph(geometry, graphGeometry, vertex => {
            const point = vertex >= finalPoints.length * radialSegments
                ? (vertex === finalPoints.length * radialSegments ? 0 : finalPoints.length - 1)
                : Math.floor(vertex / radialSegments);
            return graphData.samples[point].phase;
        }, { layout, radialSegments });
        graphGeometry.dispose();

        const data = finalPoints.map((p, i) => ({
            point: p.clone(),
            spiralPoint: p.clone(),
            graphPoint: graphData.points[i],
            phase: graphData.samples[i].phase,
            stripYear: graphData.samples[i].year,
            spiralMissing: finalMetaData[i].missing,
            graphMissing: graphData.metadata[i].missing,
            color: finalColors[i],
            decimalYear: finalMetaData[i].decimalYear,
            anomaly: finalMetaData[i].anomaly,
            displayValue: finalMetaData[i].displayValue,
            missing: finalMetaData[i].missing
        }));
        const lineGeometry = tubeRadius === 0 ? createDataLineGeometry(geometry,
            preserveMonthlyGaps ? finalMetaData : null, graphData.metadata, radialSegments) : null;
        const totalIndices = (finalPoints.length - 1) * radialSegments * 6;
        const timelineStops = graphData.observationIndices.map(index => index * radialSegments * 6);
        return { geometry, lineGeometry, data, totalIndices, timelineStops };
    }

    return { createDataTubeGeometry, createSpiralBuffers, prepareLayoutMorph, morphGeometry, morphPoint };
}
