import { useState, useRef, useEffect } from 'react';
import '@/App.css';
import { Mic, Square, Music, Vibrate } from 'lucide-react';
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
      // Небольшая задержка для загрузки страницы
      setTimeout(() => {
        startRecording();
      }, 500);
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
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm'
      });
      
      audioChunksRef.current = [];
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      
      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        await recognizeAudio(audioBlob);
        stream.getTracks().forEach(track => track.stop());
      };
      
      mediaRecorder.start();
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);
      setRecordingTime(0);
      
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => {
          const newTime = prev + 1;
          // Автоматическая остановка через 10 секунд
          if (newTime >= MAX_RECORDING_TIME) {
            stopRecording();
          }
          return newTime;
        });
      }, 1000);
      
    } catch (err) {
      setError('Не удалось получить доступ к микрофону. Разрешите доступ в настройках браузера.');
      console.error('Ошибка доступа к микрофону:', err);
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
      const formData = new FormData();
      formData.append('file', audioBlob, 'recording.webm');
      
      const response = await axios.post(`${API}/recognize`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });
      
      setResult(response.data);
      
      // Запускаем вибрацию
      if (response.data.vibration_pattern && 'vibrate' in navigator) {
        navigator.vibrate(response.data.vibration_pattern);
      }
      
    } catch (err) {
      setError(err.response?.data?.detail || 'Не удалось распознать музыку. Попробуйте записать еще раз.');
      console.error('Ошибка распознавания:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-start p-4" style={{ background: '#000000' }}>
      <Card className="w-full max-w-md bg-black border-gray-800" data-testid="main-card">
        <CardHeader className="text-center pb-2">
          <div className="flex justify-center mb-4">
            <img 
              src="https://customer-assets.emergentagent.com/job_melody-guesser-2/artifacts/g024atoz_photo_2026-01-22_13-49-18.jpg" 
              alt="MAXZOA" 
              className="w-full h-auto"
            />
          </div>
        </CardHeader>
        
        <CardContent className="space-y-4">
          {/* Кнопка записи */}
          <div className="flex flex-col items-center space-y-3">
            {!isRecording && !isProcessing && (
              <Button
                data-testid="start-recording-btn"
                onClick={startRecording}
                size="lg"
                className="w-24 h-24 rounded-full text-white shadow-lg transition-transform hover:scale-105 bg-red-600 hover:bg-red-700"
                style={{ 
                  boxShadow: '0 0 30px rgba(255, 0, 0, 0.6), 0 0 60px rgba(255, 0, 0, 0.4), inset 0 0 20px rgba(0, 0, 0, 0.5)',
                  border: '2px solid rgba(255, 0, 0, 0.8)'
                }}
              >
                <Mic className="w-10 h-10" />
              </Button>
            )}
            
            {isRecording && (
              <div className="flex flex-col items-center space-y-3">
                <div className="relative">
                  <Button
                    data-testid="stop-recording-btn"
                    onClick={stopRecording}
                    size="lg"
                    className="w-24 h-24 rounded-full bg-red-500 hover:bg-red-600 text-white shadow-lg animate-pulse"
                    style={{ 
                      boxShadow: '0 0 30px rgba(255, 0, 0, 0.8), 0 0 60px rgba(255, 0, 0, 0.5)',
                      border: '2px solid rgba(255, 0, 0, 0.9)'
                    }}
                  >
                    <Square className="w-10 h-10" />
                  </Button>
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
                <div className="w-16 h-16 border-4 border-red-500 border-t-transparent rounded-full animate-spin"></div>
                <p className="text-sm text-white">Распознавание...</p>
              </div>
            )}
          </div>

          {/* Группировка букв на главном экране */}
          {!result && (
            <div className="pt-4 mt-4 border-t border-gray-800">
              <div className="text-xs space-y-1 text-center">
                <div className="text-gray-500 font-bold">RU: А-Д | Е-Й | Й-Н | О-Т | У-Ч | Ш-Ь | Э-Я</div>
                <div className="text-gray-500 font-bold">EN: A-E | F-J | K-O | P-T | U-Y | Z</div>
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
            <Card className="border-2 border-red-600 bg-black" data-testid="result-card">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2 text-white">
                  <Music className="w-5 h-5 text-red-600" />
                  Результат
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="text-sm text-gray-400">Название</p>
                  <p className="font-semibold text-white" data-testid="song-title">{result.title}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-400">Исполнитель</p>
                  <p className="font-semibold text-white" data-testid="song-artist">{result.artist}</p>
                </div>
                {result.album && (
                  <div>
                    <p className="text-sm text-gray-400">Альбом</p>
                    <p className="font-semibold text-white" data-testid="song-album">{result.album}</p>
                  </div>
                )}
                <div className="flex items-center gap-2 pt-2">
                  <Vibrate className="w-4 h-4 text-red-600" />
                  <p className="text-sm text-white">
                    Язык: <span className="font-semibold" data-testid="song-language">{result.language === 'russian' ? 'Русский 🇷🇺' : 'English 🇬🇧'}</span>
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
                  className="w-full mt-4 border-red-600 text-red-600 hover:bg-red-600 hover:text-white"
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