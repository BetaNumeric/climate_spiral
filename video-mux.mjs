import { Input, BlobSource, MP4, WEBM, EncodedPacketSink, Output, BufferTarget,
  Mp4OutputFormat, WebMOutputFormat, EncodedVideoPacketSource, EncodedPacket } from './vendor/mediabunny/mediabunny.min.mjs';

export async function finalizeVideo(blob, signal = new AbortController().signal, frameRate = 30) {
  signal.throwIfAborted();
  if (!Number.isInteger(frameRate) || frameRate <= 0) throw new Error('Frame rate must be a positive integer.');
  const mp4 = blob.type.startsWith('video/mp4');
  const input = new Input({ source: new BlobSource(blob), formats: [MP4, WEBM] });
  const target = new BufferTarget();
  const output = new Output({ target, format: mp4 ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat() });
  const abort = () => input.dispose();
  signal.addEventListener('abort', abort, { once: true });
  try {
    const track = await input.getPrimaryVideoTrack();
    const codec = await track?.getCodec();
    const decoderConfig = await track?.getDecoderConfig();
    if (!codec || !decoderConfig) throw new Error('The recording has no supported video track.');
    const source = new EncodedVideoPacketSource(codec);
    output.addVideoTrack(source);
    await output.start();
    const sink = new EncodedPacketSink(track);
    let count = 0;
    // Rebuild the seek index and replace real-time capture timestamps with an exact constant frame rate.
    for await (const packet of sink.packets(undefined, undefined, { verifyKeyPackets: true })) {
      signal.throwIfAborted();
      const fixedPacket = new EncodedPacket(packet.data, packet.type, count / frameRate, 1 / frameRate, count);
      await source.add(fixedPacket, count++ === 0 ? { decoderConfig } : undefined);
    }
    if (!count) throw new Error('The recording contains no video frames.');
    source.close();
    await output.finalize();
    signal.throwIfAborted();
    return new Blob([target.buffer], { type: mp4 ? 'video/mp4' : 'video/webm' });
  } catch (error) {
    if (output.state !== 'finalized') await output.cancel();
    throw error;
  } finally {
    signal.removeEventListener('abort', abort);
    input.dispose();
  }
}
