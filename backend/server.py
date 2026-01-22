from fastapi import FastAPI, APIRouter, UploadFile, File, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import requests
import re
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional
import uuid
from datetime import datetime, timezone
from io import BytesIO

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

class StatusCheck(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_name: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class StatusCheckCreate(BaseModel):
    client_name: str

class RecognitionResponse(BaseModel):
    status: str
    title: Optional[str] = None
    artist: Optional[str] = None
    album: Optional[str] = None
    language: Optional[str] = None
    vibration_pattern: Optional[List[int]] = None
    message: Optional[str] = None

RUSSIAN_ALPHABET_GROUPS = [
    ['А', 'Б', 'В', 'Г', 'Д'],
    ['Е', 'Ё', 'Ж', 'З', 'И'],
    ['Й', 'К', 'Л', 'М', 'Н'],
    ['О', 'П', 'Р', 'С', 'Т'],
    ['У', 'Ф', 'Х', 'Ц', 'Ч'],
    ['Ш', 'Щ', 'Ъ', 'Ы', 'Ь'],
    ['Э', 'Ю', 'Я']
]

ENGLISH_ALPHABET_GROUPS = [
    ['A', 'B', 'C', 'D', 'E'],
    ['F', 'G', 'H', 'I', 'J'],
    ['K', 'L', 'M', 'N', 'O'],
    ['P', 'Q', 'R', 'S', 'T'],
    ['U', 'V', 'W', 'X', 'Y'],
    ['Z']
]

def detect_language(text: str) -> str:
    """Определить язык текста (русский или английский)"""
    cyrillic_pattern = re.compile('[а-яА-ЯёЁ]')
    if cyrillic_pattern.search(text):
        return 'russian'
    return 'english'

def get_letter_position(letter: str, alphabet_groups: List[List[str]]) -> tuple:
    """Получить номер группы и позицию буквы в группе"""
    letter_upper = letter.upper()
    for group_idx, group in enumerate(alphabet_groups, 1):
        if letter_upper in group:
            position_in_group = group.index(letter_upper) + 1
            return (group_idx, position_in_group)
    return None

def create_vibration_pattern(title: str, language: str) -> List[int]:
    """Создать паттерн вибрации для названия песни
    
    Алгоритм:
    1. Индикатор языка: 1 вибро = английский, 2 вибро = русский
    2. Для каждой буквы:
       - Номер группы (количество сигналов)
       - Короткая пауза (400мс)
       - Номер буквы в группе (количество сигналов)
       - ДЛИННАЯ пауза между буквами (3000мс)
    """
    pattern = []
    
    # 1. БЛОК ЯЗЫКА: 1 вибро = английский, 2 вибро = русский
    if language == 'english':
        pattern.extend([300, 3000])  # 1 вибро, затем длинная пауза (3x)
    else:
        pattern.extend([300, 250, 300, 3000])  # 2 вибро, затем длинная пауза (3x)
    
    # Определяем алфавит
    alphabet_groups = RUSSIAN_ALPHABET_GROUPS if language == 'russian' else ENGLISH_ALPHABET_GROUPS
    
    # 2. КОДИРУЕМ ТОЛЬКО ПЕРВЫЕ 3 БУКВЫ
    letter_count = 0
    for char in title:
        if letter_count >= 3:  # Только 3 буквы
            break
            
        if not char.isalpha():
            # Пропускаем небуквенные символы
            continue
        
        position = get_letter_position(char, alphabet_groups)
        if position:
            group_num, letter_num = position
            
            # 2.1 БЛОК ГРУППЫ: показываем номер группы
            for i in range(group_num):
                pattern.append(250)  # вибро
                if i < group_num - 1:
                    pattern.append(150)  # короткая пауза между вибро в одном блоке
            
            # Пауза между блоком группы и блоком буквы
            pattern.append(400)
            
            # 2.2 БЛОК БУКВЫ: показываем номер буквы в группе
            for i in range(letter_num):
                pattern.append(250)  # вибро
                if i < letter_num - 1:
                    pattern.append(150)  # короткая пауза между вибро в одном блоке
            
            # ДЛИННАЯ пауза между буквами (3000мс вместо 1000мс)
            pattern.append(3000)
            letter_count += 1
    
    return pattern

async def recognize_audio_with_audd(file_content: bytes, filename: str) -> dict:
    """Распознать музыку через ACRCloud API (реальное распознавание)"""
    try:
        import tempfile
        import os
        from acrcloud.recognizer import ACRCloudRecognizer
        import json
        
        logging.info(f"Starting recognition for {filename}, size: {len(file_content)} bytes")
        
        # Конфигурация ACRCloud
        config = {
            'host': os.getenv('ACRCLOUD_HOST', ''),
            'access_key': os.getenv('ACRCLOUD_ACCESS_KEY', ''),
            'access_secret': os.getenv('ACRCLOUD_ACCESS_SECRET', ''),
            'timeout': 15  # Увеличиваем таймаут до 15 секунд
        }
        
        # Инициализируем распознаватель
        recognizer = ACRCloudRecognizer(config)
        
        # Определяем расширение файла
        file_ext = os.path.splitext(filename)[1]
        if not file_ext or file_ext == '.webm':
            # Для webm или без расширения пробуем как есть
            file_ext = '.webm'
        
        # Сохраняем файл временно
        with tempfile.NamedTemporaryFile(suffix=file_ext, delete=False) as tmp:
            tmp.write(file_content)
            tmp_path = tmp.name
        
        logging.info(f"Temp file created: {tmp_path}")
        
        try:
            # Распознаем музыку - используем начальные 15 секунд
            result_json = recognizer.recognize_by_file(tmp_path, 0, 15)
            result = json.loads(result_json)
            
            logging.info(f"ACRCloud response code: {result.get('status', {}).get('code')}")
            logging.info(f"ACRCloud response msg: {result.get('status', {}).get('msg')}")
            
            # Проверяем статус
            status_code = result.get('status', {}).get('code')
            if status_code != 0:
                msg = result.get('status', {}).get('msg', 'Музыка не распознана')
                
                # Более информативные сообщения
                if status_code == 1001:
                    msg = 'Музыка не найдена. Попробуйте: 1) Записать ближе к источнику звука 2) Убрать фоновый шум 3) Записать более известную песню'
                elif status_code == 2004:
                    msg = 'Не удалось декодировать аудиофайл. Попробуйте записать заново'
                elif status_code == 3001:
                    msg = 'Превышен лимит запросов. Подождите немного'
                
                logging.warning(f"Recognition failed: {msg}")
                return {
                    'status': 'not_found',
                    'message': msg
                }
            
            # Извлекаем данные о музыке
            metadata = result.get('metadata', {})
            music_list = metadata.get('music', [])
            
            if not music_list:
                return {
                    'status': 'not_found',
                    'message': 'Музыка не найдена в базе ACRCloud'
                }
            
            # Берем первый результат (наиболее точный)
            music = music_list[0]
            
            # Извлекаем исполнителя (для вибросигналов)
            artists = music.get('artists', [])
            artist = artists[0].get('name', 'Unknown') if artists else 'Unknown'
            
            title = music.get('title', 'Unknown')
            album_info = music.get('album', {})
            album = album_info.get('name') if album_info else None
            
            # Определяем язык ИСПОЛНИТЕЛЯ (не названия)
            language = detect_language(artist)
            
            # Создаем паттерн вибрации для ПЕРВЫХ 3 БУКВ ИСПОЛНИТЕЛЯ
            vibration_pattern = create_vibration_pattern(artist, language)
            
            score = music.get('score', 0)
            
            logging.info(f"✓ Распознано: {title} - {artist} ({language}), score: {score}")
            logging.info(f"  Первые 3 буквы: {''.join([c for c in artist if c.isalpha()])[:3]}")
            
            return {
                'status': 'success',
                'title': title,
                'artist': artist,
                'album': album,
                'language': language,
                'vibration_pattern': vibration_pattern,
                'score': score
            }
            
        finally:
            # Удаляем временный файл
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)
                logging.info(f"Temp file deleted: {tmp_path}")
                
    except Exception as e:
        logging.error(f"Ошибка распознавания ACRCloud: {str(e)}")
        import traceback
        logging.error(traceback.format_exc())
        return {
            'status': 'error',
            'message': f'Ошибка распознавания: {str(e)}'
        }

