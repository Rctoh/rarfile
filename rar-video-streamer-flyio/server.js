const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');
const mime = require('mime');
const fetch = require('node-fetch');
const { pipeline } = require('stream');
const { promisify } = require('util');
const streamPipeline = promisify(pipeline);
const http = require('http');
const https = require('https');
const { URL } = require('url');

const app = express();
const PORT = process.env.PORT || 3000;

const UPLOADS_DIR = path.join(__dirname, 'uploads');
const EXTRACTED_DIR = path.join(__dirname, 'extracted');

fs.ensureDirSync(UPLOADS_DIR);
fs.ensureDirSync(EXTRACTED_DIR);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

async function downloadFile(fileUrl, outputPath) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(fileUrl);
    const protocol = urlObj.protocol === 'https:' ? https : http;

    protocol.get(fileUrl, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`Download failed: ${res.statusCode}`));
      }
      const fileStream = fs.createWriteStream(outputPath);
      res.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close(resolve);
      });

      fileStream.on('error', (err) => {
        fs.unlink(outputPath, () => reject(err));
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

async function extractRar(rarPath, extractDir) {
  await fs.ensureDir(extractDir);
  return new Promise((resolve, reject) => {
    const unrar = spawn('unrar', ['x', '-o+', rarPath, extractDir]);
    unrar.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error('Unrar failed with code ' + code));
    });
  });
}

app.post('/fetch', async (req, res) => {
  const { url } = req.body;
  if (!url || !url.endsWith('.rar')) {
    return res.status(400).send('Invalid or missing .rar URL.');
  }

  const filename = `${Date.now()}-${path.basename(new URL(url).pathname)}`;
  const rarPath = path.join(UPLOADS_DIR, filename);
  const extractDir = path.join(EXTRACTED_DIR, path.basename(filename, '.rar'));

  try {
    await downloadFile(url, rarPath);
    await extractRar(rarPath, extractDir);

    const files = await fs.readdir(extractDir);
    const videoFiles = files.filter(f => f.match(/\.(mp4|mkv|webm|avi)$/i));

    if (videoFiles.length === 0) {
      return res.status(404).send('No video files found in archive.');
    }

    res.json({
      message: 'Download and extraction successful.',
      stream_url: `/stream/${path.basename(extractDir)}/${encodeURIComponent(videoFiles[0])}`
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to download or extract RAR file: ' + err.message);
  }
});

app.get('/stream/:folder/:filename', (req, res) => {
  const filePath = path.join(EXTRACTED_DIR, req.params.folder, req.params.filename);
  if (!fs.existsSync(filePath)) return res.sendStatus(404);

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;
  const contentType = mime.getType(filePath) || 'application/octet-stream';

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = end - start + 1;
    const stream = fs.createReadStream(filePath, { start, end });

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': contentType,
    });

    stream.pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': contentType,
    });
    fs.createReadStream(filePath).pipe(res);
  }
});

// Cleanup old extracted files every 30 mins
setInterval(async () => {
  const now = Date.now();
  const folders = await fs.readdir(EXTRACTED_DIR);
  for (const folder of folders) {
    const fullPath = path.join(EXTRACTED_DIR, folder);
    const stat = await fs.stat(fullPath);
    if (now - stat.ctimeMs > 60 * 60 * 1000) { // older than 1 hour
      await fs.remove(fullPath);
    }
  }
}, 30 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
