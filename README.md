# South Sudan Food Security Intelligence UI

A professional, portfolio-ready interface for the South Sudan food-security forecasting model. It uses the same challenge training dataset and a reproducible CatBoost ensemble (seeds 42 and 7).

## Architecture

- `frontend/` — React + Vite dashboard
- `backend/` — FastAPI prediction API
- `backend/data/Train.csv` — original challenge training dataset used by the UI
- `backend/data/Final_Submission.csv` — submitted 234-row probability snapshot
- `backend/models/` — pre-trained CatBoost models

## Run the backend

```bash
cd backend
python -m venv .venv
# Windows: .venv\\Scripts\\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

## Run the frontend

```bash
cd frontend
npm install
npm run dev
```

Open the Vite URL shown in the terminal. By default the frontend expects the API at `http://localhost:8000/api`. Set `VITE_API_URL` if the API is hosted elsewhere.

## Main UI sections

1. Overview — model KPIs, validation performance, feature signals and responsible-use context.
2. Risk Predictor — interactive county-level probability prediction.
3. County Explorer — search/filter counties and inspect historical target behavior.
4. Submission Analytics — inspect the final probability output distribution.
5. Model & Method — model configuration, validation and feature importance.

## Important modelling note

The competition objective is ROC-AUC, so the application preserves continuous probabilities. The 0.10 threshold shown in the UI is an operational diagnostic selected on the chronological development slice; it is not a replacement for the continuous competition score or for IPC expert assessment.
