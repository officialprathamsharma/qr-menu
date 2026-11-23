/* ==========================================================
   Media processing in the owner's browser, before upload.
   - Photos: a full copy (≤1280 px) for the dish page and a small card copy (short side 320 px, ~15–25 KB)
     for the menu list, so guests download about 7× less.
   - Videos: re-encoded to a phone-sized MP4 (H.264, short side 480 px, 24 fps, ~1 Mbps, max 15 s,
     no sound), typically 1.5–3 MB. Uses the browser's built-in video encoder (WebCodecs) and mp4-muxer to
     package it. Free plans can't transcode on the server, so the small file is what gets stored.
   ========================================================== */

const MUXER = 'https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.1/+esm';

export async function canvasToBlob(canvas, quality = 0.82) {
  const webp = await new Promise((r) => canvas.toBlob(r, 'image/webp', quality));
  if (webp && webp.type === 'image/webp') return webp;
  return new Promise((r) => canvas.toBlob(r, 'image/jpeg', Math.min(0.9, quality + 0.03)));
}

function drawScaled(src, w, h, scale) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Photo file or <video>/<canvas> frame → { full, thumb } blobs. */
export async function makePhotoSet(source) {
  let bmp = source;
  let w;
  let h;
  if (source instanceof Blob) {
    bmp = await createImageBitmap(source);
    w = bmp.width; h = bmp.height;
  } else if (source instanceof HTMLVideoElement) {
    if (!source.videoWidth) throw new Error('Video is not loaded yet');
    w = source.videoWidth; h = source.videoHeight;
  } else { w = source.width; h = source.height; }
  const full = await canvasToBlob(drawScaled(bmp, w, h, Math.min(1, 1280 / Math.max(w, h))), 0.82);
  const thumb = await canvasToBlob(drawScaled(bmp, w, h, Math.min(1, 320 / Math.min(w, h))), 0.72);
  bmp.close?.();
  return { full, thumb };
}

/** Item videos are short loops: anything longer than this is refused at upload. */
export const MAX_VIDEO_SECONDS = 15;

/** Length of a video file in seconds (NaN if the browser can't read it). */
export function videoDuration(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = Object.assign(document.createElement('video'), { src: url, muted: true, preload: 'metadata' });
    const done = (n) => { URL.revokeObjectURL(url); resolve(n); };
    v.onloadedmetadata = () => {
      if (Number.isFinite(v.duration)) return done(v.duration);
      // Some MOV/WebM files report Infinity until you seek to the end.
      v.ontimeupdate = () => { v.ontimeupdate = null; done(v.duration); };
      v.currentTime = 1e9;
    };
    v.onerror = () => done(NaN);
    setTimeout(() => done(NaN), 8000);
  });
}

export const canCompressVideo = () => 'VideoEncoder' in window && 'VideoFrame' in window;

/**
 * Re-encode a video file for phones. Returns { blob, width, height, seconds }.
 * onProgress(0..1) is called as frames are encoded.
 */
export async function compressVideo(file, { shortSide = 480, maxSeconds = MAX_VIDEO_SECONDS, fps = 24, bitrate = 1_000_000, onProgress } = {}) {
  if (!canCompressVideo()) throw new Error('This browser cannot compress video. Use Chrome, Edge or Safari 16.4+.');
  const { Muxer, ArrayBufferTarget } = await import(MUXER);

  const url = URL.createObjectURL(file);
  const video = Object.assign(document.createElement('video'), { src: url, muted: true, playsInline: true, preload: 'auto' });
  try {
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () => reject(new Error("This video can't be read by the browser. Try exporting it as MP4 (H.264)."));
    });
    const scale = Math.min(1, shortSide / Math.min(video.videoWidth, video.videoHeight));
    const width = Math.round((video.videoWidth * scale) / 2) * 2; // encoders need even sizes
    const height = Math.round((video.videoHeight * scale) / 2) * 2;
    const seconds = Math.min(video.duration || maxSeconds, maxSeconds);

    // Pick an H.264 profile the browser can encode at this size (plays on every phone).
    let config = null;
    for (const codec of ['avc1.42E01F', 'avc1.4D401F', 'avc1.640028']) {
      const c = { codec, width, height, bitrate, framerate: fps, avc: { format: 'avc' } };
      // eslint-disable-next-line no-await-in-loop
      if ((await VideoEncoder.isConfigSupported(c).catch(() => ({}))).supported) { config = c; break; }
    }
    if (!config) throw new Error("This browser can't encode H.264 video. Use Chrome, Edge or Safari.");

    const target = new ArrayBufferTarget();
    const muxer = new Muxer({ target, video: { codec: 'avc', width, height, frameRate: fps }, fastStart: 'in-memory', firstTimestampBehavior: 'offset' });
    let failure = null;
    const encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { failure = e; } });
    encoder.configure(config);

    const canvas = Object.assign(document.createElement('canvas'), { width, height });
    const ctx = canvas.getContext('2d');
    let n = 0;
    const encodeAt = (mediaTime) => {
      ctx.drawImage(video, 0, 0, width, height);
      const frame = new VideoFrame(canvas, { timestamp: Math.round(mediaTime * 1e6), duration: Math.round(1e6 / fps) });
      encoder.encode(frame, { keyFrame: n % (fps * 2) === 0 });
      frame.close();
      n++;
      onProgress?.(Math.min(1, mediaTime / seconds));
    };

    if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
      // Play the clip once and grab frames as they're shown (takes about as long as the clip).
      // Browsers stop delivering frames to background tabs, so pause while the tab is hidden.
      const onVis = () => (document.hidden ? video.pause() : video.play().catch(() => {}));
      await new Promise((resolve, reject) => {
        let next = 0;
        const onFrame = (_now, meta) => {
          if (failure) return reject(failure);
          const t = meta.mediaTime;
          if (t >= seconds) { video.pause(); return resolve(); }
          if (t + 1e-3 >= next) { encodeAt(t); next = t + 1 / fps; }
          video.requestVideoFrameCallback(onFrame);
        };
        video.requestVideoFrameCallback(onFrame);
        video.onended = resolve;
        document.addEventListener('visibilitychange', onVis);
        if (!document.hidden) video.play().catch(reject);
      }).finally(() => document.removeEventListener('visibilitychange', onVis));
    } else {
      // Older browsers: step through the clip by seeking.
      for (let t = 0; t < seconds; t += 1 / fps) {
        video.currentTime = t;
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => { video.onseeked = r; });
        if (failure) throw failure;
        encodeAt(t);
      }
    }
    await encoder.flush();
    encoder.close();
    if (failure) throw failure;
    if (!n) throw new Error('No frames could be read from this video.');
    muxer.finalize();
    return { blob: new Blob([target.buffer], { type: 'video/mp4' }), width, height, seconds: Math.round(seconds) };
  } finally {
    video.pause();
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}
