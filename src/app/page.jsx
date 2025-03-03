"use client";

import { useState, useRef } from "react";
import axios from "axios";
import WaveSurfer from "wavesurfer.js";

export default function Home() {
  const [transcription, setTranscription] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [audioUrl, setAudioUrl] = useState(null);
  const [cleanedAudioUrl, setCleanedAudioUrl] = useState(null);
  const [translation, setTranslation] = useState("");
  const waveformRef = useRef(null);
  const wavesurferRef = useRef(null);
  const cleanedWaveformRef = useRef(null);
  const cleanedWavesurferRef = useRef(null);

  const initializeWaveSurfer = async (audioBlob, ref, containerRef) => {
    if (ref.current) {
      ref.current.destroy();
    }

    ref.current = WaveSurfer.create({
      container: containerRef.current,
      waveColor: "#4a9eff",
      progressColor: "#1e3a8a",
      height: 100,
      normalize: true,
      filters: [
        {
          type: "lowpass",
          frequency: 16000,
        },
        {
          type: "highpass",
          frequency: 80,
        },
      ],
    });

    const blobUrl = URL.createObjectURL(audioBlob);
    await ref.current.load(blobUrl);
    return blobUrl;
  };

  const cleanAudio = async (audioBlob) => {
    const audioContext = new (window.AudioContext ||
      window.webkitAudioContext)();

    const arrayBuffer = await audioBlob.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;

    const noiseGate = audioContext.createDynamicsCompressor();
    noiseGate.threshold.value = -90;
    noiseGate.knee.value = 40;
    noiseGate.ratio.value = 1.05;
    noiseGate.attack.value = 0.05;
    noiseGate.release.value = 0.5;

    const highShelf = audioContext.createBiquadFilter();
    highShelf.type = "highshelf";
    highShelf.frequency.value = 12000;
    highShelf.gain.value = -0.5;

    const compressor = audioContext.createDynamicsCompressor();
    compressor.threshold.value = -50;
    compressor.knee.value = 40;
    compressor.ratio.value = 1.1;
    compressor.attack.value = 0.05;
    compressor.release.value = 0.5;

    const processedBuffer = await new Promise((resolve) => {
      const offlineContext = new OfflineAudioContext(
        audioBuffer.numberOfChannels,
        audioBuffer.length,
        audioBuffer.sampleRate
      );

      const offlineSource = offlineContext.createBufferSource();
      offlineSource.buffer = audioBuffer;

      const offlineNoiseGate = offlineContext.createDynamicsCompressor();
      const offlineHighShelf = offlineContext.createBiquadFilter();
      const offlineCompressor = offlineContext.createDynamicsCompressor();

      Object.assign(offlineNoiseGate, noiseGate);
      Object.assign(offlineHighShelf, highShelf);
      Object.assign(offlineCompressor, compressor);

      offlineSource.connect(offlineNoiseGate);
      offlineNoiseGate.connect(offlineHighShelf);
      offlineHighShelf.connect(offlineCompressor);
      offlineCompressor.connect(offlineContext.destination);

      offlineSource.start();

      offlineContext.startRendering().then(resolve);
    });

    const processedWav = audioBufferToWav(processedBuffer);
    return new Blob([processedWav], { type: "audio/wav" });
  };

  const audioBufferToWav = (buffer) => {
    const numOfChan = buffer.numberOfChannels;
    const length = buffer.length * numOfChan * 2;
    const result = new Int16Array(length);
    let offset = 0;
    const lng = buffer.length;

    for (let i = 0; i < lng; i++) {
      for (let channel = 0; channel < numOfChan; channel++) {
        const sample = Math.max(
          -1,
          Math.min(1, buffer.getChannelData(channel)[i])
        );
        result[offset] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
        offset++;
      }
    }

    const buffer1 = new ArrayBuffer(44 + result.length * 2);
    const view = new DataView(buffer1);

    writeString(view, 0, "RIFF");
    view.setUint32(4, 36 + result.length * 2, true);
    writeString(view, 8, "WAVE");
    writeString(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numOfChan, true);
    view.setUint32(24, buffer.sampleRate, true);
    view.setUint32(28, buffer.sampleRate * 2 * numOfChan, true);
    view.setUint16(32, numOfChan * 2, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, "data");
    view.setUint32(40, result.length * 2, true);

    const length2 = result.length;
    const index = 44;
    for (let i = 0; i < length2; i++) {
      view.setInt16(index + i * 2, result[i], true);
    }

    return buffer1;
  };

  const writeString = (view, offset, string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  const callChatGPTForTranslation = async (text) => {
    try {
      const response = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: "gpt-3.5-turbo",
          messages: [
            { role: "system", content: "You are a helpful assistant." },
            {
              role: "user",
              content: `Translate the following text to English: ${text}`,
            },
          ],
        },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.NEXT_PUBLIC_OPENAI_API_KEY}`,
          },
        }
      );

      if (response.status !== 200) {
        throw new Error("Failed to get translation from ChatGPT");
      }

      const translatedText = response.data.choices[0].message.content;
      setTranslation(translatedText);
    } catch (error) {
      alert("Error getting translation: " + error.message);
      console.error(error);
    }
  };

  const handleTranscribe = async () => {
    const fileInput = document.getElementById("audioFileInput");
    const files = fileInput.files;
    if (!files.length) {
      alert("Please select an audio file.");
      return;
    }
    const audioBlob = files[0];

    setIsLoading(true);
    try {
      const originalUrl = await initializeWaveSurfer(
        audioBlob,
        wavesurferRef,
        waveformRef
      );
      setAudioUrl(originalUrl);

      const cleanedBlob = await cleanAudio(audioBlob);
      const cleanedUrl = await initializeWaveSurfer(
        cleanedBlob,
        cleanedWavesurferRef,
        cleanedWaveformRef
      );
      setCleanedAudioUrl(cleanedUrl);

      const formData = new FormData();
      formData.append("file", cleanedBlob);
      formData.append("model", "whisper-1");

      const apiResponse = await axios.post(
        "https://api.openai.com/v1/audio/transcriptions",
        formData,
        {
          headers: {
            "Content-Type": "multipart/form-data",
            Authorization: `Bearer ${process.env.NEXT_PUBLIC_OPENAI_API_KEY}`,
          },
        }
      );

      if (apiResponse.status !== 200) {
        throw new Error("Failed to transcribe audio");
      }

      const result = apiResponse.data;
      setTranscription(result.text);

      await callChatGPTForTranslation(result.text);
    } catch (error) {
      alert("Error transcribing audio: " + error.message);
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="flex flex-col items-center justify-center p-8 bg-gradient-to-r from-purple-600 to-indigo-600 min-h-screen">
      <h1 className="text-5xl font-extrabold text-white mb-10 text-center leading-tight">
        Audio Transcription & Translation
      </h1>

      <div className="bg-white p-8 rounded-2xl shadow-2xl w-full max-w-4xl">
        <input
          type="file"
          accept="audio/*"
          id="audioFileInput"
          className="mb-6 p-4 w-full bg-gray-100 rounded-lg border-2 border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition duration-200 ease-in-out transform hover:scale-105"
        />

        <div className="mb-8">
          <h3 className="text-2xl font-semibold text-gray-800 mb-4">
            Original Audio
          </h3>
          <div ref={cleanedWaveformRef} className="mb-4"></div>
          {cleanedAudioUrl && (
            <audio
              controls
              src={cleanedAudioUrl}
              className="w-full mb-4 rounded-xl shadow-lg hover:shadow-xl transition duration-200"
            >
              Your browser does not support the audio element.
            </audio>
          )}
        </div>

        <div className="mb-8">
          <h3 className="text-2xl font-semibold text-gray-800 mb-4">
            Cleaned Audio
          </h3>
          <div ref={waveformRef} className="mb-4"></div>
          {audioUrl && (
            <audio
              controls
              src={audioUrl}
              className="w-full mb-4 rounded-xl shadow-lg hover:shadow-xl transition duration-200"
            >
              Your browser does not support the audio element.
            </audio>
          )}
        </div>

        <button
          onClick={handleTranscribe}
          disabled={isLoading}
          className="w-full py-4 px-6 bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-semibold rounded-xl hover:from-indigo-600 hover:to-purple-700 transition duration-300 ease-in-out transform hover:scale-105 disabled:opacity-50"
        >
          {isLoading ? "Processing..." : "Transcribe Audio"}
        </button>
      </div>

      {transcription && (
        <div className="mt-10 p-8 w-full max-w-4xl bg-white rounded-2xl shadow-2xl">
          <h2 className="text-2xl font-semibold text-gray-800 mb-4">
            Transcription:
          </h2>
          <p className="whitespace-pre-wrap text-gray-800 text-lg leading-relaxed">
            {transcription}
          </p>
        </div>
      )}

      {translation && (
        <div className="mt-8 p-8 w-full max-w-4xl bg-white rounded-2xl shadow-2xl">
          <h2 className="text-2xl font-semibold text-gray-800 mb-4">
            Translation:
          </h2>
          <p className="whitespace-pre-wrap text-gray-800 text-lg leading-relaxed">
            {translation}
          </p>
        </div>
      )}
    </main>
  );
}
