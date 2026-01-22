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
    """Создать паттерн вибрации для названия песни"""
    pattern = []
    
    # Индикатор языка: 1 вибро = английский, 2 вибро = русский
    if language == 'english':
        pattern.extend([200, 1000])  # 1 вибро, затем пауза
    else:
        pattern.extend([200, 300, 200, 1000])  # 2 вибро, затем пауза
    
    # Определяем алфавит
    alphabet_groups = RUSSIAN_ALPHABET_GROUPS if language == 'russian' else ENGLISH_ALPHABET_GROUPS
    
    # Кодируем каждую букву
    for char in title:
        if not char.isalpha():
            # Пробелы и знаки - длинная пауза
            pattern.extend([0, 1500])
            continue
        
        position = get_letter_position(char, alphabet_groups)
        if position:
            group_num, letter_num = position
            
            # Вибро для номера группы
            for i in range(group_num):
                pattern.append(200)
                if i < group_num - 1:
                    pattern.append(200)  # короткая пауза между вибро в группе
            
            # Пауза между группой и буквой
            pattern.append(500)
            
            # Вибро для номера буквы в группе
            for i in range(letter_num):
                pattern.append(200)
                if i < letter_num - 1:
                    pattern.append(200)
            
            # Пауза между буквами
            pattern.append(1000)
    
    return pattern

async def recognize_audio_with_audd(file_content: bytes, filename: str) -> dict:
    """Распознать музыку через AudD API"""
    audd_token = os.getenv('AUDD_API_TOKEN', 'test')
    
    try:
        files = {
            'file': (filename, BytesIO(file_content), 'application/octet-stream')
        }
        data = {
            'api_token': audd_token,
            'return': 'apple_music,spotify'
        }
        
        response = requests.post(
            'https://api.audd.io/',
            files=files,
            data=data,
            timeout=30
        )
        
        response.raise_for_status()
        result = response.json()
        
        if result.get('status') != 'success':
            return {
                'status': 'error',
                'message': 'Не удалось распознать музыку'
            }
        
        result_data = result.get('result')
        if not result_data:
            return {
                'status': 'not_found',
                'message': 'Песня не распознана'
            }
        
        title = result_data.get('title', 'Unknown')
        artist = result_data.get('artist', 'Unknown')
        album = result_data.get('album')
        
        # Определяем язык
        language = detect_language(title)
        
        # Создаем паттерн вибрации
        vibration_pattern = create_vibration_pattern(title, language)
        
        return {
            'status': 'success',
            'title': title,
            'artist': artist,
            'album': album,
            'language': language,
            'vibration_pattern': vibration_pattern
        }
        
    except requests.Timeout:
        return {
            'status': 'error',
            'message': 'Превышено время ожидания API'
        }
    except Exception as e:
        logging.error(f"Ошибка распознавания: {str(e)}")
        return {
            'status': 'error',
            'message': f'Ошибка: {str(e)}'
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
    if file.size and file.size > 10 * 1024 * 1024:
        raise HTTPException(
            status_code=413,
            detail="Размер файла должен быть менее 10MB"
        )
    
    valid_types = ['audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/ogg', 'audio/webm']
    if file.content_type not in valid_types:
        raise HTTPException(
            status_code=400,
            detail=f"Неподдерживаемый формат. Поддерживаются: {', '.join(valid_types)}"
        )
    
    try:
        file_content = await file.read()
        if not file_content:
            raise HTTPException(status_code=400, detail="Файл пуст")
        
        result = await recognize_audio_with_audd(file_content, file.filename or "audio")
        
        if result['status'] in ['error', 'not_found']:
            raise HTTPException(status_code=404, detail=result.get('message', 'Ошибка распознавания'))
        
        # Сохраняем в историю
        await db.recognitions.insert_one({
            'title': result['title'],
            'artist': result['artist'],
            'album': result.get('album'),
            'language': result['language'],
            'timestamp': datetime.now(timezone.utc).isoformat()
        })
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Ошибка: {str(e)}")
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