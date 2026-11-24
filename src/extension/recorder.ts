// Offscreen extension document. Only the worker sends frames, already scoped to the session.
const canvas = document.createElement('canvas');
const context = canvas.getContext('2d', { alpha: false })!;
let recorder: MediaRecorder | undefined;
let completed: Promise<Blob> | undefined;
let exported = false;

async function paint(data: string, first: boolean) {
  const jpeg = await (await fetch('data:image/jpeg;base64,' + data)).blob();
  const image = await createImageBitmap(jpeg);
  try {
    if (first) {
      const scale = Math.min(1, 1280 / image.width, 720 / image.height);
      canvas.width = Math.max(2, 2 * Math.round(image.width * scale / 2));
      canvas.height = Math.max(2, 2 * Math.round(image.height * scale / 2));
    }
    const fit = Math.min(canvas.width / image.width, canvas.height / image.height);
    const w = Math.round(image.width * fit), h = Math.round(image.height * fit);
    context.fillStyle = 'black';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
  } finally { image.close(); }
}

async function encode(type: string, data: string) {
  if (type === 'start') {
    await paint(data, true);
    const stream = canvas.captureStream(12);
    const rec = recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 1000000 });
    const parts: Blob[] = [];
    let size = 0;
    let firstFrame!: () => void;
    const ready = new Promise<void>(resolve => { firstFrame = resolve; });
    completed = new Promise((resolve, reject) => {
      rec.ondataavailable = event => {
        parts.push(event.data);
        size += event.data.size;
        if (event.data.size) firstFrame();
        if (size >= 16 * 1024 * 1024 && rec.state === 'recording') rec.stop();
      };
      rec.onerror = () => reject(new Error('Video encoding failed.'));
      rec.onstop = () => {
        for (const track of stream.getTracks()) track.stop();
        resolve(new Blob(parts, { type: 'video/webm' }));
      };
    });
    void completed.catch(() => {});
    rec.start(250);
    // An immediate pause/stop must still yield a playable clip. Keep submitting
    // the initial picture until the encoder has actually produced its first bytes.
    const redraw = setInterval(() => context.drawImage(canvas, 0, 0), 90);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([ready, new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('The video encoder did not start.')), 4000);
      })]);
    } finally { clearInterval(redraw); clearTimeout(timeout); }
  } else if (type === 'frame') {
    if (recorder?.state !== 'recording') return { ended: true };
    await paint(data, false);
  } else if (type === 'stop' && completed && !exported) {
    if (recorder?.state === 'recording') recorder.stop();
    const blob = await completed;
    const reader = new FileReader();
    const encoded = await new Promise<string>((resolve, reject) => {
      reader.onload = () => resolve((reader.result as string).split(',')[1]);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    exported = true;
    return { data: encoded };
  } else throw new Error('Unknown recorder request.');
  return {};
}

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (msg.target !== 'media-recorder' || sender.id !== chrome.runtime.id || sender.tab ||
      (sender.url && sender.url !== chrome.runtime.getURL('worker.js'))) return;
  void encode(msg.type, msg.data).then(respond, error => respond({ error: error.message }));
  return true;
});
