$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Test-Path ".venv")) {
    py -3.11 -m venv .venv
}
& ".venv\Scripts\python.exe" -m pip install --upgrade pip setuptools wheel

# Install the CPU-only PyTorch wheels first; this avoids an accidental CUDA download.
& ".venv\Scripts\python.exe" -m pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu
& ".venv\Scripts\python.exe" -m pip install -r requirements.txt

if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "Created .env. Add HF_TOKEN only if you want speaker diarization."
}

Write-Host "Starting local transcription service at http://127.0.0.1:8765"
& ".venv\Scripts\python.exe" -m uvicorn app:app --host 127.0.0.1 --port 8765