@api_router.get("/")
async def root():
    return {"message": "Melody Guesser API"}

@api_router.options("/")
async def root_options():
    return {}

@api_router.post("/status", response_model=StatusCheck)
async def create_status_check(input: StatusCheckCreate):
    status_dict = input.model_dump()
    status_obj = StatusCheck(**status_dict)
    doc = status_obj.model_dump()
    doc['timestamp'] = doc['timestamp'].isoformat()
    _ = await db.status_checks.insert_one(doc)
    return status_obj

@api_router.get("/status", response_model=List[StatusCheck])
async def get_status_checks():
    status_checks = await db.status_checks.find({}, {"_id": 0}).to_list(1000)
    for check in status_checks:
        if isinstance(check['timestamp'], str):
            check['timestamp'] = datetime.fromisoformat(check['timestamp'])
    return status_checks

@api_router.post("/recognize", response_model=RecognitionResponse)
async def recognize_audio(file: UploadFile = File(...)):
    """Распознать музыку из загруженного файла"""
    logging.info(f"Received file: {file.filename}, type: {file.content_type}, size: {file.size if file.size else 'unknown'}")
    
    if file.size and file.size > 10 * 1024 * 1024:
        raise HTTPException(
            status_code=413,
            detail="Размер файла должен быть менее 10MB"
        )
    
    try:
        file_content = await file.read()
        actual_size = len(file_content)
        logging.info(f"Actual file content size: {actual_size} bytes")
        
        if not file_content or actual_size < 1000:
            raise HTTPException(status_code=400, detail="Файл слишком мал или пуст")
        
        result = await recognize_audio_with_audd(file_content, file.filename or "audio")
        
        if result['status'] in ['error', 'not_found']:
            logging.warning(f"Recognition failed: {result.get('message')}")
            raise HTTPException(status_code=404, detail=result.get('message', 'Ошибка распознавания'))
        
        # Сохраняем в историю
        await db.recognitions.insert_one({
            'title': result['title'],
            'artist': result['artist'],
            'album': result.get('album'),
            'language': result['language'],
            'score': result.get('score', 0),
            'file_size': actual_size,
            'timestamp': datetime.now(timezone.utc).isoformat()
        })
        
        logging.info(f"Successfully recognized: {result['artist']} - {result['title']}")
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Error processing file: {str(e)}")
        import traceback
        logging.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail="Ошибка обработки файла")

app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()