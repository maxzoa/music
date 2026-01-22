import { useState, useRef, useEffect } from 'react';
import '@/App.css';
import { Music, Vibrate } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;
const MAX_RECORDING_TIME = 15;

// =====================================
// ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ МОДУЛЯ
// Не сбрасываются при React Strict Mode remount
// =====================================
let g_hasAutoStarted = false;
let g_isRecording = false;
let g_autoStartTimeout = null;
let g_timerId = null;
let g_mediaRecorder = null;
let g_audioChunks = [];
let g_stream = null;
let g_startTime = null;

// Глобальная функция распознавания
const recognizeAudioGlobal = async (audioBlob, setters) => {
  const { setError, setResult, setIsProcessing } = setters;
  
  try {
    console.log('Recognizing audio blob:', audioBlob.size, 'bytes, type:', audioBlob.type);
    
    if (audioBlob.size < 10000) {
      console.error('File too small:', audioBlob.size, 'bytes');
      setError('Записанный файл слишком мал (' + audioBlob.size + ' байт). Проверьте разрешения микрофона.');
      setIsProcessing(false);
      return;
    }
    
    const formData = new FormData();
    formData.append('file', audioBlob, 'recording.webm');
    
    console.log('Sending to server...');
    const response = await axios.post(`${API}/recognize`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 30000
    });
    
    console.log('Recognition response:', response.data);
    setResult(response.data);
    
    if (response.data.vibration_pattern && 'vibrate' in navigator) {
      console.log('Starting vibration pattern:', response.data.vibration_pattern.length, 'elements');
      navigator.vibrate(response.data.vibration_pattern);
    }
    
  } catch (err) {
    console.error('Recognition error:', err);
    console.error('Error details:', err.response?.data);
    const errorMsg = err.response?.data?.detail || err.message || 'Не удалось распознать музыку';
    setError(errorMsg);
  } finally {
    setIsProcessing(false);
  }
};

// Глобальная функция остановки записи
const stopRecordingGlobal = (setters) => {
  console.log('stopRecordingGlobal called, g_isRecording:', g_isRecording, 'state:', g_mediaRecorder?.state);
  
  // Останавливаем таймер СРАЗУ
  if (g_timerId) {
    clearTimeout(g_timerId);
    g_timerId = null;
    console.log('Global timer cleared');
  }
  
  // Проверяем флаг и состояние MediaRecorder
  if (g_isRecording && g_mediaRecorder && g_mediaRecorder.state === 'recording') {
    console.log('Stopping global MediaRecorder...');
    g_isRecording = false; // Сбрасываем флаг ДО остановки
    g_mediaRecorder.stop();
    setters.setIsRecording(false);
    setters.setIsProcessing(true);
  } else {
    console.log('MediaRecorder not in recording state or already stopped');
    g_isRecording = false;
  }
};

