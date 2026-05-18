from fastapi import FastAPI, HTTPException, UploadFile, File, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from dotenv import load_dotenv
import os
from supabase import create_client, Client
from typing import List
import edge_tts
import librosa
import requests
import numpy as np
import scipy.signal
from swift_f0 import SwiftF0
from collections import deque
from fastdtw import fastdtw
from scipy.spatial.distance import euclidean
from pydub import AudioSegment
import io
import json
from fastapi import Form

# =========================
# 🔥 Realtime Pitch Engine
# =========================

detector = SwiftF0(
    fmin=65,
    fmax=400,
    confidence_threshold=0.55
)

class RealtimePitchProcessor:
    def __init__(self):
        self.buffer = deque(maxlen=16000 * 2)  # 2秒 buffer
        self.prev_pitch = deque(maxlen=5)

    def process(self, chunk):
        self.buffer.extend(chunk)

        if len(self.buffer) < 2048:
            return []

        audio = np.array(self.buffer, dtype=np.float32)

        result = detector.detect_from_array(audio, 16000)
        pitch = result.pitch_hz

        # 1. 基礎濾波
        pitch[result.confidence < 0.55] = 0

        # 2. 轉換為 Log 尺度與正規化
        output = []

        for p in pitch[-5:]:
            if p > 50:
                p_log = np.log2(p)
                p_min, p_max = np.log2(65), np.log2(400)

                norm_p = (p_log - p_min) / (p_max - p_min) * 100

                output.append(float(norm_p))
            else:
                output.append(0.0)

        return output

# =========================
# 🔥 Offline Pitch (紅線)
# =========================

def process_f0(y, sr, target_len=100):

    # 確保 float32
    if y.dtype != np.float32:
        y = y.astype(np.float32)

    # SwiftF0
    result = detector.detect_from_array(y, sr)

    pitch = result.pitch_hz
    conf = result.confidence

    # 濾除低信心與異常頻率
    pitch[conf < 0.5] = 0
    pitch[pitch < 50] = 0

    # 中值濾波
    pitch = scipy.signal.medfilt(pitch, kernel_size=5)

    # 正規化
    if np.any(pitch > 0):

        f_log = np.where(pitch > 0, np.log2(pitch), 0)

        p_min, p_max = np.log2(65), np.log2(400)

        norm_f = (f_log - p_min) / (p_max - p_min) * 60 + 20

        nonzero_idx = np.where(norm_f > 0)[0]
        f_valid = norm_f[nonzero_idx]

        if len(f_valid) > 5:

            xp = np.linspace(0, len(f_valid) - 1, target_len)

            final_curve = np.interp(
                xp,
                np.arange(len(f_valid)),
                f_valid
            )

            return final_curve.tolist()

    return [0] * target_len

def process_f0_v2(y, sr, target_len=300):
    if y.dtype != np.float32:
        y = y.astype(np.float32)

    result = detector.detect_from_array(y, sr)
    pitch = result.pitch_hz
    conf = result.confidence

    # 濾除低信心與異常頻率 (Use slightly higher threshold for stability)
    pitch[conf < 0.55] = 0
    pitch[pitch < 50] = 0

    # Apply median filter to raw pitch to remove isolated spikes and unstable onsets
    pitch_filtered = scipy.signal.medfilt(pitch, kernel_size=5)
    
    nonzero_idx = np.where(pitch_filtered > 0)[0]
    if len(nonzero_idx) < 10:
        return [0] * target_len
        
    start_idx = nonzero_idx[0]
    end_idx = nonzero_idx[-1]
    
    trimmed_pitch = pitch_filtered[start_idx:end_idx+1]
    
    # Interpolate internal silences
    valid_mask = trimmed_pitch > 0
    valid_idx = np.where(valid_mask)[0]
    valid_vals = trimmed_pitch[valid_mask]
    
    if len(valid_vals) < 5:
        return [0] * target_len
        
    full_idx = np.arange(len(trimmed_pitch))
    interpolated_pitch = np.interp(full_idx, valid_idx, valid_vals)
    
    # Smooth again after interpolation
    smoothed_pitch = scipy.signal.medfilt(interpolated_pitch, kernel_size=5)
    
    # Scale to 0-100 (matching blue curve scale concept)
    p_log = np.log2(smoothed_pitch)
    p_min, p_max = np.log2(65), np.log2(400)
    norm_pitch = (p_log - p_min) / (p_max - p_min) * 100
    
    # Resample to target_len
    xp = np.linspace(0, len(norm_pitch) - 1, target_len)
    final_curve = np.interp(xp, np.arange(len(norm_pitch)), norm_pitch)
    
    return final_curve.tolist()

