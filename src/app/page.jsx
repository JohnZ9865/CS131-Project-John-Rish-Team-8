'use client';

import { useState } from 'react';
import axios from 'axios';

export default function Home() {
  const [transcription, setTranscription] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleTranscribe = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('public/sample.mp3');
      const audioBlob = await response.blob();
      const formData = new FormData();
      formData.append('file', audioBlob, 'audio.mp3');
      formData.append('model', 'whisper-1'); // Add model parameter

      const apiResponse = await axios.post('https://api.openai.com/v1/audio/transcriptions', formData, {
        headers: {
          'Authorization': `Bearer ${process.env.NEXT_PUBLIC_OPENAI_API_KEY}`
        }
      });

      if (apiResponse.status !== 200) {
        throw new Error('Failed to transcribe audio');
      }

      const result = apiResponse.data;
      setTranscription(result.text);
    } catch (error) {
      alert('Error transcribing audio: ' + error.message);
      console.log("Error below:");
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="p-4 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Audio Transcription</h1>
      <button
        onClick={handleTranscribe}
        disabled={isLoading}
        className="py-2 px-4 bg-blue-500 text-white rounded hover:bg-blue-600"
      >
        {isLoading ? 'Processing...' : 'Transcribe Audio'}
      </button>
      
      {transcription && (
        <div className="mt-6 p-4 bg-gray-50 rounded">
          <h2 className="text-lg font-semibold mb-2">Transcription:</h2>
          <p className="whitespace-pre-wrap">{transcription}</p>
        </div>
      )}
    </main>
  );
}