// Глобальная функция начала записи
const startRecordingGlobal = async (setters) => {
  const { setIsRecording, setIsProcessing, setError, setResult, setRecordingTime } = setters;
  
  // Защита от двойного вызова
  if (g_isRecording) {
    console.log('Global recording already in progress, ignoring');
    return;
  }
  
  console.log('Starting global recording...');
  g_isRecording = true;
  
  try {
    setError(null);
    setResult(null);
    
    // Вибрация при начале записи
    if ('vibrate' in navigator) {
      try {
        navigator.vibrate(500);
        console.log('✓ Vibration: Recording started');
      } catch (e) {
        console.log('Vibration blocked:', e.message);
      }
    }
    
    const constraints = /Android/i.test(navigator.userAgent) ? {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      }
    } : {
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        sampleRate: 44100
      }
    };
    
    console.log('Requesting media with constraints:', constraints);
    g_stream = await navigator.mediaDevices.getUserMedia(constraints);
    console.log('✓ Media stream obtained');
    
    let mimeType = 'audio/webm';
    if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
      mimeType = 'audio/webm;codecs=opus';
    } else if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) {
      mimeType = 'audio/ogg;codecs=opus';
    } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
      mimeType = 'audio/mp4';
    }
    
    console.log('Using mime type:', mimeType);
    
    const audioBitsPerSecond = /Android/i.test(navigator.userAgent) ? 192000 : 128000;
    console.log('Audio bitrate:', audioBitsPerSecond);
    
    g_audioChunks = [];
    let chunksReceived = 0;
    
    g_mediaRecorder = new MediaRecorder(g_stream, {
      mimeType: mimeType,
      audioBitsPerSecond: audioBitsPerSecond
    });
    
    g_mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0 && g_isRecording) {
        chunksReceived++;
        console.log(`Chunk ${chunksReceived}:`, event.data.size, 'bytes');
        g_audioChunks.push(event.data);
      }
    };
    
    g_mediaRecorder.onstop = async () => {
      console.log(`Recording stopped. Total chunks: ${chunksReceived}`);
      
      // Очищаем таймер если не очищен
      if (g_timerId) {
        clearTimeout(g_timerId);
        g_timerId = null;
      }
      
      if (g_audioChunks.length === 0) {
        setError('Запись не содержит данных. Попробуйте еще раз.');
        setIsProcessing(false);
        g_stream?.getTracks().forEach(track => track.stop());
        return;
      }
      
      // Вибрация по окончании записи
      if ('vibrate' in navigator) {
        try {
          navigator.vibrate(500);
          console.log('✓ Vibration: Recording stopped, starting recognition');
        } catch (e) {
          console.log('Vibration blocked:', e.message);
        }
      }
      
      const audioBlob = new Blob(g_audioChunks, { type: mimeType });
      console.log('Total audio size:', audioBlob.size, 'bytes from', g_audioChunks.length, 'chunks');
      
      if (audioBlob.size < 10000) {
        setError('Записанный файл слишком мал. Убедитесь, что микрофон работает и попробуйте снова.');
        setIsProcessing(false);
        g_stream?.getTracks().forEach(track => track.stop());
        return;
      }
      
      await recognizeAudioGlobal(audioBlob, setters);
      g_stream?.getTracks().forEach(track => track.stop());
    };
    
    g_mediaRecorder.onerror = (event) => {
      console.error('MediaRecorder error:', event.error);
      setError('Ошибка записи: ' + event.error);
      setIsRecording(false);
      setIsProcessing(false);
      g_isRecording = false;
      g_stream?.getTracks().forEach(track => track.stop());
    };
    
    // Очищаем предыдущий таймер
    if (g_timerId) {
      clearTimeout(g_timerId);
      g_timerId = null;
    }
    
    console.log('Starting MediaRecorder...');
    g_mediaRecorder.start(1000);
    setIsRecording(true);
    setRecordingTime(0);
    
    console.log('MediaRecorder state:', g_mediaRecorder.state);
    
    // Таймер с проверкой флага
    g_startTime = Date.now();
    const maxDuration = MAX_RECORDING_TIME * 1000;
    
    const updateTimer = () => {
      // Проверяем глобальный флаг
      if (!g_isRecording) {
        console.log('Timer stopped - g_isRecording is false');
        return;
      }
      
      const elapsed = Date.now() - g_startTime;
      const elapsedSeconds = Math.floor(elapsed / 1000);
      setRecordingTime(elapsedSeconds);
      
      if (elapsed >= maxDuration) {
        console.log('Max recording time reached, stopping...');
        stopRecordingGlobal(setters);
        return;
      }
      
      g_timerId = setTimeout(updateTimer, 100);
    };
    
    g_timerId = setTimeout(updateTimer, 100);
    
  } catch (err) {
    console.error('Error starting recording:', err);
    setError('Не удалось получить доступ к микрофону. Разрешите доступ в настройках браузера.');
    setIsRecording(false);
    setIsProcessing(false);
    g_isRecording = false;
  }
};

