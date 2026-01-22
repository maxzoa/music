import { useState, useRef, useEffect } from 'react';
import '@/App.css';
import { Music, Vibrate } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;
const MAX_RECORDING_TIME = 15; // Максимальное время записи в секундах

function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const [autoStarted, setAutoStarted] = useState(false);
  
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerRef = useRef(null);

  useEffect(() => {
    // Проверяем URL параметры для автозапуска
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('autostart') === 'true' && !autoStarted) {
      setAutoStarted(true);
      // Увеличиваем задержку для Android - нужно время на получение разрешений
      const delay = /Android/i.test(navigator.userAgent) ? 2000 : 500;
      console.log(`Autostart in ${delay}ms`);
      setTimeout(() => {
        startRecording();
      }, delay);
    }
    
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [autoStarted]);

  const startRecording = async () => {
    try {
      setError(null);
      setResult(null);
      
      console.log('Starting recording...');
      
      // Вибрация при начале записи (протяжная - 500мс)
      if ('vibrate' in navigator) {
        navigator.vibrate(500);
        console.log('✓ Vibration: Recording started');
      }
      
      // Запрашиваем разрешения с более простыми constraints для Android
      const constraints = /Android/i.test(navigator.userAgent) ? {
        audio: {
          echoCancellation: true,  // Включаем для Android
          noiseSuppression: true,   // Включаем для Android
          autoGainControl: true,    // Включаем для Android
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
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      console.log('✓ Media stream obtained');
      
      // Определяем лучший доступный mime type
      let mimeType = 'audio/webm';
      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        mimeType = 'audio/webm;codecs=opus';
      } else if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) {
        mimeType = 'audio/ogg;codecs=opus';
      } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
        mimeType = 'audio/mp4';
      }
      
      console.log('Using mime type:', mimeType);
      
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: mimeType,
        audioBitsPerSecond: 128000
      });
      
      audioChunksRef.current = [];
      let chunksReceived = 0;
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksReceived++;
          console.log(`Chunk ${chunksReceived}:`, event.data.size, 'bytes');
          audioChunksRef.current.push(event.data);
        }
      };
      
      mediaRecorder.onstop = async () => {
        console.log(`Recording stopped. Total chunks: ${chunksReceived}`);
        
        // Проверяем, что есть данные
        if (audioChunksRef.current.length === 0) {
          setError('Запись не содержит данных. Попробуйте еще раз.');
          setIsProcessing(false);
          stream.getTracks().forEach(track => track.stop());
          return;
        }
        
        // Вибрация по окончании записи перед распознаванием (протяжная - 500мс)
        if ('vibrate' in navigator) {
          navigator.vibrate(500);
          console.log('✓ Vibration: Recording stopped, starting recognition');
        }
        
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        console.log('Total audio size:', audioBlob.size, 'bytes from', audioChunksRef.current.length, 'chunks');
        
        // Дополнительная проверка размера
        if (audioBlob.size < 10000) {
          setError('Записанный файл слишком мал. Убедитесь, что микрофон работает и попробуйте снова.');
          setIsProcessing(false);
          stream.getTracks().forEach(track => track.stop());
          return;
        }
        
        await recognizeAudio(audioBlob);
        stream.getTracks().forEach(track => track.stop());
      };
      
      mediaRecorder.onerror = (event) => {
        console.error('MediaRecorder error:', event.error);
        setError('Ошибка записи: ' + event.error);
        setIsRecording(false);
        setIsProcessing(false);
        stream.getTracks().forEach(track => track.stop());
      };
      
      // Запрашиваем данные каждую секунду для более стабильной записи
      console.log('Starting MediaRecorder...');
      mediaRecorder.start(1000);
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);
      setRecordingTime(0);
      
      console.log('MediaRecorder state:', mediaRecorder.state);
      
      // Используем более точный таймер
      let startTime = Date.now();
      timerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        setRecordingTime(elapsed);
        
        // Автоматическая остановка через MAX_RECORDING_TIME секунд
        if (elapsed >= MAX_RECORDING_TIME) {
          console.log('Max recording time reached, stopping...');
          stopRecording();
        }
      }, 100); // Обновляем каждые 100мс для плавности
      
    } catch (err) {
      console.error('Error starting recording:', err);
      setError('Не удалось получить доступ к микрофону. Разрешите доступ в настройках браузера.');
      setIsRecording(false);
      setIsProcessing(false);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setIsProcessing(true);
      
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    }
  };

  const recognizeAudio = async (audioBlob) => {
    try {
      console.log('Recognizing audio blob:', audioBlob.size, 'bytes, type:', audioBlob.type);
      
      // Проверяем минимальный размер
      if (audioBlob.size < 1000) {
        setError('Записанный файл слишком мал. Попробуйте еще раз.');
        setIsProcessing(false);
        return;
      }
      
      const formData = new FormData();
      
      // Для Android пытаемся конвертировать в WAV через Web Audio API
      if (/Android/i.test(navigator.userAgent)) {
        console.log('Detected Android - attempting to convert to WAV');
        try {
          const audioContext = new (window.AudioContext || window.webkitAudioContext)();
          const arrayBuffer = await audioBlob.arrayBuffer();
          const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
          
          // Конвертируем в WAV
          const wavBlob = await audioBufferToWav(audioBuffer);
          console.log('Converted to WAV:', wavBlob.size, 'bytes');
          formData.append('file', wavBlob, 'recording.wav');
        } catch (convError) {
          console.warn('WAV conversion failed, using original:', convError);
          formData.append('file', audioBlob, 'recording.webm');
        }
      } else {
        formData.append('file', audioBlob, 'recording.webm');
      }
      
      const response = await axios.post(`${API}/recognize`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        },
        timeout: 30000 // 30 секунд таймаут
      });
      
      console.log('Recognition response:', response.data);
      
      setResult(response.data);
      
      // Запускаем вибрацию
      if (response.data.vibration_pattern && 'vibrate' in navigator) {
        console.log('Starting vibration pattern:', response.data.vibration_pattern.length, 'elements');
        navigator.vibrate(response.data.vibration_pattern);
      }
      
    } catch (err) {
      console.error('Recognition error:', err);
      const errorMsg = err.response?.data?.detail || err.message || 'Не удалось распознать музыку. Попробуйте записать еще раз.';
      setError(errorMsg);
    } finally {
      setIsProcessing(false);
    }
  };
  
  // Функция конвертации AudioBuffer в WAV
  const audioBufferToWav = async (audioBuffer) => {
    const numberOfChannels = audioBuffer.numberOfChannels;
    const length = audioBuffer.length * numberOfChannels * 2 + 44;
    const buffer = new ArrayBuffer(length);
    const view = new DataView(buffer);
    const channels = [];
    let offset = 0;
    let pos = 0;
    
    // WAV header
    const setUint16 = (data) => {
      view.setUint16(pos, data, true);
      pos += 2;
    };
    const setUint32 = (data) => {
      view.setUint32(pos, data, true);
      pos += 4;
    };
    
    // RIFF identifier
    setUint32(0x46464952);
    // file length
    setUint32(length - 8);
    // RIFF type
    setUint32(0x45564157);
    // format chunk identifier
    setUint32(0x20746d66);
    // format chunk length
    setUint32(16);
    // sample format (raw)
    setUint16(1);
    // channel count
    setUint16(numberOfChannels);
    // sample rate
    setUint32(audioBuffer.sampleRate);
    // byte rate (sample rate * block align)
    setUint32(audioBuffer.sampleRate * numberOfChannels * 2);
    // block align (channel count * bytes per sample)
    setUint16(numberOfChannels * 2);
    // bits per sample
    setUint16(16);
    // data chunk identifier
    setUint32(0x61746164);
    // data chunk length
    setUint32(length - pos - 4);
    
    // write interleaved data
    for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
      channels.push(audioBuffer.getChannelData(i));
    }
    
    while (pos < length) {
      for (let i = 0; i < numberOfChannels; i++) {
        let sample = Math.max(-1, Math.min(1, channels[i][offset]));
        sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        view.setInt16(pos, sample, true);
        pos += 2;
      }
      offset++;
    }
    
    return new Blob([buffer], { type: 'audio/wav' });
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
          {/* Кнопка записи / Прогресс бар - фиксированная высота */}
          <div className="flex flex-col items-center space-y-3" style={{ minHeight: '240px' }}>
            {!isRecording && !isProcessing && (
              <button
                data-testid="start-recording-btn"
                onClick={startRecording}
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
                    onClick={stopRecording}
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

          {/* Группировка букв на главном экране */}
          {!result && (
            <div className="pt-4 mt-4 border-t border-gray-800">
              <div className="text-sm space-y-1 text-center">
                <div className="text-gray-500 font-extrabold">RU: А-Д | Е-Й | Й-Н | О-Т | У-Ч | Ш-Ь | Э-Я</div>
                <div className="text-gray-500 font-extrabold">EN: A-E | F-J | K-O | P-T | U-Y | Z</div>
              </div>
            </div>
          )}

          {/* Ошибка */}
          {error && (
            <Alert variant="destructive" data-testid="error-alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Результат */}
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