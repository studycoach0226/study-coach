from fastapi import FastAPI, HTTPException, UploadFile, File, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from dotenv import load_dotenv
import os
from supabase import create_client, Client
from typing import List, Optional
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

def process_f0_v3(y, sr, target_len=300, conf_thresh=0.55, kernel_size=3, ignore_start_ms=200, stable_window=5, max_stable_jump=20.0, drop_first_n_points=0, leading_plateau_window=50, plateau_jump_threshold=15.0, plateau_low_percentile_threshold=30, min_points_after_trim=30, min_freq=50.0, energy_thresh=None, min_voiced_ms=None):
    if y.dtype != np.float32:
        y = y.astype(np.float32)

    result = detector.detect_from_array(y, sr)
    pitch = result.pitch_hz
    conf = result.confidence

    # 濾除低信心與異常頻率
    pitch[conf < conf_thresh] = 0
    pitch[pitch < min_freq] = 0

    # Optional RMS energy threshold filtering
    if energy_thresh is not None and len(pitch) > 0:
        hop_size = max(1, len(y) // len(pitch))
        for i in range(len(pitch)):
            chunk = y[i * hop_size : (i + 1) * hop_size]
            rms = np.sqrt(np.mean(chunk**2)) if len(chunk) > 0 else 0.0
            if rms < energy_thresh:
                pitch[i] = 0.0

    # Optional continuous voiced duration check
    if min_voiced_ms is not None and len(pitch) > 0:
        frame_duration_ms = (len(y) / sr * 1000.0) / len(pitch)
        
        # Find the longest contiguous sequence of voiced frames (pitch > 0)
        longest_run = 0
        current_run = 0
        for is_voiced in (pitch > 0):
            if is_voiced:
                current_run += 1
                if current_run > longest_run:
                    longest_run = current_run
            else:
                current_run = 0
                
        max_voiced_duration_ms = longest_run * frame_duration_ms
        if max_voiced_duration_ms < min_voiced_ms:
            return [0] * target_len

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
    
    # 🔥 New: Use cubic spline interpolation to avoid flat bottoms
    from scipy.interpolate import interp1d
    if len(valid_idx) >= 4:
        try:
            f = interp1d(valid_idx, valid_vals, kind='cubic', bounds_error=False, fill_value="extrapolate")
            interpolated_pitch = f(full_idx)
        except Exception as e:
            print(f"Cubic interpolation failed: {e}. Falling back to linear.")
            interpolated_pitch = np.interp(full_idx, valid_idx, valid_vals)
    else:
        interpolated_pitch = np.interp(full_idx, valid_idx, valid_vals)
    
    # Apply median filter after interpolation
    smoothed_pitch = scipy.signal.medfilt(interpolated_pitch, kernel_size=kernel_size)
    
    # 🔥 New: Apply Savitzky-Golay filter to smooth transitions into natural curves
    try:
        win_len = min(11, len(smoothed_pitch))
        if win_len % 2 == 0: win_len -= 1
        if win_len >= 5:
            smoothed_pitch = scipy.signal.savgol_filter(smoothed_pitch, window_length=win_len, polyorder=2)
    except Exception as e:
        print(f"Savgol filter failed: {e}")
    
    # Scale to 0-100 (matching blue curve scale concept)
    p_log = np.log2(smoothed_pitch)
    p_min, p_max = np.log2(65), np.log2(400)
    norm_pitch = (p_log - p_min) / (p_max - p_min) * 100
    
    # 🔥 New Shape-Based Plateau Trimming
    inspect_len = min(leading_plateau_window, len(norm_pitch))
    if inspect_len > 10:
        # Calculate consecutive differences in the window
        diffs = np.diff(norm_pitch[:inspect_len])
        
        # Find the first jump that exceeds the threshold
        large_jumps = np.where(diffs > plateau_jump_threshold)[0]
        
        if len(large_jumps) > 0:
            jump_idx = large_jumps[0]
            
            # The plateau candidate is the segment before the jump
            plateau = norm_pitch[:jump_idx + 1]
            
            # Condition 1: Is it a "low" segment?
            low_threshold = np.percentile(norm_pitch, plateau_low_percentile_threshold)
            is_low = np.mean(plateau) < low_threshold
            
            # Condition 2: Is it "flat"? (Small standard deviation)
            is_flat = np.std(plateau) < 5.0 # Max variance allowed for a plateau
            
            # Condition 3: Do we have enough points left after trimming?
            has_enough_left = (len(norm_pitch) - (jump_idx + 1)) >= min_points_after_trim
            
            if is_low and is_flat and has_enough_left:
                # Cut the plateau!
                norm_pitch = norm_pitch[jump_idx + 1:]

    # Resample to target_len
    xp = np.linspace(0, len(norm_pitch) - 1, target_len)
    final_curve = np.interp(xp, np.arange(len(norm_pitch)), norm_pitch)
    
    return final_curve.tolist()

def find_voiced_region_v4(pitch, energy, energy_thresh=None, onset_frames=8, offset_frames=20, ignore_start_frames=0):
    n = len(pitch)
    if energy_thresh is not None and energy_thresh > 0:
        is_active = energy > energy_thresh
    else:
        is_active = pitch > 0

    # Ensure ignore_start_frames is within safe bounds
    safe_ignore = min(ignore_start_frames, max(0, n - 1))

    # Force the ignored startup frames to be inactive so they cannot trigger onset
    if safe_ignore > 0:
        is_active = np.copy(is_active)
        is_active[:safe_ignore] = False

    # 1. Find start_idx
    start_idx = safe_ignore
    for i in range(safe_ignore, n - onset_frames + 1):
        if np.all(is_active[i : i + onset_frames]):
            start_idx = i
            break
    else:
        # Fallback if no continuous active onset is found:
        # Just use the first active frame after ignore_start_frames
        nonzero = np.where(is_active[safe_ignore:])[0]
        if len(nonzero) > 0:
            start_idx = safe_ignore + nonzero[0]
        else:
            return safe_ignore, n - 1

    # 2. Find end_idx from start_idx forward
    end_idx = n - 1
    # We look for a continuous inactive run of length offset_frames
    for j in range(start_idx, n - offset_frames + 1):
        if np.all(~is_active[j : j + offset_frames]):
            # The active region ends at the last active frame before this silence run
            active_before = np.where(is_active[start_idx : j])[0]
            if len(active_before) > 0:
                end_idx = start_idx + active_before[-1]
            else:
                end_idx = j - 1
            break
    else:
        # Fallback if no trailing inactive run is found:
        # Just use the last active frame after start_idx
        nonzero = np.where(is_active[start_idx:])[0]
        if len(nonzero) > 0:
            end_idx = start_idx + nonzero[-1]

    return start_idx, end_idx

def process_f0_v4(
    y, sr,
    target_len=300,
    conf_thresh=0.55,
    min_freq=50.0,
    energy_thresh=0.015,
    min_voiced_ms=None,
    kernel_size=3,
    onset_frames=20,
    offset_frames=20,
    ignore_start_frames=25
):
    """
    New V4: "voiced-region-first green line experiment".
    Finds the continuous speech boundaries using consecutive active energy runs,
    crops the pitch array to that region, and then smooths & resamples.

    --------------------------------------------------------------------------
    Old process_f0_v4 (Experimental Valley Bending / PCHIP) kept for reference:
    --------------------------------------------------------------------------
    # def process_f0_v4(y, sr, target_len=300, conf_thresh=0.55, kernel_size=3, ignore_start_ms=200, stable_window=5, max_stable_jump=20.0, drop_first_n_points=0, leading_plateau_window=50, plateau_jump_threshold=15.0, plateau_low_percentile_threshold=30, min_points_after_trim=30):
    #     if y.dtype != np.float32:
    #         y = y.astype(np.float32)
    # 
    #     result = detector.detect_from_array(y, sr)
    #     pitch = result.pitch_hz
    #     conf = result.confidence
    # 
    #     pitch[conf < conf_thresh] = 0
    #     pitch[pitch < 50] = 0
    # 
    #     nonzero_idx = np.where(pitch > 0)[0]
    #     if len(nonzero_idx) < 10:
    #         return [0] * target_len
    #         
    #     start_idx = nonzero_idx[0]
    #     end_idx = nonzero_idx[-1]
    #     
    #     trimmed_pitch = pitch[start_idx:end_idx+1]
    #     
    #     valid_mask = trimmed_pitch > 0
    #     valid_idx = np.where(valid_mask)[0]
    #     valid_vals = trimmed_pitch[valid_mask]
    #     
    #     if len(valid_vals) < 5:
    #         return [0] * target_len
    #         
    #     full_idx = np.arange(len(trimmed_pitch))
    # 
    #     low_thresh = np.percentile(valid_vals, 30) if len(valid_vals) > 0 else 100
    #     
    #     gap_regions = []
    #     current_gap = []
    #     for i in range(len(trimmed_pitch)):
    #         if trimmed_pitch[i] == 0:
    #             current_gap.append(i)
    #         else:
    #             if len(current_gap) >= 10:
    #                 gap_regions.append(current_gap)
    #             current_gap = []
    #     if len(current_gap) >= 10:
    #         gap_regions.append(current_gap)
    #         
    #     new_idx = list(valid_idx)
    #     new_vals = list(valid_vals)
    #     
    #     for gap in gap_regions:
    #         idx_A = gap[0] - 1
    #         idx_B = gap[-1] + 1
    #         if idx_A >= 0 and idx_B < len(trimmed_pitch):
    #             val_A = trimmed_pitch[idx_A]
    #             val_B = trimmed_pitch[idx_B]
    #             if val_A < low_thresh and val_B < low_thresh:
    #                 idx_mid = (gap[0] + gap[-1]) // 2
    #                 val_mid = min(val_A, val_B) - 10.0
    #                 if val_mid < 50: val_mid = 50
    #                 new_idx.append(idx_mid)
    #                 new_vals.append(val_mid)
    #                 
    #     if len(new_idx) > len(valid_idx):
    #         combined = sorted(zip(new_idx, new_vals))
    #         valid_idx = np.array([x[0] for x in combined])
    #         valid_vals = np.array([x[1] for x in combined])
    #     
    #     from scipy.interpolate import PchipInterpolator
    #     if len(valid_idx) >= 4:
    #         try:
    #             f = PchipInterpolator(valid_idx, valid_vals, extrapolate=True)
    #             interpolated_pitch = f(full_idx)
    #         except Exception as e:
    #             print(f"PCHIP interpolation failed: {e}. Falling back to linear.")
    #             interpolated_pitch = np.interp(full_idx, valid_idx, valid_vals)
    #     else:
    #         interpolated_pitch = np.interp(full_idx, valid_idx, valid_vals)
    #     
    #     smoothed_pitch = scipy.signal.medfilt(interpolated_pitch, kernel_size=kernel_size)
    #     
    #     try:
    #         win_len = min(11, len(smoothed_pitch))
    #         if win_len % 2 == 0: win_len -= 1
    #         if win_len >= 5:
    #             smoothed_pitch = scipy.signal.savgol_filter(smoothed_pitch, window_length=win_len, polyorder=2)
    #     except Exception as e:
    #         print(f"Savgol filter failed: {e}")
    #     
    #     p_log = np.log2(smoothed_pitch)
    #     p_min, p_max = np.log2(65), np.log2(400)
    #     norm_pitch = (p_log - p_min) / (p_max - p_min) * 100
    #     
    #     inspect_len = min(leading_plateau_window, len(norm_pitch))
    #     if inspect_len > 10:
    #         diffs = np.diff(norm_pitch[:inspect_len])
    #         large_jumps = np.where(diffs > plateau_jump_threshold)[0]
    #         
    #         if len(large_jumps) > 0:
    #             jump_idx = large_jumps[0]
    #             plateau = norm_pitch[:jump_idx + 1]
    #             low_threshold = np.percentile(norm_pitch, plateau_low_percentile_threshold)
    #             is_low = np.mean(plateau) < low_threshold
    #             is_flat = np.std(plateau) < 5.0
    #             has_enough_left = (len(norm_pitch) - (jump_idx + 1)) >= min_points_after_trim
    #             
    #             if is_low and is_flat and has_enough_left:
    #                 norm_pitch = norm_pitch[jump_idx + 1:]
    # 
    #     xp = np.linspace(0, len(norm_pitch) - 1, target_len)
    #     final_curve = np.interp(xp, np.arange(len(norm_pitch)), norm_pitch)
    #     
    #     return final_curve.tolist()
    """
    # 確保 float32
    if y.dtype != np.float32:
        y = y.astype(np.float32)

    # SwiftF0
    result = detector.detect_from_array(y, sr)
    pitch = result.pitch_hz
    conf = result.confidence

    # 1. 濾除低信心與異常頻率
    pitch[conf < conf_thresh] = 0
    pitch[pitch < min_freq] = 0

    # Calculate RMS energy for each frame
    energy = np.zeros(len(pitch))
    if len(pitch) > 0:
        hop_size = max(1, len(y) // len(pitch))
        for i in range(len(pitch)):
            chunk = y[i * hop_size : (i + 1) * hop_size]
            energy[i] = np.sqrt(np.mean(chunk**2)) if len(chunk) > 0 else 0.0

    # If energy_thresh is provided, set pitch to 0.0 for frames below threshold
    if energy_thresh is not None and energy_thresh > 0:
        pitch[energy < energy_thresh] = 0.0

    # Optional continuous voiced duration check
    if min_voiced_ms is not None and len(pitch) > 0:
        frame_duration_ms = (len(y) / sr * 1000.0) / len(pitch)
        longest_run = 0
        current_run = 0
        for is_voiced in (pitch > 0):
            if is_voiced:
                current_run += 1
                if current_run > longest_run:
                    longest_run = current_run
            else:
                current_run = 0
        max_voiced_duration_ms = longest_run * frame_duration_ms
        if max_voiced_duration_ms < min_voiced_ms:
            return [0] * target_len

    # 2. Find boundaries using find_voiced_region_v4 (energy-based)
    start_idx, end_idx = find_voiced_region_v4(pitch, energy, energy_thresh=energy_thresh, onset_frames=onset_frames, offset_frames=offset_frames, ignore_start_frames=ignore_start_frames)

    # If no voiced points are found in the region, return zero curve
    nonzero_idx = np.where(pitch[start_idx:end_idx+1] > 0)[0]
    valid_pitch_count_after_crop = len(nonzero_idx)

    if valid_pitch_count_after_crop < 10:
        res_curve = [0] * target_len
    else:
        trimmed_pitch = pitch[start_idx:end_idx+1]

        # 3. Interpolate internal silences (using cubic spline, matching V3 behavior)
        valid_mask = trimmed_pitch > 0
        valid_idx = np.where(valid_mask)[0]
        valid_vals = trimmed_pitch[valid_mask]

        if len(valid_vals) < 5:
            res_curve = [0] * target_len
        else:
            full_idx = np.arange(len(trimmed_pitch))

            from scipy.interpolate import interp1d
            if len(valid_idx) >= 4:
                try:
                    f = interp1d(valid_idx, valid_vals, kind='cubic', bounds_error=False, fill_value="extrapolate")
                    interpolated_pitch = f(full_idx)
                except Exception as e:
                    print(f"Cubic interpolation failed in V4: {e}. Falling back to linear.")
                    interpolated_pitch = np.interp(full_idx, valid_idx, valid_vals)
            else:
                interpolated_pitch = np.interp(full_idx, valid_idx, valid_vals)

            # 4. Smooth using median filter
            smoothed_pitch = scipy.signal.medfilt(interpolated_pitch, kernel_size=kernel_size)

            # Savitzky-Golay filter
            try:
                win_len = min(11, len(smoothed_pitch))
                if win_len % 2 == 0: win_len -= 1
                if win_len >= 5:
                    smoothed_pitch = scipy.signal.savgol_filter(smoothed_pitch, window_length=win_len, polyorder=2)
            except Exception as e:
                print(f"Savgol filter failed in V4: {e}")

            # 5. Normalized log scale
            p_log = np.log2(smoothed_pitch)
            p_min, p_max = np.log2(65), np.log2(400)
            norm_pitch = (p_log - p_min) / (p_max - p_min) * 100

            # Resample to target_len
            xp = np.linspace(0, len(norm_pitch) - 1, target_len)
            final_curve = np.interp(xp, np.arange(len(norm_pitch)), norm_pitch)
            res_curve = final_curve.tolist()

    # V4 DEBUG PRINTING
    is_all_zeros = all(val == 0.0 for val in res_curve)
    curve_min = min(res_curve) if len(res_curve) > 0 else 0.0
    curve_max = max(res_curve) if len(res_curve) > 0 else 0.0

    print(f"[V4 BACKEND DEBUG] ignore_start_frames: {ignore_start_frames}")
    print(f"[V4 BACKEND DEBUG] energy_thresh: {energy_thresh}")
    print(f"[V4 BACKEND DEBUG] onset_frames: {onset_frames}")
    print(f"[V4 BACKEND DEBUG] offset_frames: {offset_frames}")
    print(f"[V4 BACKEND DEBUG] conf_thresh: {conf_thresh}")
    print(f"[V4 BACKEND DEBUG] min_freq: {min_freq}")
    print(f"[V4 BACKEND DEBUG] original pitch length: {len(pitch)}")
    print(f"[V4 BACKEND DEBUG] start_idx: {start_idx}, end_idx: {end_idx}")
    print(f"[V4 BACKEND DEBUG] cropped pitch length: {end_idx - start_idx + 1}")
    print(f"[V4 BACKEND DEBUG] valid pitch count after crop: {valid_pitch_count_after_crop}")
    print(f"[V4 BACKEND DEBUG] final curve min/max: {curve_min:.2f} / {curve_max:.2f}")
    print(f"[V4 BACKEND DEBUG] whether final curve is all zeros: {is_all_zeros}")

    return res_curve

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

        # 計算 DTW (使用絕對值距離，避免 scalar 造成 scipy.spatial.distance.euclidean 拋出 ValueError)
        dist, _ = fastdtw(user_arr, target_arr, dist=lambda a, b: abs(a - b))
        
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
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5175",
        "https://study-coach-66ae6.web.app",
        "https://study-coach-66ae6.firebaseapp.com"
    ],
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

async def get_audio_curve_v3(audio_bytes: bytes, filename: str, conf_thresh: float = 0.55, min_freq: float = 50.0, energy_thresh: Optional[float] = None, min_voiced_ms: Optional[float] = None):
    temp_input = f"temp_input_v3_{os.getpid()}_{filename}"
    temp_wav = f"temp_output_v3_{os.getpid()}.wav"

    try:
        with open(temp_input, "wb") as f:
            f.write(audio_bytes)

        audio = AudioSegment.from_file(temp_input)
        audio.export(temp_wav, format="wav")

        y, sr = librosa.load(temp_wav, sr=16000)

        curve = process_f0_v3(
            y, sr,
            conf_thresh=conf_thresh,
            min_freq=min_freq,
            energy_thresh=energy_thresh,
            min_voiced_ms=min_voiced_ms
        )

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

async def get_audio_curve_v4(
    audio_bytes: bytes,
    filename: str,
    conf_thresh: float = 0.55,
    min_freq: float = 50.0,
    energy_thresh: Optional[float] = None,
    min_voiced_ms: Optional[float] = None,
    ignore_start_frames: int = 25
):
    temp_input = f"temp_input_v4_{os.getpid()}_{filename}"
    temp_wav = f"temp_output_v4_{os.getpid()}.wav"

    try:
        with open(temp_input, "wb") as f:
            f.write(audio_bytes)

        audio = AudioSegment.from_file(temp_input)
        audio.export(temp_wav, format="wav")

        y, sr = librosa.load(temp_wav, sr=16000)

        curve = process_f0_v4(
            y, sr,
            conf_thresh=conf_thresh,
            min_freq=min_freq,
            energy_thresh=energy_thresh,
            min_voiced_ms=min_voiced_ms,
            ignore_start_frames=ignore_start_frames
        )

        if os.path.exists(temp_input):
            os.remove(temp_input)

        if os.path.exists(temp_wav):
            os.remove(temp_wav)

        return curve

    except Exception as e:
        print("Audio curve v4 error:", e)
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

@app.post("/get_pitch_v3")
async def get_pitch_v3(
    file: UploadFile = File(...),
    conf_thresh: Optional[float] = 0.55,
    min_freq: Optional[float] = 50.0,
    energy_thresh: Optional[float] = None,
    min_voiced_ms: Optional[float] = None
):
    try:
        print(f"INFO: /get_pitch_v3 params -> conf_thresh: {conf_thresh}, min_freq: {min_freq}, energy_thresh: {energy_thresh}, min_voiced_ms: {min_voiced_ms}")
        audio_bytes = await file.read()
        curve = await get_audio_curve_v3(
            audio_bytes,
            file.filename,
            conf_thresh=conf_thresh,
            min_freq=min_freq,
            energy_thresh=energy_thresh,
            min_voiced_ms=min_voiced_ms
        )
        return curve
    except Exception as e:
        print("pitch v3 error:", e)
        return [0] * 300

@app.post("/get_pitch_v2")
async def get_pitch_v2(file: UploadFile = File(...)):
    try:
        audio_bytes = await file.read()
        curve = await get_audio_curve_v2(audio_bytes, file.filename)
        return curve
    except Exception as e:
        print("pitch v2 error:", e)
        return [0] * 300

@app.post("/get_pitch_v4")
async def get_pitch_v4(
    file: UploadFile = File(...),
    conf_thresh: Optional[float] = 0.55,
    min_freq: Optional[float] = 50.0,
    energy_thresh: Optional[float] = None,
    min_voiced_ms: Optional[float] = None,
    ignore_start_frames: Optional[int] = 25
):
    try:
        audio_bytes = await file.read()
        curve = await get_audio_curve_v4(
            audio_bytes,
            file.filename,
            conf_thresh=conf_thresh,
            min_freq=min_freq,
            energy_thresh=energy_thresh,
            min_voiced_ms=min_voiced_ms,
            ignore_start_frames=ignore_start_frames
        )
        return curve
    except Exception as e:
        print("pitch v4 error:", e)
        return [0] * 300

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

@app.post("/get_pitch_from_url_v4")
async def get_pitch_from_url_v4(
    req: UrlRequest,
    conf_thresh: Optional[float] = 0.55,
    min_freq: Optional[float] = 50.0,
    energy_thresh: Optional[float] = None,
    min_voiced_ms: Optional[float] = None,
    ignore_start_frames: Optional[int] = 25
):
    try:
        response = requests.get(req.audio_url)
        if response.status_code != 200:
            raise HTTPException(status_code=400, detail=f"Failed to download audio from URL. Status: {response.status_code}")
        
        audio_bytes = response.content
        filename = req.audio_url.split('/')[-1].split('?')[0]
        if not filename:
            filename = "baseline.mp4"
            
        curve = await get_audio_curve_v4(
            audio_bytes,
            filename,
            conf_thresh=conf_thresh,
            min_freq=min_freq,
            energy_thresh=energy_thresh,
            min_voiced_ms=min_voiced_ms,
            ignore_start_frames=ignore_start_frames
        )
        return curve
    except Exception as e:
        print("pitch_from_url_v4 error:", e)
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

# =========================
# 🤖 AI Connection Suggestions Proxy
# =========================

class ConnectionSuggestionsRequest(BaseModel):
    word: str
    learningLanguage: str
    nativeLanguage: str
    chunk: str
    sentence: str
    knownWords: List[str]

SYSTEM_PROMPT = """You are a helpful language teacher providing concise memory connection notes for a student.
Your goal is to help the student connect the new word to sounds, shapes, meanings, usage, and words they already know.

STYLE GUIDELINES:
- Write short, clear, teacher-style memory notes.
- Use a step-by-step or breakdown style when useful.
- Use arrows (→), equals (=), plus (+), and colons (:) for clarity.
- Avoid long essay-like explanations.
- Each note can be 1-4 short lines.
- For English learners (Chinese speakers): Include Chinese support for roots/prefixes.
- For Chinese learners (English speakers): Always include pinyin and English meaning.

EXAMPLES:
1. English word "decide":
   de- = away / down (離開、往下)
   -cide = cut (切)
   decide = cut away other choices → make one choice
   中文記憶：把其他選項切掉，只留下一個決定。

2. Chinese word "中文":
   zhōng wén = Chinese language
   中 zhōng = middle
   文 wén = language / writing

JSON STRUCTURE:
Return an array of objects with:
- type (category name)
- relationshipTag (short label: meaning, sound, character, collocation, usage, root, shape)
- noteLine (the clear teacher-style note, can contain newlines if needed for multi-line notes)
- explanation (secondary brief context for understanding)
- optionalPronunciation (pinyin or IPA)
- optionalMeaning (English translation)

Return JSON only, no markdown."""

def generate_user_prompt(word, learning_language, native_language, chunk, sentence, known_words):
    known_str = ", ".join(known_words)
    return f"""
Target word: {word}
Learning language: {learning_language}
Student native language: {native_language}
Chunk / phrase: {chunk}
Full sentence / context: {sentence}
Known words student knows: {known_str}

Generate 4-6 high-quality, concise suggestions. Priority: Character breakdown/Roots, then Sound and Usage.
"""

@app.post("/ai/connection_suggestions")
async def get_connection_suggestions(req: ConnectionSuggestionsRequest):
    api_key = os.getenv("OPENAI_API_KEY")

    if not api_key:
        print("❌ Backend OpenAI API Key is missing.")
        raise HTTPException(status_code=500, detail="OpenAI API key is missing on the server.")

    user_content = generate_user_prompt(
        req.word,
        req.learningLanguage,
        req.nativeLanguage,
        req.chunk,
        req.sentence,
        req.knownWords
    )

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}"
    }

    payload = {
        "model": "gpt-4o-mini",
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_content}
        ],
        "temperature": 0.7
    }

    try:
        print(f"[Backend AI Suggestions] Sending request to OpenAI for word: {req.word}")
        response = requests.post("https://api.openai.com/v1/chat/completions", headers=headers, json=payload, timeout=30)
        
        print(f"[Backend AI Suggestions] OpenAI response status: {response.status_code}")
        
        if response.status_code != 200:
            print(f"❌ OpenAI API Error: {response.status_code} - {response.text}")
            raise HTTPException(status_code=500, detail=f"OpenAI API Error: {response.status_code}")

        res_data = response.json()
        content = res_data["choices"][0]["message"]["content"].strip()
        
        # Clean any markdown json wrapper
        cleaned_json = content.replace("```json", "").replace("```", "").strip()
        result = json.loads(cleaned_json)
        
        # Format mapping compatibility
        suggestions = []
        if isinstance(result, list):
            suggestions = result
        elif isinstance(result, dict) and "suggestions" in result and isinstance(result["suggestions"], list):
            suggestions = result["suggestions"]
            
        print(f"[Backend AI Suggestions] Success. Suggestions count: {len(suggestions)}")
        return suggestions
    except json.JSONDecodeError as je:
        print(f"❌ Failed to parse JSON from OpenAI response: {je}")
        raise HTTPException(status_code=500, detail="Failed to parse suggestions response from AI.")
    except Exception as e:
        print(f"❌ Backend AI connection suggestions error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# =========================
# 📚 Reading Practice AI Proxy Endpoints
# =========================

class GenerateMeaningRequest(BaseModel):
    word: str
    articleText: str

class EvaluateTextRequest(BaseModel):
    targetText: str
    transcriptionText: str
    taskType: str  # "explain" or "read"

def build_meaning_prompt(word: str, article_text: str) -> str:
    return f"""
You are an expert English-to-Traditional-Chinese translator.
Please explain the precise Traditional Chinese meaning of the target word based strictly on its usage in the provided article context.

Rules:
1. Return ONLY the short Traditional Chinese meaning.
2. Do NOT provide long explanations, pronunciation, or example sentences.
3. Your answer should be brief (e.g., "政府", "說服", "地區的").

Target word: "{word}"
Article context:
"{article_text}"
"""

def build_reading_explain_prompt(target_text: str, transcription_text: str) -> str:
    escaped_target = target_text.replace('"', '\\"')
    escaped_transcription = transcription_text.replace('"', '\\"')
    return f"""
你是一個英文閱讀助教，正在聽學生用中文解釋文章。

你的任務是幫學生檢查「理解程度」，並提供精準的參考答案與詳細評估。

請直接對學生說話，全部用「你」，不要說「學生」。

--------------------------------

評估要求與步驟：
1. 針對原文（英文文章），提供一份精準、自然、符合語境的繁體中文對照參考答案（即整篇文章的中文翻譯），放入 "reference_answer_zh" 欄位中。這個參考答案必須完全基於英文原文，不能受學生說的內容影響。
2. 比對學生的中文解釋內容與英文原文，評估學生的理解程度。
3. 評估以下四個面向（分數範圍 0-100）：
   - 完整度 (completeness): 有沒有講完整篇
   - 正確度 (accuracy): 每句理解是否正確
   - 細節度 (detail): 有沒有講到關鍵內容
   - 清楚度 (clarity): 表達是否清楚
4. 計算四個分數的平均值作為總分 "score" (0-100)。
5. 提供優點（"strengths"）與具體改進建議（"suggestions"）。
6. 指出學生漏掉或理解錯誤的關鍵內容（"missing_or_changed_content"）。

--------------------------------

原文：
"{escaped_target}"

學生說的內容：
"{escaped_transcription}"

--------------------------------

請嚴格回傳「JSON格式」，不要有任何 Markdown 標記或說明文字：

{{
  "student_transcript": "{escaped_transcription}",
  "reference_answer_zh": "整篇英文文章的繁體中文精準對照翻譯",
  "score": 85,
  "score_details": {{
    "completeness": 80,
    "accuracy": 90,
    "detail": 85,
    "clarity": 85
  }},
  "strengths": "你做得好的地方（簡短）",
  "suggestions": "具體改進建議（直接對學生說，用『你』）",
  "missing_or_changed_content": "你漏掉或講錯的關鍵點（簡短，如果沒有則寫『無』）"
}}
"""


def build_reading_read_prompt(target_text: str, transcription_text: str) -> str:
    escaped_transcription = transcription_text.replace('"', '\\"')
    return f"""
You are an English pronunciation coach talking directly to the student.
All feedback must be in Traditional Chinese, short, conversational, useful, not academic, and not overly descriptive.
Do NOT use "學生..." in feedback. Use "你..." directly.

Target sentence:
"{target_text}"

Student said (transcribed):
"{transcription_text}"

The most important criterion is completeness.

Evaluate in this order:
1. 完整度：有沒有念完整篇
2. 正確度：有沒有漏字、跳句、改字
3. 發音清楚度
4. 流暢度

Scoring rubric:
- 90–100: Complete reading, clear pronunciation, smooth fluency
- 75–89: Mostly complete, minor pronunciation or fluency issues
- 60–74: Complete or nearly complete, but several pronunciation/fluency issues
- 40–59: Significant omissions or many unclear parts
- 0–39: Reads only a small part, skips major sentences, or speech does not match target

Important:
Completeness is the first priority.
If the student only reads part of the article, score should usually be below 50 even if pronunciation is good.

Return ONLY JSON. All string values MUST be in Traditional Chinese and speak directly to the student using "你".
{{
  "type": "pronunciation",
  "score": number,
  "transcriptionText": "{escaped_transcription}",
  "completenessFeedback": string,
  "pronunciationFeedback": string,
  "fluencyFeedback": string,
  "missingOrChangedWords": string,
  "suggestion": string
}}
"""

@app.post("/ai/generate_meaning")
async def generate_meaning(req: GenerateMeaningRequest):
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        print("❌ Backend OpenAI API Key is missing.")
        raise HTTPException(status_code=500, detail="OpenAI API key is missing on the server.")

    prompt = build_meaning_prompt(req.word, req.articleText)
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}"
    }
    payload = {
        "model": "gpt-4o-mini",
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.2
    }
    try:
        print(f"[Backend AI Meaning] Fetching meaning for: {req.word}")
        res = requests.post("https://api.openai.com/v1/chat/completions", headers=headers, json=payload, timeout=30)
        if res.status_code != 200:
            print(f"❌ OpenAI API Error: {res.status_code} - {res.text}")
            raise HTTPException(status_code=res.status_code, detail=f"OpenAI API Error: {res.status_code}")
        
        res_data = res.json()
        content = res_data["choices"][0]["message"]["content"].strip()
        return {"meaning": content}
    except Exception as e:
        print(f"❌ Backend AI generate_meaning error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/ai/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        print("❌ Backend OpenAI API Key is missing.")
        raise HTTPException(status_code=500, detail="OpenAI API key is missing on the server.")

    headers = {
        "Authorization": f"Bearer {api_key}"
    }
    try:
        file_bytes = await file.read()
        files = {
            "file": (file.filename, file_bytes, file.content_type)
        }
        data = {
            "model": "whisper-1"
        }
        print(f"[Backend AI Transcribe] Transcribing file: {file.filename}, size: {len(file_bytes)} bytes")
        res = requests.post("https://api.openai.com/v1/audio/transcriptions", headers=headers, files=files, data=data, timeout=30)
        if res.status_code != 200:
            print(f"❌ OpenAI Transcription Error: {res.status_code} - {res.text}")
            raise HTTPException(status_code=res.status_code, detail=f"OpenAI API Error: {res.status_code}")
        return res.json()
    except Exception as e:
        print(f"❌ Backend AI transcribe error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/ai/evaluate_text")
async def evaluate_text(req: EvaluateTextRequest):
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        print("❌ Backend OpenAI API Key is missing.")
        raise HTTPException(status_code=500, detail="OpenAI API key is missing on the server.")

    if req.taskType == "explain":
        prompt = build_reading_explain_prompt(req.targetText, req.transcriptionText)
    elif req.taskType == "read":
        prompt = build_reading_read_prompt(req.targetText, req.transcriptionText)
    else:
        raise HTTPException(status_code=400, detail="Invalid taskType. Must be 'explain' or 'read'.")

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}"
    }
    payload = {
        "model": "gpt-4o-mini",
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.2
    }
    try:
        print(f"[Backend AI Evaluate] Evaluating text length: {len(req.transcriptionText)}, type: {req.taskType}")
        res = requests.post("https://api.openai.com/v1/chat/completions", headers=headers, json=payload, timeout=30)
        if res.status_code != 200:
            print(f"❌ OpenAI Evaluation Error: {res.status_code} - {res.text}")
            raise HTTPException(status_code=res.status_code, detail=f"OpenAI API Error: {res.status_code}")
        
        res_data = res.json()
        content = res_data["choices"][0]["message"]["content"].strip()
        cleaned_json = content.replace("```json", "").replace("```", "").strip()
        result = json.loads(cleaned_json)
        return result
    except Exception as e:
        print(f"❌ Backend AI evaluate_text error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