def process_f0_v3(y, sr, target_len=300, conf_thresh=0.55, kernel_size=3):
    if y.dtype != np.float32:
        y = y.astype(np.float32)

    result = detector.detect_from_array(y, sr)
    pitch = result.pitch_hz
    conf = result.confidence

    # 濾除低信心與異常頻率
    pitch[conf < conf_thresh] = 0
    pitch[pitch < 50] = 0

    # Find boundaries (trim silence)
    nonzero_idx = np.where(pitch > 0)[0]
    if len(nonzero_idx) < 10:
        return [0] * target_len
        
    start_idx = nonzero_idx[0]
    end_idx = nonzero_idx[-1]
    
    trimmed_pitch = pitch[start_idx:end_idx+1]
    
    # Interpolate internal silences BEFORE smoothing
    valid_mask = trimmed_pitch > 0
    valid_idx = np.where(valid_mask)[0]
    valid_vals = trimmed_pitch[valid_mask]
    
    if len(valid_vals) < 5:
        return [0] * target_len
        
    full_idx = np.arange(len(trimmed_pitch))
    interpolated_pitch = np.interp(full_idx, valid_idx, valid_vals)
    
    # Apply median filter after interpolation
    smoothed_pitch = scipy.signal.medfilt(interpolated_pitch, kernel_size=kernel_size)
    
    # Scale to 0-100 (matching blue curve scale concept)
    p_log = np.log2(smoothed_pitch)
    p_min, p_max = np.log2(65), np.log2(400)
    norm_pitch = (p_log - p_min) / (p_max - p_min) * 100
    
    # Resample to target_len
    xp = np.linspace(0, len(norm_pitch) - 1, target_len)
    final_curve = np.interp(xp, np.arange(len(norm_pitch)), norm_pitch)
    
    return final_curve.tolist()

# =========================
# 🔥 評分系統
# =========================

def compute_score(user_curve, target_curve):
    try:
        def force_flatten(data):
            flat_list = []
            if data is None: return []
            stack = [data]
            while stack:
                curr = stack.pop()
                if isinstance(curr, (list, tuple, np.ndarray)):
                    stack.extend(reversed(curr))
                else:
                    try:
                        val = float(curr)
                        if np.isfinite(val): flat_list.append(val)
                    except: continue
            return flat_list

        user_clean = force_flatten(user_curve)
        target_clean = force_flatten(target_curve)

        # 💡 核心修正：強制轉為 C-contiguous 的一維 float64 陣列
        user_arr = np.ascontiguousarray(user_clean, dtype=np.float64)
        target_arr = np.ascontiguousarray(target_clean, dtype=np.float64)

        if len(user_arr) < 5 or len(target_arr) < 5:
            return 0.0

        # 計算 DTW
        dist, _ = fastdtw(user_arr, target_arr, dist=euclidean)
        
        # 慈悲評分公式
        avg_dist = dist / len(target_arr)
        shape_score = np.exp(-0.05 * avg_dist)
        voicing_ratio = np.mean(user_arr > 0)
        
        final = (0.6 * shape_score + 0.4 * voicing_ratio) * 100
        if voicing_ratio > 0.1:
            final = max(final, 68 + shape_score * 12)

        return float(min(100, final))
    except Exception as e:
        print(f"CRITICAL SCORE ERROR: {e}")
        return 0.0

# =========================
# 🔧 FastAPI Setup
# =========================

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

supabase: Client = create_client(
    os.getenv("SUPABASE_URL"),
    os.getenv("SUPABASE_KEY")
)

# =========================
# 📄 Models
# =========================

class WorkspaceCreate(BaseModel):
    student_name: str

class CardCreate(BaseModel):
    workspace_id: str
    chinese_text: str
    pinyin: str = ""
    english_text: str = ""
    note: str = ""

