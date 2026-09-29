import test from 'node:test';
import assert from 'node:assert/strict';
import { finalizeVideo } from '../video-mux.mjs';
import { Input, BlobSource, MP4, Output, BufferTarget, Mp4OutputFormat,
  EncodedVideoPacketSource, EncodedPacket, EncodedPacketSink } from '../vendor/mediabunny/mediabunny.min.mjs';

// A 32px black keyframe generated with Chrome's H.264 encoder; no external media fixture.
const frame = Uint8Array.from(Buffer.from('AAAAEWW4AAQJ///4eigACCf5OuvA', 'base64'));
const decoderConfig = {
  codec: 'avc1.42001f', codedWidth: 32, codedHeight: 32,
  description: Uint8Array.from(Buffer.from('AULQC//hABBnQtALjGiUmoCGgIPCIRqAAQAEaM48gA==', 'base64')),
};

async function recording(timestamps = [0, 0.5, 1, 1.5]) {
  const target = new BufferTarget();
  const output = new Output({ target, format: new Mp4OutputFormat({ fastStart: 'fragmented', minimumFragmentDuration: 0.5 }) });
  const source = new EncodedVideoPacketSource('avc');
  output.addVideoTrack(source);
  await output.start();
  for (const timestamp of timestamps) {
    await source.add(new EncodedPacket(frame, 'key', timestamp, 0.02 + timestamp / 100), { decoderConfig });
  }
  source.close();
  await output.finalize();
  return new Blob([target.buffer], { type: 'video/mp4' });
}

test('remuxing builds a regular indexed MP4 with exact constant-rate timestamps', async () => {
  const blob = await finalizeVideo(await recording([0, 0.031, 0.068, 0.102]));
  assert.equal(blob.type, 'video/mp4');
  const input = new Input({ source: new BlobSource(blob), formats: [MP4] });
  try {
    const track = await input.getPrimaryVideoTrack();
    const sink = new EncodedPacketSink(track);
    const timestamps = [];
    for await (const packet of sink.packets(undefined, undefined, { verifyKeyPackets: true })) {
      assert.deepEqual(packet.data, frame);
      assert.equal(packet.type, 'key');
      assert.ok(Math.abs(packet.duration - 1 / 30) < 1e-9);
      timestamps.push(packet.timestamp);
    }
    assert.deepEqual(timestamps, [0, 1 / 30, 2 / 30, 3 / 30]);
    assert.ok(Math.abs(await input.computeDuration() - 4 / 30) < 1e-9);
    assert.equal((await sink.getKeyPacket(0.08, { verifyKeyPackets: true })).timestamp, 2 / 30);
    const metrics = await track.computeFrameRateMetrics({ targetPacketCount: 16 });
    assert.equal(metrics.bestGuessFrameRate, 30);
    const config = await track.getDecoderConfig();
    assert.equal(config.codedWidth, 32);
    assert.equal(config.codedHeight, 32);
    // Top-level box structure must be a finalized file, not a collection of fragments.
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const view = new DataView(bytes.buffer);
    const boxes = [];
    for (let offset = 0; offset < bytes.length;) {
      const size = view.getUint32(offset);
      assert.ok(size >= 8);
      boxes.push(new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8)));
      offset += size;
    }
    assert.ok(boxes.includes('moov') && boxes.includes('mdat'));
    assert.ok(boxes.indexOf('moov') < boxes.indexOf('mdat'));
    assert.ok(!boxes.includes('moof'));
  } finally {
    input.dispose();
  }
});

test('finalization rejects malformed recordings and honors cancellation', async () => {
  await assert.rejects(finalizeVideo(new Blob(['invalid'], { type: 'video/mp4' })));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(finalizeVideo(await recording(), controller.signal), { name: 'AbortError' });
  const pendingController = new AbortController();
  const pending = finalizeVideo(await recording(), pendingController.signal);
  pendingController.abort();
  await assert.rejects(pending);
});
