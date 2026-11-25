'use strict';
// The hidden recording window: the screen as a video stream, encoded (H.264 in MP4 where the
// PC can, which graphics cards encode themselves and so costs the game least; otherwise WebM),
// sent to the main process in pieces every second. See src/recorder.js.
let recorder = null;
let stream = null;
let sending = Promise.resolve(); // pieces go out one after another, in order

rec.onStart(async (o) => {
  try {
    // The desktop source picked by the main process; the size and rate keep the file small.
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: o.sourceId, maxWidth: o.width, maxHeight: o.height, maxFrameRate: o.fps } },
    });
    const mime = ['video/mp4;codecs=avc1.64002A', 'video/mp4;codecs=avc1', 'video/webm;codecs=h264', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
      .find((m) => MediaRecorder.isTypeSupported(m)) || '';
    recorder = new MediaRecorder(stream, { mimeType: mime || undefined, videoBitsPerSecond: o.bitrate });
    recorder.ondataavailable = (e) => {
      if (!e.data || !e.data.size) return;
      sending = sending.then(async () => rec.chunk(new Uint8Array(await e.data.arrayBuffer())));
    };
    recorder.onstop = () => {
      sending.then(() => rec.stopped());
      for (const t of stream.getTracks()) t.stop();
    };
    // The moment the video's first frame is taken, on the PC's clock to a fraction of a
    // millisecond: every key and click in the recording is timed from it.
    const begun = new Promise((resolve) => { recorder.onstart = () => resolve(performance.timeOrigin + performance.now()); });
    recorder.start(1000);
    const at = await begun;
    const s = stream.getVideoTracks()[0].getSettings();
    rec.started({ mime: recorder.mimeType, width: s.width || o.width, height: s.height || o.height, fps: s.frameRate || o.fps, at });
  } catch (e) {
    rec.failed(`The screen could not be recorded: ${e.message || e}`);
  }
});

rec.onStop(() => {
  if (recorder && recorder.state !== 'inactive') recorder.stop();
  else rec.stopped();
});