class ScoreRequest(BaseModel):
    user_curve: List  # 💡 改成 List，不要指定 float，讓後端自己洗
    target_curve: List

# =========================
# 🎤 Audio Curve
# =========================

async def get_audio_curve(audio_bytes: bytes, filename: str):

    temp_input = f"temp_input_{os.getpid()}_{filename}"
    temp_wav = f"temp_output_{os.getpid()}.wav"

    try:

        # 儲存原始錄音
        with open(temp_input, "wb") as f:
            f.write(audio_bytes)

        # 轉 wav
        audio = AudioSegment.from_file(temp_input)
        audio.export(temp_wav, format="wav")

        # 載入音訊
        y, sr = librosa.load(temp_wav, sr=16000)

        # 使用原本 F0 pipeline
        curve = process_f0(y, sr)

        # 清除 temp
        if os.path.exists(temp_input):
            os.remove(temp_input)

        if os.path.exists(temp_wav):
            os.remove(temp_wav)

        return curve

    except Exception as e:

        print("Audio curve error:", e)

        # 避免 temp 檔殘留
        if os.path.exists(temp_input):
            os.remove(temp_input)

        if os.path.exists(temp_wav):
            os.remove(temp_wav)

        return [0] * 100

async def get_audio_curve_v2(audio_bytes: bytes, filename: str):
    temp_input = f"temp_input_v2_{os.getpid()}_{filename}"
    temp_wav = f"temp_output_v2_{os.getpid()}.wav"

    try:
        with open(temp_input, "wb") as f:
            f.write(audio_bytes)

        audio = AudioSegment.from_file(temp_input)
        audio.export(temp_wav, format="wav")

        y, sr = librosa.load(temp_wav, sr=16000)

        curve = process_f0_v2(y, sr)

        if os.path.exists(temp_input):
            os.remove(temp_input)

        if os.path.exists(temp_wav):
            os.remove(temp_wav)

        return curve

    except Exception as e:
        print("Audio curve v2 error:", e)
        if os.path.exists(temp_input):
            os.remove(temp_input)
        if os.path.exists(temp_wav):
            os.remove(temp_wav)
        return [0] * 300

async def get_audio_curve_v3(audio_bytes: bytes, filename: str):
    temp_input = f"temp_input_v3_{os.getpid()}_{filename}"
    temp_wav = f"temp_output_v3_{os.getpid()}.wav"

    try:
        with open(temp_input, "wb") as f:
            f.write(audio_bytes)

        audio = AudioSegment.from_file(temp_input)
        audio.export(temp_wav, format="wav")

        y, sr = librosa.load(temp_wav, sr=16000)

        curve = process_f0_v3(y, sr)

        if os.path.exists(temp_input):
            os.remove(temp_input)

        if os.path.exists(temp_wav):
            os.remove(temp_wav)

        return curve

    except Exception as e:
        print("Audio curve v3 error:", e)
        if os.path.exists(temp_input):
            os.remove(temp_input)
        if os.path.exists(temp_wav):
            os.remove(temp_wav)
        return [0] * 300

# =========================
# 🎤 TTS Curve
# =========================

async def get_tts_curve(text: str):

    temp_file = f"temp_{os.getpid()}.wav"

    try:

        communicate = edge_tts.Communicate(
            text,
            "zh-TW-YunJheNeural"
        )

        await communicate.save(temp_file)

        y, sr = librosa.load(temp_file, sr=16000)

        curve = process_f0(y, sr)

        os.remove(temp_file)

        return curve

    except Exception as e:

        print("TTS curve error:", e)

        return [0] * 50

# =========================
# 🚀 API
# =========================

@app.get("/")
async def root():
    return {"message": "NYCU Speech Lab Server is running!"}

# =========================
# Workspace
# =========================