function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [recordingTime, setRecordingTime] = useState(0);
  
  // Объект с setters для глобальных функций
  const settersRef = useRef({});
  settersRef.current = {
    setIsRecording,
    setIsProcessing,
    setError,
    setResult,
    setRecordingTime
  };

  useEffect(() => {
    // Проверяем ГЛОБАЛЬНЫЙ флаг
    if (g_hasAutoStarted) {
      console.log('Autostart already triggered globally, skipping');
      return;
    }
    
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('autostart') === 'true') {
      g_hasAutoStarted = true;
      
      const delay = /Android/i.test(navigator.userAgent) ? 2000 : 500;
      console.log(`Autostart scheduled in ${delay}ms (global flag set)`);
      
      g_autoStartTimeout = setTimeout(() => {
        console.log('Autostart executing...');
        startRecordingGlobal(settersRef.current);
      }, delay);
    }
    
    return () => {
      if (g_autoStartTimeout) {
        clearTimeout(g_autoStartTimeout);
        g_autoStartTimeout = null;
      }
    };
  }, []);

  const handleStartRecording = () => {
    startRecordingGlobal(settersRef.current);
  };

  const handleStopRecording = () => {
    stopRecordingGlobal(settersRef.current);
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-start pt-0" style={{ background: '#000000' }}>
      <Card className="w-full max-w-md bg-black border-gray-800 mt-0" data-testid="main-card">
        <CardHeader className="text-center pb-0 pt-0">
          <div className="flex justify-center">
            <img 
              src="https://customer-assets.emergentagent.com/job_melody-guesser-2/artifacts/5b9rdytn_photo_2026-01-22_13-49-18-removebg-preview.png" 
              alt="MAXZOA" 
              className="w-full h-auto"
            />
          </div>
        </CardHeader>
        
        <CardContent className="space-y-4 pt-0 -mt-8">
          <div className="flex flex-col items-center space-y-3" style={{ minHeight: '240px' }}>
            {!isRecording && !isProcessing && (
              <button
                data-testid="start-recording-btn"
                onClick={handleStartRecording}
                className="w-48 h-48 rounded-full transition-transform hover:scale-105 bg-transparent border-0 p-0"
              >
                <img 
                  src="https://customer-assets.emergentagent.com/job_melody-guesser-2/artifacts/h4nj9rhi_photo_2026-01-22_14-02-04-removebg-preview.png"
                  alt="Record"
                  className="w-full h-full"
                />
              </button>
            )}
            
            {isRecording && (
              <div className="flex flex-col items-center space-y-3">
                <div className="relative">
                  <button
                    data-testid="stop-recording-btn"
                    onClick={handleStopRecording}
                    className="w-48 h-48 rounded-full bg-transparent border-0 p-0 animate-pulse"
                  >
                    <img 
                      src="https://customer-assets.emergentagent.com/job_melody-guesser-2/artifacts/h4nj9rhi_photo_2026-01-22_14-02-04-removebg-preview.png"
                      alt="Stop"
                      className="w-full h-full"
                    />
                  </button>
                  <div className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 rounded-full animate-ping"></div>
                </div>
                <div className="text-lg font-mono font-bold text-white" data-testid="recording-time">{formatTime(recordingTime)}</div>
                <p className="text-sm text-gray-400">
                  ({MAX_RECORDING_TIME - recordingTime} сек)
                </p>
              </div>
            )}
            
            {isProcessing && (
              <div className="flex flex-col items-center space-y-3" data-testid="processing-indicator">
                <div className="w-48 h-48 relative">
                  <img 
                    src="https://customer-assets.emergentagent.com/job_melody-guesser-2/artifacts/nqgnoylt_photo_2026-01-22_14-02-04-removebg-preview%20%281%29.png"
                    alt="Processing"
                    className="w-full h-full animate-spin"
                    style={{ animationDuration: '2s' }}
                  />
                </div>
                <p className="text-lg font-bold text-green-500">Распознавание...</p>
              </div>
            )}
          </div>

          {!result && (
            <div className="pt-4 mt-4 border-t border-gray-800">
              <div className="text-sm space-y-1 text-center">
                <div className="text-gray-500 font-extrabold">RU: А-Д | Е-Й | Й-Н | О-Т | У-Ч | Ш-Ь | Э-Я</div>
                <div className="text-gray-500 font-extrabold">EN: A-E | F-J | K-O | P-T | U-Y | Z</div>
              </div>
            </div>
          )}

          {error && (
            <Alert variant="destructive" data-testid="error-alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {result && (
            <Card className="border-2 border-green-600 bg-black" data-testid="result-card">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2 text-green-500">
                  <Music className="w-5 h-5 text-green-600" />
                  Результат
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="text-sm text-gray-400">Название</p>
                  <p className="font-bold text-green-400 text-lg" data-testid="song-title">{result.title}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-400">Исполнитель</p>
                  <p className="font-bold text-green-400 text-lg" data-testid="song-artist">{result.artist}</p>
                </div>
                {result.album && (
                  <div>
                    <p className="text-sm text-gray-400">Альбом</p>
                    <p className="font-bold text-green-400" data-testid="song-album">{result.album}</p>
                  </div>
                )}
                <div className="flex items-center gap-2 pt-2">
                  <Vibrate className="w-4 h-4 text-green-600" />
                  <p className="text-sm text-white">
                    Язык: <span className="font-bold text-green-400" data-testid="song-language">{result.language === 'russian' ? 'Русский 🇷🇺' : 'English 🇬🇧'}</span>
                  </p>
                </div>
                <p className="text-xs text-gray-500 mt-3">
                  {'vibrate' in navigator ? '✓ Вибросигналы отправлены' : '⚠️ Вибрация не поддерживается в этом браузере'}
                </p>
                
                <div className="border-t border-gray-700 pt-3 mt-3">
                  <p className="text-xs font-bold text-gray-400 mb-2">Группировка букв:</p>
                  <div className="text-xs space-y-1">
                    <div className="text-gray-500 font-bold">RU: А-Д | Е-Й | Й-Н | О-Т | У-Ч | Ш-Ь | Э-Я</div>
                    <div className="text-gray-500 font-bold">EN: A-E | F-J | K-O | P-T | U-Y | Z</div>
                  </div>
                </div>
                
                <Button
                  data-testid="new-search-btn"
                  onClick={() => {
                    setResult(null);
                    setError(null);
                  }}
                  variant="outline"
                  className="w-full mt-4 border-green-600 text-green-400 hover:bg-green-600 hover:text-white font-bold"
                >
                  Новый поиск
                </Button>
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default App;
