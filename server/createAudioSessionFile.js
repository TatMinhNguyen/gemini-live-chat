'use strict';

const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');

ffmpeg.setFfmpegPath(ffmpegPath);

const wav = require('wav');
const { v4: uuidv4 } = require('uuid');

/**
 * Helper: đảm bảo thư mục tồn tại
 */
function ensureDirSync(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Helper: lấy path lưu file
 */
function getFilePath(fileName, folderPath) {
  ensureDirSync(folderPath);
  return path.join(folderPath, fileName);
}

/**
 * Thuần Node.js: tạo file audio session (WAV → MP3 → fileEntity)
 */
async function createAudioSessionFile({
  audioChunks,
  userId,
  baseOutputFileName,
  clientAudioFormat,
  storageFolder,
  storageRoot = path.join(__dirname, 'storage'),
}) {
  if (!audioChunks || audioChunks.length === 0) {
    throw new Error('Audio chunks are required');
  }
  if (!userId || !baseOutputFileName || !clientAudioFormat || !storageFolder) {
    throw new Error('Missing required parameters');
  }

  const wavFileName = `${baseOutputFileName}.wav`;
  const mp3FileName = `${baseOutputFileName}.mp3`;

  const targetFolderPath = path.join(storageRoot, storageFolder);
  const wavFilePath = getFilePath(wavFileName, targetFolderPath);
  const mp3FilePath = getFilePath(mp3FileName, targetFolderPath);

  try {
    // =========================
    // 1️⃣ Ghi file WAV
    // =========================
    const combinedBuffer = Buffer.concat(audioChunks.map(c => Buffer.from(c)));

    const fileStream = fs.createWriteStream(wavFilePath);
    const wavWriter = new wav.Writer({
      sampleRate: clientAudioFormat.sampleRate || 16000,
      channels: clientAudioFormat.channels || 1,
      bitDepth: clientAudioFormat.bitDepth || 16,
    });

    wavWriter.pipe(fileStream);
    wavWriter.write(combinedBuffer);
    wavWriter.end();

    await new Promise((resolve, reject) => {
      fileStream.on('finish', resolve);
      fileStream.on('error', reject);
    });

    // =========================
    // 2️⃣ WAV → MP3
    // =========================
    await new Promise((resolve, reject) => {
      ffmpeg(wavFilePath)
        .toFormat('mp3')
        .audioCodec('libmp3lame')
        .audioBitrate(128)
        .audioFrequency(16000)
        .audioChannels(1)
        .on('end', () => {
          fs.unlink(wavFilePath, () => {});
          resolve();
        })
        .on('error', reject)
        .save(mp3FilePath);
    });

    // =========================
    // 3️⃣ Fake DB entity (bạn thay bằng insert DB thật)
    // =========================
    const mp3Stat = fs.statSync(mp3FilePath);

    const fileEntity = {
      _id: uuidv4(),
      ownerId: userId,
      name: mp3FileName,
      displayName: mp3FileName,
      fileType: 'audio',
      mimetype: 'audio/mpeg',
      storageType: 'local_storage',
      storageLocation: storageFolder,
      size: mp3Stat.size,
      used: true,
      createdAt: new Date(),
    };

    return fileEntity;
  } catch (err) {
    if (fs.existsSync(wavFilePath)) fs.unlinkSync(wavFilePath);
    throw err;
  }
}

module.exports = {
  createAudioSessionFile,
};