@app.post("/workspaces")
async def create_workspace(data: WorkspaceCreate):

    try:

        response = supabase.table("workspaces").insert({
            "student_name": data.student_name
        }).execute()

        new_workspace = response.data[0]

        token = new_workspace["access_token"]

        invite_url = f"http://localhost:5173/workspace/{token}"

        return {
            "status": "success",
            "invite_url": invite_url,
            "workspace_id": new_workspace["id"]
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/workspaces/{token}")
async def get_workspace(token: str):

    res = supabase.table("workspaces") \
        .select("*") \
        .eq("access_token", token) \
        .execute()

    if not res.data:
        raise HTTPException(status_code=404, detail="找不到該學習空間")

    return res.data[0]

# =========================
# Cards
# =========================

@app.post("/cards/batch")
async def create_cards_batch(
    data: str = Form(...),  # 將 None 改為 ... (Ellipsis)，表示此為必填 Form 欄位
    audio: UploadFile = File(None)
):
    try:
        # 增加檢查，確保 data 不是空的或 None
        if not data:
            raise ValueError("Data field is empty")
        cards_list = json.loads(data)

        cards_data = []

        audio_url = None
        audio_content = None

        # 有錄音
        if audio:

            file_path = f"audios/{os.getpid()}_{audio.filename}"

            audio_content = await audio.read()

            supabase.storage.from_("card-audios").upload(
                file_path,
                audio_content,
                file_options={
                    "upsert": "true",
                    "content-type": audio.content_type
                }
            )

            audio_url = supabase.storage.from_("card-audios") \
                .get_public_url(file_path)

        for card_json in cards_list:

            text = card_json.get("chinese_text")

            # 避免空字卡
            if not text:
                continue

            # 🔥 有錄音 -> 用錄音當紅線
            if audio and audio_content:

                curve = await get_audio_curve(
                    audio_content,
                    audio.filename
                )

            # 🔥 沒錄音 -> 使用 TTS
            else:

                curve = await get_tts_curve(text)

            cards_data.append({
                "workspace_id": card_json.get("workspace_id"),
                "chinese_text": text,
                "pinyin": card_json.get("pinyin", ""),
                "english_text": card_json.get("english_text", ""),
                "note": card_json.get("note", ""),
                "target_curve": curve,
                "audio_url": audio_url
            })

        response = supabase.table("cards") \
            .insert(cards_data) \
            .execute()

        return {
            "status": "success",
            "count": len(response.data)
        }

    except Exception as e:

        print(f"Batch Error: {e}")

        raise HTTPException(
            status_code=500,
            detail=str(e)
        )

@app.get("/workspaces/{workspace_id}/cards")
async def get_cards(workspace_id: str):

    res = supabase.table("cards") \
        .select("*") \
        .eq("workspace_id", workspace_id) \
        .order("created_at") \
        .execute()

    return res.data

@app.post("/cards/delete/{card_id}")
async def delete_card(card_id: str):

    supabase.table("cards") \
        .delete() \
        .eq("id", card_id) \
        .execute()

    return {"status": "success"}

@app.post("/cards/update/{card_id}")
async def update_card(
    card_id: str,
    data: str = Form(...),
    audio: UploadFile = File(None)
):

    try:

        card_json = json.loads(data)

        text = card_json.get("chinese_text")

        # 🔥 有錄音 -> 用錄音畫紅線
        if audio:

            audio_content = await audio.read()

            curve = await get_audio_curve(
                audio_content,
                audio.filename
            )

        # 🔥 沒錄音 -> TTS
        else:

            curve = await get_tts_curve(text)

        update_dict = {
            "chinese_text": text,
            "pinyin": card_json.get("pinyin"),
            "english_text": card_json.get("english_text"),
            "note": card_json.get("note"),
            "target_curve": curve
        }

        # 有錄音 -> 更新音檔
        if audio:

            file_path = f"audios/upd_{card_id}_{audio.filename}"

            supabase.storage.from_("card-audios").upload(
                file_path,
                audio_content,
                file_options={
                    "upsert": "true",
                    "content-type": audio.content_type
                }
            )

            update_dict["audio_url"] = \
                supabase.storage.from_("card-audios") \
                .get_public_url(file_path)

        supabase.table("cards") \
            .update(update_dict) \
            .eq("id", card_id) \
            .execute()

        return {"status": "success"}

    except Exception as e:

        print(f"Update Error: {e}")

        raise HTTPException(
            status_code=500,
            detail=str(e)
        )

@app.post("/cards/repair")
async def repair_all_cards():

    res = supabase.table("cards") \
        .select("id, chinese_text") \
        .is_("target_curve", "null") \
        .execute()

    count = 0

    for card in res.data:

        curve = await get_tts_curve(
            card["chinese_text"]
        )

        supabase.table("cards").update({
            "target_curve": curve
        }).eq("id", card["id"]).execute()

        count += 1

    return {
        "status": "success",
        "repaired_count": count
    }

# =========================
# Pitch API
# =========================

@app.post("/get_pitch")
async def get_pitch(file: UploadFile = File(...)):
    try:
        audio_bytes = await file.read()
        curve = await get_audio_curve(audio_bytes, file.filename)
        return curve
    except Exception as e:
        print("pitch error:", e)
        return [0] * 100

class UrlRequest(BaseModel):
    audio_url: str

@app.post("/get_pitch_from_url")
async def get_pitch_from_url(req: UrlRequest):
    try:
        response = requests.get(req.audio_url)
        if response.status_code != 200:
            raise HTTPException(status_code=400, detail=f"Failed to download audio from URL. Status: {response.status_code}")
        
        audio_bytes = response.content
        filename = req.audio_url.split('/')[-1].split('?')[0]
        if not filename:
            filename = "baseline.mp4"
            
        curve = await get_audio_curve(audio_bytes, filename)
        return curve
    except Exception as e:
        print("pitch_from_url error:", e)
        return [0] * 100

@app.post("/get_pitch_from_url_v2")
async def get_pitch_from_url_v2(req: UrlRequest):
    try:
        response = requests.get(req.audio_url)
        if response.status_code != 200:
            raise HTTPException(status_code=400, detail=f"Failed to download audio from URL. Status: {response.status_code}")
        
        audio_bytes = response.content
        filename = req.audio_url.split('/')[-1].split('?')[0]
        if not filename:
            filename = "baseline.mp4"
            
        curve = await get_audio_curve_v2(audio_bytes, filename)
        return curve
    except Exception as e:
        print("pitch_from_url_v2 error:", e)
        return [0] * 300

@app.post("/get_pitch_from_url_v3")
async def get_pitch_from_url_v3(req: UrlRequest):
    try:
        response = requests.get(req.audio_url)
        if response.status_code != 200:
            raise HTTPException(status_code=400, detail=f"Failed to download audio from URL. Status: {response.status_code}")
        
        audio_bytes = response.content
        filename = req.audio_url.split('/')[-1].split('?')[0]
        if not filename:
            filename = "baseline.mp4"
            
        curve = await get_audio_curve_v3(audio_bytes, filename)
        return curve
    except Exception as e:
        print("pitch_from_url_v3 error:", e)
        return [0] * 300

# =========================
# Score API
# =========================

@app.post("/score")
async def score(req: ScoreRequest):
    # 💡 這樣 req.user_curve 才能完整帶著嵌套層級進到 compute_score
    val = compute_score(req.user_curve, req.target_curve)
    return {"score": round(val, 1)}
    
# =========================
# 🔴 WebSocket
# =========================

@app.websocket("/ws/pitch")
async def websocket_pitch(ws: WebSocket):

    await ws.accept()

    processor = RealtimePitchProcessor()

    try:

        while True:

            data = await ws.receive_bytes()

            audio = np.frombuffer(
                data,
                dtype=np.float32
            )

            pitch = processor.process(audio)

            await ws.send_json(pitch)

    except WebSocketDisconnect:

        print("INFO: Client disconnected normally.")

    except Exception as e:

        print(f"WS error: {e}")

# =========================
# Convert to MP3
# =========================

@app.post("/convert_to_mp3")
async def convert_to_mp3(file: UploadFile = File(...)):

    # 讀取 webm
    webm_data = await file.read()

    # webm -> audio
    audio = AudioSegment.from_file(
        io.BytesIO(webm_data),
        format="webm"
    )

    # audio -> mp3
    mp3_buffer = io.BytesIO()

    audio.export(
        mp3_buffer,
        format="mp3",
        bitrate="192k"
    )

    mp3_buffer.seek(0)

    # 回傳 mp3
    return StreamingResponse(
        mp3_buffer,
        media_type="audio/mpeg",
        headers={
            "Content-Disposition":
            "attachment; filename=recording.mp3"
        }
    )
