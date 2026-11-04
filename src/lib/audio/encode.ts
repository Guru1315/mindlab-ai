import { Mp3Encoder } from "@breezystack/lamejs";

/** Concatenates PCM segments with a short silence between them. */
export function concatPcm(segments: Int16Array[], sampleRate: number, gapMs = 250): Int16Array {
  const gap = Math.round((sampleRate * gapMs) / 1000);
  const total = segments.reduce((s, seg) => s + seg.length, 0) + gap * Math.max(0, segments.length - 1);
  const out = new Int16Array(total);
  let offset = 0;
  segments.forEach((seg, i) => {
    out.set(seg, offset);
    offset += seg.length + (i < segments.length - 1 ? gap : 0);
  });
  return out;
}

/** Encodes mono 16-bit PCM to MP3 (CBR). */
export function encodeMp3(pcm: Int16Array, sampleRate: number, kbps = 64): Uint8Array {
  const encoder = new Mp3Encoder(1, sampleRate, kbps);
  const blockSize = 1152 * 20;
  const parts: Uint8Array[] = [];
  for (let i = 0; i < pcm.length; i += blockSize) {
    const buf = encoder.encodeBuffer(pcm.subarray(i, i + blockSize));
    if (buf.length) parts.push(new Uint8Array(buf));
  }
  const tail = encoder.flush();
  if (tail.length) parts.push(new Uint8Array(tail));
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** Wraps mono 16-bit PCM in a WAV container. */
export function encodeWav(pcm: Int16Array, sampleRate: number): Uint8Array {
  const dataBytes = pcm.length * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < pcm.length; i++) buf.writeInt16LE(pcm[i], 44 + i * 2);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}
