# Backend — South Sudan Food Security Intelligence

FastAPI backend serving the CatBoost food-security forecasting model and the original training dataset.

## Run

```bash
cd backend
python -m venv .venv
# Windows: .venv\\Scripts\\activate
# Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

The API loads two pre-trained CatBoost models (seeds 42 and 7) and averages their probabilities.
