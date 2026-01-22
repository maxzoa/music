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
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
      <Card className="w-full max-w-md" data-testid="main-card">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
              <Music className="w-8 h-8 text-white" />
            </div>
          </div>
          <CardTitle className="text-2xl font-bold" data-testid="app-title">Угадай Мелодию</CardTitle>
          <CardDescription>Читерское приложение для квизов</CardDescription>
        </CardHeader>
        
        <CardContent className="space-y-6">
          {/* Кнопка записи */}
          <div className="flex flex-col items-center space-y-4">
            {!isRecording && !isProcessing && (
              <Button
                data-testid="start-recording-btn"
                onClick={startRecording}
                size="lg"
                className="w-32 h-32 rounded-full text-white shadow-lg transition-transform hover:scale-105"
                style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}
              >
                <Mic className="w-12 h-12" />
              </Button>
            )}
            
            {isRecording && (
              <div className="flex flex-col items-center space-y-3">
                <div className="relative">
                  <Button
                    data-testid="stop-recording-btn"
                    onClick={stopRecording}
                    size="lg"
                    className="w-32 h-32 rounded-full bg-red-500 hover:bg-red-600 text-white shadow-lg animate-pulse"
                  >
                    <Square className="w-12 h-12" />
                  </Button>
                  <div className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 rounded-full animate-ping"></div>
                </div>
                <div className="text-lg font-mono font-bold" data-testid="recording-time">{formatTime(recordingTime)}</div>
                <p className="text-sm text-muted-foreground">
                  Запись... ({MAX_RECORDING_TIME - recordingTime} сек до автоостановки)
                </p>
              </div>
            )}
            
            {isProcessing && (
              <div className="flex flex-col items-center space-y-3" data-testid="processing-indicator">
                <div className="w-16 h-16 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
                <p className="text-sm">Распознавание...</p>
              </div>
            )}
            
            {!isRecording && !isProcessing && (
              <p className="text-sm text-muted-foreground text-center">
                Нажмите на микрофон, чтобы начать запись
              </p>
            )}
          </div>

          {/* Ошибка */}
          {error && (
            <Alert variant="destructive" data-testid="error-alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Результат */}
          {result && (
            <Card className="border-2" style={{ borderColor: '#667eea' }} data-testid="result-card">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Music className="w-5 h-5" style={{ color: '#667eea' }} />
                  Результат
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="text-sm text-muted-foreground">Название</p>
                  <p className="font-semibold" data-testid="song-title">{result.title}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Исполнитель</p>
                  <p className="font-semibold" data-testid="song-artist">{result.artist}</p>
                </div>
                {result.album && (
                  <div>
                    <p className="text-sm text-muted-foreground">Альбом</p>
                    <p className="font-semibold" data-testid="song-album">{result.album}</p>
                  </div>
                )}
                <div className="flex items-center gap-2 pt-2">
                  <Vibrate className="w-4 h-4" style={{ color: '#667eea' }} />
                  <p className="text-sm">
                    Язык: <span className="font-semibold" data-testid="song-language">{result.language === 'russian' ? 'Русский 🇷🇺' : 'English 🇬🇧'}</span>
                  </p>
                </div>
                <p className="text-xs text-muted-foreground mt-3">
                  {'vibrate' in navigator ? '✓ Вибросигналы отправлены' : '⚠️ Вибрация не поддерживается в этом браузере'}
                </p>
                <Button
                  data-testid="new-search-btn"
                  onClick={() => {
                    setResult(null);
                    setError(null);
                  }}
                  variant="outline"
                  className="w-full mt-4"
                >
                  Новый поиск
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Инструкция */}
          {!result && !isRecording && !isProcessing && (
            <Card className="bg-muted/50">
              <CardContent className="pt-6">
                <h3 className="font-semibold mb-2 text-sm">Как использовать:</h3>
                <ol className="text-sm space-y-1 text-muted-foreground list-decimal list-inside mb-4">
                  <li>Разрешите доступ к микрофону</li>
                  <li>Нажмите на иконку микрофона</li>
                  <li>Запись автоматически остановится через 15 сек</li>
                  <li>Получите название + вибросигналы</li>
                </ol>
                
                <div className="border-t pt-3 mt-3">
                  <h4 className="font-semibold text-xs mb-2">Группировка букв:</h4>
                  <div className="text-xs text-muted-foreground space-y-1">
                    <div><strong>RU:</strong> А-Д | Е-Й | Й-Н | О-Т | У-Ч | Ш-Ь | Э-Я</div>
                    <div><strong>EN:</strong> A-E | F-J | K-O | P-T | U-Y | Z</div>
                  </div>
                </div>
                
                <div className="border-t pt-3 mt-3">
                  <h4 className="font-semibold text-xs mb-2">Автозапуск (MacroDroid):</h4>
                  <div className="text-xs text-muted-foreground break-all">
                    <code className="bg-muted px-2 py-1 rounded">
                      {window.location.origin}/?autostart=true
                    </code>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default App;